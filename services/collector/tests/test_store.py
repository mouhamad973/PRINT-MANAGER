"""Outbox SQLite : transactions, accusés, reprise avec délai exponentiel, purge prudente."""

from __future__ import annotations

import random
import sqlite3
import time
import uuid
from pathlib import Path

import pytest

from arksen_collector.store import (
    ACKED_RETENTION,
    BACKOFF_MAX,
    Event,
    Reading,
    Store,
    backoff_delay,
)

AGENT = str(uuid.uuid4())
PRINTER = str(uuid.uuid4())


def event(kind: str = "meter.reading") -> Event:
    return Event(
        id=str(uuid.uuid4()),
        type=kind,
        agent_id=AGENT,
        printer_id=PRINTER,
        occurred_at="2026-11-06T08:00:00.000Z",
        payload={"totalCount": 10},
    )


@pytest.fixture
def store(tmp_path: Path) -> Store:
    return Store(tmp_path / "collector.db")


def test_reading_and_event_are_written_together(store: Store) -> None:
    first = event()
    store.record([first], [Reading(first.id, PRINTER, first.occurred_at, 10, 10, None)])
    assert store.counts()["pending"] == 1
    assert store.readings()[0].event_id == first.id

    # Un relevé qui renvoie à un événement inexistant fait tout échouer : rien n'est écrit.
    orphan = event()
    with pytest.raises(sqlite3.IntegrityError):
        store.record([orphan], [Reading("inconnu", PRINTER, orphan.occurred_at, 1, 1, None)])
    assert store.counts()["pending"] == 1
    assert {e.id for e in store.due(10)} == {first.id}


def test_acknowledged_events_leave_the_queue(store: Store) -> None:
    accepted, duplicate, rejected, silent = event(), event(), event(), event()
    store.record([accepted, duplicate, rejected, silent])
    ids = [accepted.id, duplicate.id, rejected.id, silent.id]
    store.acknowledge(
        [
            {"id": accepted.id, "status": "accepted"},
            {"id": duplicate.id, "status": "duplicate"},
            {"id": rejected.id, "status": "rejected", "error": "Machine inconnue pour cet agent."},
            # Un accusé pour un événement non envoyé est ignoré.
            {"id": str(uuid.uuid4()), "status": "accepted"},
        ],
        ids,
    )
    assert store.counts() == {"pending": 1, "accepted": 1, "duplicate": 1, "rejected": 1}
    # Sans accusé, l'événement reste à envoyer.
    assert [e.id for e in store.due(10)] == [silent.id]
    assert store.rejected()[0]["last_error"] == "Machine inconnue pour cet agent."


def test_failed_sends_are_retried_with_exponential_backoff(store: Store) -> None:
    pending = event()
    store.record([pending])
    now = time.time()
    store.defer([pending.id], "Serveur injoignable", now=now)
    # Pas de nouvel envoi avant le délai (5 s ± 20 %).
    assert store.due(10, now=now + 3) == []
    assert [e.id for e in store.due(10, now=now + 7)] == [pending.id]

    rng = random.Random(1)
    delays = [backoff_delay(attempt, rng) for attempt in range(1, 15)]
    assert 4 <= delays[0] <= 6
    assert 8 <= delays[1] <= 12
    assert all(later >= earlier * 0.6 for earlier, later in zip(delays, delays[1:], strict=False))
    assert max(delays) <= BACKOFF_MAX

    store.retry_now()
    assert [e.id for e in store.due(10, now=now)] == [pending.id]


def test_purge_never_deletes_unacknowledged_events(store: Store) -> None:
    old_pending, old_rejected, old_accepted, recent_accepted = event(), event(), event(), event()
    store.record([old_pending, old_rejected, old_accepted, recent_accepted])
    store.acknowledge(
        [
            {"id": old_rejected.id, "status": "rejected", "error": "x"},
            {"id": old_accepted.id, "status": "accepted"},
            {"id": recent_accepted.id, "status": "accepted"},
        ],
        [old_rejected.id, old_accepted.id, recent_accepted.id],
    )
    purged = store.purge(now=time.time() + 1)
    assert purged == 0
    # Un mois et un jour plus tard : seuls les événements acquittés disparaissent.
    purged = store.purge(now=time.time() + ACKED_RETENTION + 86400)
    assert purged == 2
    assert store.counts() == {"pending": 1, "accepted": 0, "duplicate": 0, "rejected": 1}


def test_queue_survives_a_restart(tmp_path: Path) -> None:
    path = tmp_path / "collector.db"
    first = Store(path)
    pending = event()
    first.record([pending])
    first.close()
    assert [e.id for e in Store(path).due(10)] == [pending.id]


def test_secrets_in_the_cache_are_protected(store: Store) -> None:
    store.put("configuration", {"community": "secret-snmp"}, secret=True)
    raw = store._connection().execute("SELECT value FROM kv").fetchone()["value"]
    assert "secret-snmp" not in raw
    assert store.get("configuration", secret=True) == {"community": "secret-snmp"}
