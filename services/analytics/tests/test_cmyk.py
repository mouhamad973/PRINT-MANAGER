"""Tests mathématiques du moteur CMJN : chaque résultat attendu est calculé à la main."""

import pytest

from arksen_analytics.cmyk import (
    FORMAT_FACTORS,
    Channel,
    EngineError,
    Observation,
    TonerSpec,
    calibrate,
    cost_of_grams,
    relevant_pages,
    smoothed_ratio,
    theoretical_grams,
    variance,
)

# Toner fictif : 300 g pour 15 000 pages à 5 %, soit 0,02 g par page, à 90 la cartouche.
BLACK = TonerSpec(Channel.BLACK, capacity_g=300, yield_pages=15000, unit_price=90)
CYAN = TonerSpec(Channel.CYAN, capacity_g=200, yield_pages=10000, reference_coverage=5)


class TestReference:
    def test_reference_consumption_is_capacity_over_yield(self) -> None:
        assert BLACK.reference_g_per_page == pytest.approx(0.02)
        assert CYAN.reference_g_per_page == pytest.approx(0.02)

    @pytest.mark.parametrize(
        ("field", "value", "message"),
        [
            ("capacity_g", 0, "capacité"),
            ("yield_pages", 0, "rendement"),
            ("reference_coverage", 0, "couverture de référence"),
            ("reference_coverage", 101, "couverture de référence"),
            ("unit_price", -1, "prix"),
        ],
    )
    def test_rejects_impossible_specs(self, field: str, value: float, message: str) -> None:
        arguments: dict[str, object] = {
            "channel": Channel.BLACK,
            "capacity_g": 300,
            "yield_pages": 15000,
        }
        arguments[field] = value
        with pytest.raises(EngineError, match=message):
            TonerSpec(**arguments)  # type: ignore[arg-type]


class TestTheoretical:
    def test_reference_coverage_gives_reference_consumption(self) -> None:
        # 0,02 g × (5 / 5) × 1 000 pages = 20 g
        assert theoretical_grams(BLACK, coverage=5, pages=1000) == pytest.approx(20)

    def test_scales_linearly_with_coverage(self) -> None:
        # 0,02 g × (12,5 / 5) × 1 000 = 50 g
        assert theoretical_grams(BLACK, coverage=12.5, pages=1000) == pytest.approx(50)
        assert theoretical_grams(BLACK, coverage=0, pages=1000) == 0

    def test_applies_format_and_media_factors(self) -> None:
        # A3 : deux fois la surface d'un A4. Support à 1,1 : 20 g × 2 × 1,1 = 44 g
        assert theoretical_grams(
            BLACK, coverage=5, pages=1000, paper_format="A3", media_factor=1.1
        ) == pytest.approx(44)

    def test_sra3_factor_is_the_area_ratio(self) -> None:
        assert FORMAT_FACTORS["SRA3"] == pytest.approx(144000 / 62370)

    def test_uses_the_channel_reference_coverage(self) -> None:
        spec = TonerSpec(Channel.MAGENTA, capacity_g=100, yield_pages=5000, reference_coverage=4)
        # 0,02 g × (6 / 4) × 100 = 3 g
        assert theoretical_grams(spec, coverage=6, pages=100) == pytest.approx(3)

    @pytest.mark.parametrize(
        ("coverage", "pages", "media", "fmt"),
        [
            (-1, 10, 1, "A4"),
            (101, 10, 1, "A4"),
            (5, -1, 1, "A4"),
            (5, 10, 0, "A4"),
            (5, 10, 1, "A0"),
        ],
    )
    def test_rejects_impossible_inputs(
        self, coverage: float, pages: float, media: float, fmt: str
    ) -> None:
        with pytest.raises(EngineError):
            theoretical_grams(BLACK, coverage, pages, paper_format=fmt, media_factor=media)


