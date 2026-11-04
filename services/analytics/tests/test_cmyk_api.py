"""Point d'entrée HTTP du moteur : un cas complet, calculé à la main."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from arksen_analytics.main import app

client = TestClient(app)


def channel(name: str, coverage: float, price: float | None = 90) -> dict[str, Any]:
    # 300 g pour 15 000 pages à 5 % : 0,02 g par page ; 90 la cartouche, soit 0,30 par gramme.
    return {
        "channel": name,
        "capacity_g": 300,
        "yield_pages": 15000,
        "reference_coverage": 5,
        "coverage": coverage,
        "unit_price": price,
    }


def item(key: str, **overrides: Any) -> dict[str, Any]:
    base = {
        "key": key,
        "total_pages": 1000,
        "color_pages": 400,
        "channels": [channel("BLACK", 5), channel("CYAN", 10)],
    }
    return {**base, **overrides}


def post(*items: dict[str, Any]) -> dict[str, Any]:
    response = client.post("/v1/cmyk/estimate", json={"items": list(items)})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def test_computes_each_channel_on_its_own_pages() -> None:
    result = post(item("a"))["items"][0]
    black, cyan = result["channels"]

    # Noir : 1 000 pages × 0,02 g × (5 / 5) = 20 g ; coût 20 × 0,30 = 6.
    assert black["relevant_pages"] == 1000
    assert black["theoretical_g"] == pytest.approx(20)
    assert black["cost_estimated"] == pytest.approx(6)
    # Cyan : 400 pages couleur × 0,02 g × (10 / 5) = 16 g ; coût 4,80.
    assert cyan["relevant_pages"] == 400
    assert cyan["theoretical_g"] == pytest.approx(16)
    assert cyan["estimated_g_per_1000_pages"] == pytest.approx(40)
    assert cyan["calibration"] == {
        "coefficient": 1.0,
        "source": "default",
        "observations": 0,
        "confidence": "none",
    }
    # Total : 36 g, 10,80, soit 0,0108 par page imprimée.
    assert result["totals"] == {
        "theoretical_g": pytest.approx(36),
        "estimated_g": pytest.approx(36),
        "cost_theoretical": pytest.approx(10.8),
        "cost_estimated": pytest.approx(10.8),
        "cost_per_page": pytest.approx(0.0108),
        "complete_cost": True,
    }


def test_measurements_calibrate_and_report_their_variance() -> None:
    measured = item(
        "a",
        measurements=[
            {"id": "m1", "channel": "BLACK", "total_pages": 1000, "color_pages": 0, "real_g": 25}
        ],
    )
    result = post(measured)["items"][0]
    black = result["channels"][0]

    # Mesure : 25 g pour 20 g théoriques, +25 %.
    assert result["measurements"] == [
        {
            "id": "m1",
            "channel": "BLACK",
            "theoretical_g": 20.0,
            "real_g": 25.0,
            "deviation_g": 5.0,
            "deviation_ratio": 0.25,
            "overconsumption_ratio": 0.25,
        }
    ]
    # Calibration lissée : (25 + 2 × 20) / (20 + 2 × 20) = 65 / 60.
    assert black["calibration"]["coefficient"] == pytest.approx(65 / 60, abs=1e-4)
    assert black["estimated_g"] == pytest.approx(20 * 65 / 60, abs=1e-3)
    assert black["theoretical_g"] == pytest.approx(20)


def test_siblings_of_the_same_model_calibrate_each_other() -> None:
    sibling = item(
        "b",
        group="model-1",
        measurements=[
            {"id": "m", "channel": "BLACK", "total_pages": 1000, "color_pages": 0, "real_g": 30}
        ],
    )
    result = post(item("a", group="model-1"), sibling)["items"][0]
    calibration = result["channels"][0]["calibration"]

    # Modèle : (30 + 2 × 20) / (20 + 40) = 70 / 60, appliqué à la machine sans mesure.
    assert calibration["source"] == "model"
    assert calibration["coefficient"] == pytest.approx(70 / 60, abs=1e-4)


def test_partial_prices_give_partial_costs() -> None:
    result = post(item("a", channels=[channel("BLACK", 5), channel("CYAN", 10, price=None)]))
    totals = result["items"][0]["totals"]
    assert totals["cost_estimated"] == pytest.approx(6)
    assert totals["complete_cost"] is False


@pytest.mark.parametrize(
    "bad",
    [
        item("a", color_pages=2000),
        item("a", channels=[channel("BLACK", 5), channel("BLACK", 6)]),
        item("a", channels=[channel("BLACK", 120)]),
    ],
)
def test_rejects_invalid_requests(bad: dict[str, Any]) -> None:
    response = client.post("/v1/cmyk/estimate", json={"items": [bad]})
    assert response.status_code == 422


def test_explains_a_measurement_on_a_missing_channel() -> None:
    response = client.post(
        "/v1/cmyk/estimate",
        json={
            "items": [
                item(
                    "a",
                    measurements=[
                        {
                            "id": "m",
                            "channel": "YELLOW",
                            "total_pages": 10,
                            "color_pages": 5,
                            "real_g": 1,
                        }
                    ],
                )
            ]
        },
    )
    assert response.status_code == 422
    assert "absent de la machine" in response.json()["detail"]
