"""Synchronisation : coupures, reprise automatique, idempotence, révocation."""

from __future__ import annotations

import uuid
from pathlib import Path

import httpx
import pytest

from arksen_collector.agent import Agent
from arksen_collector.config import ConfigError, ConfigStore
from arksen_collector.store import Event
from arksen_collector.sync import AgentUnauthorized
from tests.fake_server import FakeServer


def make_agent(tmp_path: Path, server: FakeServer) -> Agent:
    agent = Agent(ConfigStore(tmp_path / "home"), transport=server.transport())
    agent.enroll("http://localhost:3000", server.code)
    return agent


def queue(agent: Agent, count: int, kind: str = "meter.reading") -> list[str]:
    events = [
        Event(
            id=str(uuid.uuid4()),
            type=kind,
            agent_id=agent.settings.agent_id,
            printer_id=str(uuid.uuid4()),
            occurred_at="2026-11-06T08:00:00.000Z",
            payload={"totalCount": index},
        )
        for index in range(count)
    ]
    agent.store.record(events)
    return [item.id for item in events]


def test_events_are_sent_in_batches_and_acknowledged(tmp_path: Path) -> None:
    server = FakeServer()
    agent = make_agent(tmp_path, server)
    ids = queue(agent, 450)
    report = agent.sync_once()
    assert (report.sent, report.accepted, report.error) == (450, 450, None)
    assert [len(batch) for batch in server.batches] == [200, 200, 50]
    assert set(server.received) == set(ids)
    assert agent.store.counts()["pending"] == 0
    assert agent.store.sync_history(1)[0].accepted == 450


def test_network_failure_keeps_events_and_retries_later(tmp_path: Path) -> None:
    server = FakeServer()
    agent = make_agent(tmp_path, server)
    queue(agent, 3)

    def offline(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("réseau indisponible", request=request)

    server.failure = offline
    report = agent.sync_once()
    assert report.sent == 0
    assert report.error and "injoignable" in report.error
    assert agent.store.counts()["pending"] == 3
    # Le délai de reprise n'est pas écoulé : rien n'est renvoyé tout de suite.
    assert agent.store.due(10) == []
    assert agent.store.sync_history(1)[0].error == report.error

    # Reprise automatique une fois le délai écoulé : tout part, sans intervention.
    agent.store.retry_now()
    report = agent.sync_once()
    assert (report.sent, report.accepted) == (3, 3)
    assert agent.store.counts()["pending"] == 0


def test_server_error_is_retried_without_losing_events(tmp_path: Path) -> None:
    server = FakeServer()
    agent = make_agent(tmp_path, server)
    queue(agent, 2)
    server.failure = lambda request: httpx.Response(503, json={"message": "Maintenance"})
    report = agent.sync_once()
    assert report.error == "Maintenance"
    assert agent.store.counts()["pending"] == 2


def test_lost_response_is_resent_and_counted_once(tmp_path: Path) -> None:
    """Le serveur a traité le lot mais la réponse s'est perdue : l'agent renvoie, le serveur
    répond « doublon », et rien n'est compté deux fois."""
    server = FakeServer()
    agent = make_agent(tmp_path, server)
    ids = queue(agent, 5)
    server.drop_response = True
    report = agent.sync_once()
    assert report.error
    assert len(server.received) == 5
    assert agent.store.counts()["pending"] == 5

    agent.store.retry_now()
    report = agent.sync_once()
    assert (report.sent, report.accepted, report.duplicates) == (5, 0, 5)
    assert agent.store.counts() == {"pending": 0, "accepted": 0, "duplicate": 5, "rejected": 0}
    assert sorted(server.received) == sorted(ids)


def test_rejected_events_are_kept_locally_and_not_resent(tmp_path: Path) -> None:
    server = FakeServer()
    server.reject_types = {"printer.status"}
    agent = make_agent(tmp_path, server)
    queue(agent, 2, kind="printer.status")
    report = agent.sync_once()
    assert report.rejected == 2
    assert agent.store.counts()["rejected"] == 2
    assert agent.store.due(10) == []
    assert agent.sync_once().sent == 0


def test_revoked_agent_stops_but_keeps_its_events(tmp_path: Path) -> None:
    server = FakeServer()
    agent = make_agent(tmp_path, server)
    queue(agent, 4)
    server.revoked = True
    with pytest.raises(AgentUnauthorized):
        agent.sync_once()
    assert agent.store.counts()["pending"] == 4
    assert agent.status().unauthorized

    # Nouvel enregistrement (nouveau code) : les événements conservés partent alors.
    server.revoked = False
    agent.enroll("http://localhost:3000", server.code)
    assert not agent.status().unauthorized
    assert agent.sync_once().accepted == 4


def test_enrollment_stores_the_token_protected(tmp_path: Path) -> None:
    server = FakeServer()
    agent = make_agent(tmp_path, server)
    raw = (tmp_path / "home" / "config.json").read_text(encoding="utf-8")
    assert server.agent_id in raw
    assert "ark_" not in raw
    assert agent.settings.token.startswith("ark_")


def test_wrong_enrollment_code_is_refused(tmp_path: Path) -> None:
    server = FakeServer()
    agent = Agent(ConfigStore(tmp_path / "home"), transport=server.transport())
    with pytest.raises(AgentUnauthorized):
        agent.enroll("http://localhost:3000", "ZZZZ-ZZZZ-ZZZZ-ZZZZ")
    assert not agent.settings.enrolled


def test_enrollment_keeps_the_on_premise_authority(tmp_path: Path) -> None:
    server = FakeServer()
    authority = tmp_path / "ca.pem"
    authority.write_text("-----BEGIN CERTIFICATE-----\n", encoding="utf-8")
    agent = Agent(ConfigStore(tmp_path / "home"), transport=server.transport())
    agent.enroll("http://localhost:3000", server.code, ca_file=str(authority))
    assert agent.settings.enrolled
    assert agent.settings.ca_file == str(authority)


def test_enrollment_refuses_a_missing_authority(tmp_path: Path) -> None:
    server = FakeServer()
    agent = Agent(ConfigStore(tmp_path / "home"), transport=server.transport())
    with pytest.raises(ConfigError):
        agent.enroll("http://localhost:3000", server.code, ca_file=str(tmp_path / "absent.pem"))
    assert not agent.settings.enrolled
