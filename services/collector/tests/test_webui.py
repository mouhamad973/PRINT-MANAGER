"""Interface locale : accès restreint à la boucle locale, formulaires protégés."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

from arksen_collector.agent import Agent
from arksen_collector.config import ConfigStore
from arksen_collector.webui import LocalUi
from tests.fake_server import FakeServer


@pytest.fixture
def ui(tmp_path: Path) -> Iterator[LocalUi]:
    server = FakeServer()
    agent = Agent(ConfigStore(tmp_path / "home"), transport=server.transport())
    local = LocalUi(agent, port=0)
    local.start()
    local.fake_server = server  # type: ignore[attr-defined]
    yield local
    local.stop()


def origin(ui: LocalUi) -> str:
    return f"http://127.0.0.1:{ui.port}"


def test_page_shows_the_agent_state(ui: LocalUi) -> None:
    response = httpx.get(ui.url)
    assert response.status_code == 200
    assert "Non enregistré" in response.text
    assert response.headers["X-Frame-Options"] == "DENY"


def test_foreign_host_header_is_refused(ui: LocalUi) -> None:
    # Protection contre le rebinding DNS : un autre nom d'hôte pointant vers 127.0.0.1.
    response = httpx.get(ui.url, headers={"Host": "attaquant.exemple.com"})
    assert response.status_code == 421


def test_forms_require_the_csrf_token_and_local_origin(ui: LocalUi) -> None:
    data = {"collect_minutes": "5", "ranges": "", "communities": "public", "ca_file": ""}
    no_token = httpx.post(ui.url + "settings", data=data, headers={"Origin": origin(ui)})
    assert no_token.status_code == 403
    foreign = httpx.post(
        ui.url + "settings",
        data={**data, "csrf": ui.csrf},
        headers={"Origin": "https://attaquant.exemple.com"},
    )
    assert foreign.status_code == 403
    assert ui.agent.config.load().collect_interval == 900


def test_settings_and_enrollment_through_the_page(ui: LocalUi) -> None:
    headers = {"Origin": origin(ui)}
    saved = httpx.post(
        ui.url + "settings",
        data={
            "csrf": ui.csrf,
            "collect_minutes": "5",
            "ranges": "192.168.1.0/28\n10.0.0.10-10.0.0.20",
            "communities": "public, lecture",
            "ca_file": "",
        },
        headers=headers,
    )
    assert saved.status_code == 303
    settings = ui.agent.config.load()
    assert settings.collect_interval == 300
    assert settings.discovery_ranges == ["192.168.1.0/28", "10.0.0.10-10.0.0.20"]
    assert settings.discovery_communities == ["public", "lecture"]

    invalid = httpx.post(
        ui.url + "settings",
        data={"csrf": ui.csrf, "collect_minutes": "5", "ranges": "10.0.0.0/8", "communities": ""},
        headers=headers,
    )
    assert "error=" in invalid.headers["Location"]

    server: FakeServer = ui.fake_server  # type: ignore[attr-defined]
    enrolled = httpx.post(
        ui.url + "enroll",
        data={"csrf": ui.csrf, "server_url": "http://localhost:3000", "code": server.code},
        headers=headers,
    )
    assert "message=" in enrolled.headers["Location"]
    assert ui.agent.settings.agent_id == server.agent_id
    page = httpx.get(ui.url)
    assert "Agent de test" in page.text
