"""Cœur de l'agent : planifie la collecte, la découverte et la synchronisation.

L'agent fonctionne sans Internet : il collecte selon la dernière configuration reçue (mise en
cache, protégée) et conserve ses relevés jusqu'à ce que le serveur les acquitte.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from arksen_collector.collect import PrinterTarget, collect_all, discover
from arksen_collector.config import AgentSettings, ConfigError, ConfigStore, check_server_url
from arksen_collector.store import Event, Reading, Store
from arksen_collector.sync import AgentUnauthorized, ServerClient, SyncError, SyncReport, push

log = logging.getLogger("arksen_collector")

#: Rafraîchissement de la configuration et rythme de synchronisation, en secondes.
CONFIG_INTERVAL = 300
SYNC_INTERVAL = 30
PURGE_INTERVAL = 24 * 3600


def to_event(item: dict[str, Any]) -> Event:
    return Event(
        id=item["id"],
        type=item["type"],
        agent_id=item["agentId"],
        printer_id=item.get("printerId"),
        occurred_at=item["occurredAt"],
        payload=item["payload"],
    )


@dataclass
class Status:
    enrolled: bool
    unauthorized: bool
    server_url: str
    agent_name: str
    agent_id: str
    tenant_id: str
    collect_interval: int
    discovery_ranges: list[str]
    printers: int
    configuration_at: float | None
    last_collect_at: float | None
    last_discovery_at: float | None
    last_sync_at: float | None
    last_sync_error: str | None
    pending: int
    accepted: int
    duplicates: int
    rejected: int
    oldest_pending_at: float | None


class Agent:
    def __init__(
        self,
        config: ConfigStore,
        *,
        transport: httpx.BaseTransport | None = None,
        snmp_timeout: float = 2.0,
        snmp_retries: int = 1,
    ) -> None:
        self.config = config
        self.settings = config.load()
        self.store = Store(config.database_path)
        self._transport = transport
        self.snmp_timeout = snmp_timeout
        self.snmp_retries = snmp_retries
        self._lock = threading.Lock()

    def reload(self) -> None:
        self.settings = self.config.load()

    def client(self) -> ServerClient:
        return ServerClient(self.settings, transport=self._transport)

    # -- Enregistrement ------------------------------------------------------------------------

    def enroll(
        self,
        server_url: str,
        code: str,
        *,
        allow_insecure_http: bool = False,
        ca_file: str | None = None,
    ) -> None:
        """Échange le code contre un jeton et l'enregistre, protégé, dans la configuration.

        `ca_file` : certificat de l'autorité d'un serveur On-Premise, à faire confiance en plus
        des autorités de Windows.
        """
        check_server_url(server_url, allow_insecure_http)
        if not server_url:
            raise ConfigError("Saisissez l'adresse du serveur.")
        candidate = self.config.load()
        candidate.server_url = server_url.rstrip("/")
        candidate.allow_insecure_http = allow_insecure_http
        if ca_file is not None:
            if ca_file and not Path(ca_file).is_file():
                raise ConfigError(f"Certificat introuvable : {ca_file}")
            candidate.ca_file = ca_file
        client = ServerClient(candidate, transport=self._transport)
        try:
            result = client.enroll(code)
        finally:
            client.close()
        candidate.agent_id = result["agentId"]
        candidate.tenant_id = result["tenantId"]
        candidate.agent_name = result["name"]
        candidate.set_token(result["token"])
        self.config.save(candidate)
        self.settings = candidate
        self.store.put("unauthorized", False)
        log.info("Agent enregistré : %s (%s)", candidate.agent_name, candidate.agent_id)

    # -- Configuration -------------------------------------------------------------------------

    def refresh_configuration(self) -> bool:
        """Récupère les machines à interroger. Hors ligne, la dernière configuration sert."""
        client = self.client()
        try:
            configuration = client.configuration()
        except AgentUnauthorized:
            self.store.put("unauthorized", True)
            raise
        except SyncError as error:
            log.warning("Configuration non rafraîchie : %s", error)
            return False
        finally:
            client.close()
        self.store.put("configuration", configuration, secret=True)
        self.store.put("configuration_at", time.time())
        self.store.put("unauthorized", False)
        return True

    def targets(self) -> list[PrinterTarget]:
        configuration = self.store.get("configuration", secret=True)
        if not configuration:
            return []
        return [PrinterTarget.from_config(item) for item in configuration.get("printers", [])]

    # -- Collecte, découverte, synchronisation -----------------------------------------------

    def collect_once(self) -> int:
        """Interroge chaque machine et enregistre ses événements dans l'outbox. Rend le nombre
        de machines jointes."""
        targets = self.targets()
        if not targets or not self.settings.agent_id:
            return 0
        results = asyncio.run(
            collect_all(
                targets,
                self.settings.agent_id,
                timeout=self.snmp_timeout,
                retries=self.snmp_retries,
            )
        )
        reached = 0
        for result in results:
            readings = []
            if result.reading:
                reading = result.reading
                readings.append(
                    Reading(
                        event_id=reading["event_id"],
                        printer_id=result.printer.id,
                        read_at=reading["read_at"],
                        total_count=reading["totalCount"],
                        black_count=reading["blackCount"],
                        color_count=reading["colorCount"],
                    )
                )
            # Relevé et événements d'une machine : une seule transaction (outbox).
            self.store.record([to_event(item) for item in result.events], readings)
            self.store.printer_run(
                result.printer.id,
                result.printer.name,
                result.printer.host,
                ok=result.ok,
                error=result.error,
            )
            reached += int(result.ok)
        self.store.put("last_collect_at", time.time())
        log.info("Collecte : %d machine(s) jointe(s) sur %d", reached, len(targets))
        return reached

    def discover_once(self) -> int:
        if not self.settings.discovery_ranges or not self.settings.agent_id:
            return 0
        events = asyncio.run(
            discover(
                self.settings.discovery_ranges,
                self.settings.discovery_communities,
                self.settings.agent_id,
            )
        )
        if events:
            self.store.record([to_event(item) for item in events])
        self.store.put("last_discovery_at", time.time())
        log.info("Découverte : %d imprimante(s) trouvée(s)", len(events))
        return len(events)

    def sync_once(self) -> SyncReport:
        client = self.client()
        try:
            report = push(self.store, client)
        except AgentUnauthorized as error:
            self.store.put("unauthorized", True)
            self.store.put("last_sync_error", str(error))
            raise
        finally:
            client.close()
        if report.sent or report.error:
            self.store.put("last_sync_at", time.time())
            self.store.put("last_sync_error", report.error)
        return report

    # -- Boucle de service -------------------------------------------------------------------

    def run(self, stop: threading.Event) -> None:
        """Boucle du service : jusqu'à l'arrêt demandé, sans jamais s'interrompre sur erreur."""
        log.info("Agent démarré")
        next_config = next_collect = next_sync = next_purge = 0.0
        next_discovery = time.time() + 60
        while not stop.is_set():
            now = time.time()
            try:
                self.reload()
                if not self.settings.enrolled or self.store.get("unauthorized"):
                    stop.wait(10)
                    continue
                if now >= next_config:
                    self._guard(self.refresh_configuration)
                    next_config = now + CONFIG_INTERVAL
                if now >= next_collect:
                    self._guard(self.collect_once)
                    next_collect = now + self.settings.collect_interval
                    next_sync = now
                if self.settings.discovery_ranges and now >= next_discovery:
                    self._guard(self.discover_once)
                    next_discovery = now + self.settings.discovery_interval
                    next_sync = now
                if now >= next_sync:
                    self._guard(self.sync_once)
                    next_sync = now + SYNC_INTERVAL
                if now >= next_purge:
                    self.store.purge()
                    next_purge = now + PURGE_INTERVAL
            except Exception:  # noqa: BLE001 - le service ne doit jamais s'arrêter seul
                log.exception("Erreur inattendue dans la boucle de l'agent")
            stop.wait(1)
        log.info("Agent arrêté")

    def _guard(self, action: Any) -> None:
        try:
            with self._lock:
                action()
        except AgentUnauthorized as error:
            log.error("Agent refusé par le serveur : %s", error)

    # -- État ----------------------------------------------------------------------------------

    def status(self) -> Status:
        settings = self.settings
        counts = self.store.counts()
        return Status(
            enrolled=settings.enrolled,
            unauthorized=bool(self.store.get("unauthorized")),
            server_url=settings.server_url,
            agent_name=settings.agent_name,
            agent_id=settings.agent_id,
            tenant_id=settings.tenant_id,
            collect_interval=settings.collect_interval,
            discovery_ranges=list(settings.discovery_ranges),
            printers=len(self.targets()),
            configuration_at=self.store.get("configuration_at"),
            last_collect_at=self.store.get("last_collect_at"),
            last_discovery_at=self.store.get("last_discovery_at"),
            last_sync_at=self.store.get("last_sync_at"),
            last_sync_error=self.store.get("last_sync_error"),
            pending=counts["pending"],
            accepted=counts["accepted"],
            duplicates=counts["duplicate"],
            rejected=counts["rejected"],
            oldest_pending_at=self.store.oldest_pending(),
        )

    def settings_for_update(self) -> AgentSettings:
        return self.config.load()