class TestChannels:
    def test_black_prints_on_every_page_and_colors_on_color_pages(self) -> None:
        assert relevant_pages(Channel.BLACK, 1000, 300) == 1000
        for channel in (Channel.CYAN, Channel.MAGENTA, Channel.YELLOW):
            assert relevant_pages(channel, 1000, 300) == 300

    def test_rejects_more_color_pages_than_pages(self) -> None:
        with pytest.raises(EngineError, match="pages couleur"):
            relevant_pages(Channel.CYAN, 100, 101)

    def test_channels_are_independent(self) -> None:
        # Un aplat chargé en cyan ne change rien au noir.
        black_alone = theoretical_grams(BLACK, coverage=5, pages=1000)
        heavy_cyan = theoretical_grams(CYAN, coverage=40, pages=300)
        assert black_alone == pytest.approx(20)
        assert heavy_cyan == pytest.approx(0.02 * 8 * 300)


class TestCost:
    def test_cost_is_price_per_gram_times_grams(self) -> None:
        # 90 / 300 g = 0,30 par gramme ; 20 g coûtent 6.
        assert cost_of_grams(BLACK, 20) == pytest.approx(6)

    def test_cost_per_page_at_reference_coverage_is_price_over_yield(self) -> None:
        grams_per_page = theoretical_grams(BLACK, coverage=5, pages=1)
        assert cost_of_grams(BLACK, grams_per_page) == pytest.approx(90 / 15000)

    def test_unknown_price_gives_no_cost(self) -> None:
        assert cost_of_grams(CYAN, 10) is None


class TestVariance:
    def test_overconsumption(self) -> None:
        result = variance(theoretical_g=200, real_g=250)
        assert result.deviation_g == pytest.approx(50)
        assert result.deviation_ratio == pytest.approx(0.25)
        assert result.overconsumption_ratio == pytest.approx(0.25)

    def test_underconsumption_is_not_overconsumption(self) -> None:
        result = variance(theoretical_g=200, real_g=150)
        assert result.deviation_ratio == pytest.approx(-0.25)
        assert result.overconsumption_ratio == 0

    def test_no_ratio_without_theoretical_consumption(self) -> None:
        result = variance(theoretical_g=0, real_g=5)
        assert result.deviation_g == 5
        assert result.deviation_ratio is None
        assert result.overconsumption_ratio is None


class TestCalibration:
    def test_default_without_any_measurement(self) -> None:
        result = calibrate([], [])
        assert (result.coefficient, result.source, result.confidence) == (1.0, "default", "none")

    def test_manual_coefficient_wins(self) -> None:
        result = calibrate([Observation(100, 200)], [], manual=1.15)
        assert (result.coefficient, result.source) == (1.15, "manual")

    def test_single_measurement_only_moves_part_of_the_way(self) -> None:
        # (120 + 2 × 1 × 100) / (100 + 2 × 100) = 320 / 300
        result = calibrate([Observation(100, 120)], [])
        assert result.coefficient == pytest.approx(320 / 300)
        assert (result.source, result.observations, result.confidence) == ("printer", 1, "low")

    def test_converges_towards_the_measured_ratio(self) -> None:
        observations = [Observation(100, 120)] * 20
        # (2 400 + 200) / (2 000 + 200) = 2 600 / 2 200
        result = calibrate(observations, [])
        assert result.coefficient == pytest.approx(2600 / 2200)
        assert result.confidence == "high"

    def test_falls_back_to_the_model_coefficient(self) -> None:
        model = [Observation(100, 130), Observation(100, 130)]
        # (260 + 200) / (200 + 200) = 1,15
        result = calibrate([], model)
        assert result.coefficient == pytest.approx(1.15)
        assert (result.source, result.confidence) == ("model", "low")

    def test_printer_is_smoothed_towards_its_model(self) -> None:
        model = [Observation(100, 130), Observation(100, 130)]
        # Modèle : 1,15. Machine : (90 + 2 × 1,15 × 100) / (100 + 200) = 320 / 300
        result = calibrate([Observation(100, 90)], model)
        assert result.coefficient == pytest.approx(320 / 300)

    def test_ignores_observations_without_theoretical_consumption(self) -> None:
        assert smoothed_ratio([Observation(0, 50)], prior=1.2) == 1.2

    def test_rejects_a_non_positive_manual_coefficient(self) -> None:
        with pytest.raises(EngineError):
            calibrate([], [], manual=0)
