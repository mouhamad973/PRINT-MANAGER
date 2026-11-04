from pathlib import Path

import pytest

from arksen_collector.config import AgentSettings, ConfigError, ConfigStore, expand_range
from arksen_collector.protect import ProtectionError, protect, unprotect


def test_server_must_be_reached_over_https() -> None:
    AgentSettings(server_url="https://print.exemple.com").validate()
    AgentSettings(server_url="http://localhost:3000").validate()
    AgentSettings(server_url="http://127.0.0.1:3000").validate()
    with pytest.raises(ConfigError, match="HTTPS"):
        AgentSettings(server_url="http://print.exemple.com").validate()
    AgentSettings(server_url="http://10.0.0.5", allow_insecure_http=True).validate()
    with pytest.raises(ConfigError):
        AgentSettings(server_url="ftp://print.exemple.com").validate()


def test_api_base_goes_through_the_web_relay() -> None:
    settings = AgentSettings(server_url="https://print.exemple.com/")
    assert settings.api_base == "https://print.exemple.com/backend/api/v1/agent/v1"


def test_discovery_ranges() -> None:
    assert expand_range("192.168.1.10") == ["192.168.1.10"]
    assert expand_range("192.168.1.0/30") == ["192.168.1.1", "192.168.1.2"]
    assert expand_range("10.0.0.254-10.0.1.1") == [
        "10.0.0.254",
        "10.0.0.255",
        "10.0.1.0",
        "10.0.1.1",
    ]
    assert len(expand_range("172.16.0.0/22")) == 1022
    with pytest.raises(ConfigError, match="trop large"):
        expand_range("10.0.0.0/16")
    with pytest.raises(ConfigError, match="inversée"):
        expand_range("10.0.0.9-10.0.0.1")
    with pytest.raises(ConfigError, match="invalide"):
        expand_range("imprimante")
    with pytest.raises(ConfigError, match="4096"):
        AgentSettings(discovery_ranges=["10.0.0.0/20", "10.1.0.0/20"]).validate()


def test_intervals_are_bounded() -> None:
    with pytest.raises(ConfigError):
        AgentSettings(collect_interval=10).validate()
    with pytest.raises(ConfigError):
        AgentSettings(discovery_interval=60).validate()


def test_settings_round_trip_and_token_protection(tmp_path: Path) -> None:
    store = ConfigStore(tmp_path)
    settings = AgentSettings(
        server_url="https://print.exemple.com", agent_id="a", agent_name="Agent"
    )
    settings.set_token("ark_secret")
    settings.discovery_ranges = ["192.168.1.0/24"]
    store.save(settings)
    assert "ark_secret" not in store.path.read_text(encoding="utf-8")
    loaded = store.load()
    assert loaded.token == "ark_secret"
    assert loaded.discovery_ranges == ["192.168.1.0/24"]
    assert loaded.enrolled
    # Aucun fichier temporaire n'est laissé derrière l'écriture atomique.
    assert sorted(path.name for path in tmp_path.iterdir()) == ["config.json"]


def test_invalid_settings_are_not_saved(tmp_path: Path) -> None:
    store = ConfigStore(tmp_path)
    with pytest.raises(ConfigError):
        store.save(AgentSettings(collect_interval=5))
    assert not store.path.exists()


def test_protection_round_trip() -> None:
    sealed = protect(b"communaute")
    assert b"communaute" not in sealed.encode()
    assert unprotect(sealed) == b"communaute"
    with pytest.raises(ProtectionError):
        unprotect("inconnu:abc")
