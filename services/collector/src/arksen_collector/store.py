"""Stockage local SQLite : relevés, outbox transactionnelle et journal des synchronisations.

Règles :
- un relevé et son événement sont écrits dans la même transaction (Transactional Outbox) ;
- un événement n'est jamais supprimé tant que le serveur ne l'a pas acquitté ;
- après un échec, l'envoi est retenté avec un délai exponentiel (et un peu d'aléa).
"""

from __future__ import annotations

import json
import random
import sqlite3
import threading
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from arksen_collector.protect import ProtectionError, protect, unprotect

SCHEMA_VERSION = 1

#: Délais de reprise : 5 s, 10 s, 20 s… plafonnés à une heure.
BACKOFF_BASE = 5.0
BACKOFF_MAX = 3600.0
#: Événements acquittés conservés localement, pour consultation, avant purge.
ACKED_RETENTION = 30 * 24 * 3600

_SCHEMA = """
CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    agent_id TEXT NOT NULL,
    printer_id TEXT,
    occurred_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'duplicate', 'rejected')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at REAL NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at REAL NOT NULL,
    acked_at REAL
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS readings (
    event_id TEXT PRIMARY KEY REFERENCES outbox (id),
    printer_id TEXT NOT NULL,
    read_at TEXT NOT NULL,
    total_count INTEGER,
    black_count INTEGER,
    color_count INTEGER
);
CREATE INDEX IF NOT EXISTS readings_printer ON readings (printer_id, read_at);

CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at REAL NOT NULL,
    finished_at REAL NOT NULL,
    sent INTEGER NOT NULL,
    accepted INTEGER NOT NULL,
    duplicates INTEGER NOT NULL,
    rejected INTEGER NOT NULL,
    error TEXT
);

CREATE TABLE IF NOT EXISTS printer_runs (
    printer_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    last_attempt_at REAL,
    last_success_at REAL,
    last_error TEXT
);

CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


@dataclass(frozen=True)
class Event:
    id: str
    type: str
    agent_id: str
    printer_id: str | None
    occurred_at: str
    payload: dict[str, Any]
    schema_version: int = SCHEMA_VERSION

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "schemaVersion": self.schema_version,
            "agentId": self.agent_id,
            "printerId": self.printer_id,
            "occurredAt": self.occurred_at,
            "payload": self.payload,
        }


@dataclass(frozen=True)
class Reading:
    event_id: str
    printer_id: str
    read_at: str
    total_count: int | None
    black_count: int | None
    color_count: int | None


@dataclass(frozen=True)
class SyncEntry:
    started_at: float
    finished_at: float
    sent: int
    accepted: int
    duplicates: int
    rejected: int
    error: str | None


def backoff_delay(attempts: int, rng: random.Random | None = None) -> float:
    """Délai avant la tentative suivante : exponentiel, plafonné, à ±20 % près."""
    base: float = min(BACKOFF_BASE * 2.0 ** max(attempts - 1, 0), BACKOFF_MAX)
    jitter = rng.uniform(0.8, 1.2) if rng else random.uniform(0.8, 1.2)
    return min(base * jitter, BACKOFF_MAX)


class Store:
    """Accès SQLite sûr entre fils d'exécution : une connexion par fil, en mode WAL."""

    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        # executescript valide lui-même ses instructions : il s'exécute hors transaction.
        self._connection().executescript(_SCHEMA)

    def _connection(self) -> sqlite3.Connection:
        connection: sqlite3.Connection | None = getattr(self._local, "connection", None)
        if connection is None:
            connection = sqlite3.connect(self.path, timeout=30, isolation_level=None)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA foreign_keys=ON")
            self._local.connection = connection
        return connection

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        db = self._connection()
        db.execute("BEGIN IMMEDIATE")
        try:
            yield db
        except BaseException:
            db.execute("ROLLBACK")
            raise
        db.execute("COMMIT")

    def close(self) -> None:
        connection: sqlite3.Connection | None = getattr(self._local, "connection", None)
        if connection is not None:
            connection.close()
            self._local.connection = None

    # -- Outbox -------------------------------------------------------------------------------

    def record(self, events: Sequence[Event], readings: Sequence[Reading] = ()) -> None:
        """Enregistre des événements et leurs relevés, ensemble ou pas du tout."""
        now = time.time()
        with self._transaction() as db:
            db.executemany(
                "INSERT INTO outbox (id, type, schema_version, agent_id, printer_id, occurred_at,"
                " payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        event.id,
                        event.type,
                        event.schema_version,
                        event.agent_id,
                        event.printer_id,
                        event.occurred_at,
                        json.dumps(event.payload, ensure_ascii=False),
                        now,
                    )
                    for event in events
                ],
            )
            db.executemany(
                "INSERT INTO readings VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (
                        reading.event_id,
                        reading.printer_id,
                        reading.read_at,
                        reading.total_count,
                        reading.black_count,
                        reading.color_count,
                    )
                    for reading in readings
                ],
            )

    def due(self, limit: int, now: float | None = None) -> list[Event]:
        """Événements à envoyer : non acquittés et dont le délai de reprise est écoulé."""
        rows = (
            self._connection()
            .execute(
                "SELECT * FROM outbox WHERE status = 'pending' AND next_attempt_at <= ?"
                " ORDER BY created_at, id LIMIT ?",
                (time.time() if now is None else now, limit),
            )
            .fetchall()
        )
        return [
            Event(
                id=row["id"],
                type=row["type"],
                agent_id=row["agent_id"],
                printer_id=row["printer_id"],
                occurred_at=row["occurred_at"],
                payload=json.loads(row["payload"]),
                schema_version=row["schema_version"],
            )
            for row in rows
        ]

    def acknowledge(self, acks: Sequence[dict[str, Any]], expected: Sequence[str]) -> None:
        """Applique les accusés du serveur. Un événement sans accusé reste à envoyer."""
        now = time.time()
        known = set(expected)
        with self._transaction() as db:
            for ack in acks:
                status = ack.get("status")
                event_id = ack.get("id")
                if event_id not in known or status not in {"accepted", "duplicate", "rejected"}:
                    continue
                db.execute(
                    "UPDATE outbox SET status = ?, acked_at = ?, last_error = ? WHERE id = ?"
                    " AND status = 'pending'",
                    (status, now, ack.get("error"), event_id),
                )

    def defer(self, event_ids: Sequence[str], error: str, now: float | None = None) -> None:
        """Échec d'envoi : nouvelle tentative plus tard, l'événement est conservé."""
        moment = time.time() if now is None else now
        with self._transaction() as db:
            for event_id in event_ids:
                row = db.execute(
                    "SELECT attempts FROM outbox WHERE id = ? AND status = 'pending'", (event_id,)
                ).fetchone()
                if row is None:
                    continue
                attempts = row["attempts"] + 1
                db.execute(
                    "UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ?"
                    " WHERE id = ?",
                    (attempts, moment + backoff_delay(attempts), error[:500], event_id),
                )

    def retry_now(self) -> int:
        """Remet les événements en attente à envoyer immédiatement (bouton « Synchroniser »)."""
        with self._transaction() as db:
            return db.execute(
                "UPDATE outbox SET next_attempt_at = 0 WHERE status = 'pending'"
            ).rowcount

    def purge(self, now: float | None = None) -> int:
        """Supprime les événements acquittés anciens ; jamais un événement non acquitté."""
        limit = (time.time() if now is None else now) - ACKED_RETENTION
        with self._transaction() as db:
            db.execute(
                "DELETE FROM readings WHERE event_id IN (SELECT id FROM outbox"
                " WHERE status IN ('accepted', 'duplicate') AND acked_at < ?)",
                (limit,),
            )
            return db.execute(
                "DELETE FROM outbox WHERE status IN ('accepted', 'duplicate') AND acked_at < ?",
                (limit,),
            ).rowcount

    def counts(self) -> dict[str, int]:
        rows = self._connection().execute(
            "SELECT status, COUNT(*) AS n FROM outbox GROUP BY status"
        )
        counts = {"pending": 0, "accepted": 0, "duplicate": 0, "rejected": 0}
        for row in rows:
            counts[row["status"]] = row["n"]
        return counts

    def oldest_pending(self) -> float | None:
        row = (
            self._connection()
            .execute("SELECT MIN(created_at) AS t FROM outbox WHERE status = 'pending'")
            .fetchone()
        )
        return row["t"] if row and row["t"] is not None else None

    def rejected(self, limit: int = 20) -> list[dict[str, Any]]:
        rows = self._connection().execute(
            "SELECT id, type, printer_id, occurred_at, last_error FROM outbox"
            " WHERE status = 'rejected' ORDER BY acked_at DESC LIMIT ?",
            (limit,),
        )
        return [dict(row) for row in rows]

    def readings(self, printer_id: str | None = None, limit: int = 50) -> list[Reading]:
        query = "SELECT * FROM readings"
        params: tuple[Any, ...] = ()
        if printer_id:
            query += " WHERE printer_id = ?"
            params = (printer_id,)
        rows = self._connection().execute(
            query + " ORDER BY read_at DESC LIMIT ?", (*params, limit)
        )
        return [
            Reading(
                row["event_id"],
                row["printer_id"],
                row["read_at"],
                row["total_count"],
                row["black_count"],
                row["color_count"],
            )
            for row in rows
        ]

    # -- Journal des synchronisations ----------------------------------------------------------

    def log_sync(self, entry: SyncEntry) -> None:
        with self._transaction() as db:
            db.execute(
                "INSERT INTO sync_log (started_at, finished_at, sent, accepted, duplicates,"
                " rejected, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    entry.started_at,
                    entry.finished_at,
                    entry.sent,
                    entry.accepted,
                    entry.duplicates,
                    entry.rejected,
                    entry.error,
                ),
            )
            # Le journal garde les 1 000 dernières synchronisations.
            db.execute("DELETE FROM sync_log WHERE id <= (SELECT MAX(id) - 1000 FROM sync_log)")

    def sync_history(self, limit: int = 20) -> list[SyncEntry]:
        rows = self._connection().execute(
            "SELECT * FROM sync_log ORDER BY id DESC LIMIT ?", (limit,)
        )
        return [
            SyncEntry(
                row["started_at"],
                row["finished_at"],
                row["sent"],
                row["accepted"],
                row["duplicates"],
                row["rejected"],
                row["error"],
            )
            for row in rows
        ]

    # -- Suivi des machines --------------------------------------------------------------------

    def printer_run(
        self, printer_id: str, name: str, host: str, *, ok: bool, error: str | None
    ) -> None:
        now = time.time()
        with self._transaction() as db:
            db.execute(
                "INSERT INTO printer_runs VALUES (?, ?, ?, ?, ?, ?)"
                " ON CONFLICT (printer_id) DO UPDATE SET name = excluded.name,"
                " host = excluded.host, last_attempt_at = excluded.last_attempt_at,"
                " last_success_at = COALESCE(excluded.last_success_at, last_success_at),"
                " last_error = excluded.last_error",
                (printer_id, name, host, now, now if ok else None, error),
            )

    def printer_runs(self) -> list[dict[str, Any]]:
        rows = self._connection().execute("SELECT * FROM printer_runs ORDER BY name")
        return [dict(row) for row in rows]

    # -- Valeurs diverses ----------------------------------------------------------------------

    def put(self, key: str, value: Any, *, secret: bool = False) -> None:
        text = json.dumps(value, ensure_ascii=False)
        if secret:
            text = protect(text.encode("utf-8"))
        with self._transaction() as db:
            db.execute(
                "INSERT INTO kv VALUES (?, ?)"
                " ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                (key, text),
            )

    def get(self, key: str, *, secret: bool = False) -> Any:
        row = self._connection().execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        if row is None:
            return None
        text: str = row["value"]
        if secret:
            try:
                text = unprotect(text).decode("utf-8")
            except ProtectionError:
                return None
        return json.loads(text)
