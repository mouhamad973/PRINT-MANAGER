"""Échanges avec le serveur : enregistrement, configuration et envoi de l'outbox.

L'envoi est automatique et sans intervention : en cas d'échec réseau ou serveur, les
événements restent dans l'outbox et sont renvoyés plus tard (délai exponentiel). Le serveur
acquitte chaque événement ; seul un accusé le fait sortir de l'attente.
"""

from __future__ import annotations

import platform
import socket
import time
from dataclasses import dataclass
from typing import Any

import httpx

from arksen_collector import __version__
from arksen_collector.config import AgentSettings
from arksen_collector.store import Store, SyncEntry

#: Taille d'un lot : celle qu'accepte le serveur.
BATCH_SIZE = 200
#: Lots envoyés au plus par synchronisation, pour rendre la main à la collecte.
MAX_BATCHES = 50


class SyncError(Exception):
    """Échec d'échange avec le serveur, avec un message destiné à l'utilisateur."""


class AgentUnauthorized(SyncError):
    """Jeton refusé : agent révoqué ou réinstallé. Un nouvel enregistrement est nécessaire."""


@dataclass
class SyncReport:
    sent: int = 0
    accepted: int = 0
    duplicates: int = 0
    rejected: int = 0
    error: str | None = None


def user_agent() -> str:
    return f"arksen-collector/{__version__}"


def hostname() -> str:
    return socket.gethostname()[:255]


class ServerClient:
    def __init__(
        self,
        settings: AgentSettings,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.settings = settings
        verify: Any = settings.ca_file or True
        self._client = httpx.Client(
            transport=transport,
            timeout=timeout,
            verify=verify,
            headers={
                "User-Agent": user_agent(),
                "X-Agent-Version": __version__,
                "X-Agent-Hostname": hostname(),
            },
        )

    def close(self) -> None:
        self._client.close()

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = f"{self.settings.api_base}{path}"
        try:
            response = self._client.request(method, url, **kwargs)
        except httpx.TimeoutException as error:
            raise SyncError(f"Le serveur ne répond pas ({self.settings.server_url}).") from error
        except httpx.HTTPError as error:
            raise SyncError(
                f"Serveur injoignable ({self.settings.server_url}) : {error}"
            ) from error
        if response.status_code == 401:
            raise AgentUnauthorized(
                _message(response, "Agent non autorisé : enregistrez-le de nouveau.")
            )
        if response.status_code >= 400:
            raise SyncError(_message(response, f"Erreur du serveur (HTTP {response.status_code})."))
        try:
            return response.json()
        except ValueError as error:
            raise SyncError("Réponse du serveur illisible.") from error

    def enroll(self, code: str) -> dict[str, Any]:
        result: dict[str, Any] = self._request(
            "POST",
            "/enroll",
            json={
                "code": code,
                "hostname": hostname(),
                "version": __version__,
                "platform": platform.platform()[:120],
            },
        )
        return result

    def configuration(self) -> dict[str, Any]:
        result: dict[str, Any] = self._request("GET", "/config", headers=self._auth())
        return result

    def send(self, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        result = self._request("POST", "/events", json={"events": events}, headers=self._auth())
        acks = result.get("acks") if isinstance(result, dict) else None
        if not isinstance(acks, list):
            raise SyncError("Réponse du serveur sans accusés de réception.")
        return acks

    def _auth(self) -> dict[str, str]:
        token = self.settings.token
        if not token:
            raise AgentUnauthorized("Agent non enregistré.")
        return {"Authorization": f"Bearer {token}"}


def _message(response: httpx.Response, fallback: str) -> str:
    try:
        body = response.json()
    except ValueError:
        return fallback
    message = body.get("message") if isinstance(body, dict) else None
    if isinstance(message, list):
        message = " ".join(str(item) for item in message)
    return str(message) if message else fallback


def push(store: Store, client: ServerClient) -> SyncReport:
    """Envoie les événements dus, lot par lot, et journalise la synchronisation.

    Les accusés sont appliqués lot par lot : une coupure au milieu ne perd rien, et les
    événements déjà acquittés ne sont pas renvoyés.
    """
    report = SyncReport()
    started = time.time()
    try:
        for _ in range(MAX_BATCHES):
            batch = store.due(BATCH_SIZE)
            if not batch:
                break
            ids = [event.id for event in batch]
            try:
                acks = client.send([event.to_wire() for event in batch])
            except AgentUnauthorized:
                raise
            except SyncError as error:
                store.defer(ids, str(error))
                raise
            store.acknowledge(acks, ids)
            acked = {ack.get("id") for ack in acks}
            missing = [event_id for event_id in ids if event_id not in acked]
            if missing:
                store.defer(missing, "Événement non acquitté par le serveur.")
            report.sent += len(batch)
            for ack in acks:
                status = ack.get("status")
                if status == "accepted":
                    report.accepted += 1
                elif status == "duplicate":
                    report.duplicates += 1
                elif status == "rejected":
                    report.rejected += 1
    except AgentUnauthorized as error:
        # Les événements restent en attente : ils partiront après le nouvel enregistrement.
        report.error = str(error)
        raise
    except SyncError as error:
        report.error = str(error)
    finally:
        if report.sent or report.error:
            store.log_sync(
                SyncEntry(
                    started_at=started,
                    finished_at=time.time(),
                    sent=report.sent,
                    accepted=report.accepted,
                    duplicates=report.duplicates,
                    rejected=report.rejected,
                    error=report.error,
                )
            )
    return report
