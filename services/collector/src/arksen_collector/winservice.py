"""Service Windows « ArksenCollector » (pywin32) : démarre avec le système, sans session ouverte."""

from __future__ import annotations

import logging
import threading
from logging.handlers import RotatingFileHandler
from typing import Any

import servicemanager
import win32event
import win32service
import win32serviceutil

from arksen_collector.agent import Agent
from arksen_collector.config import ConfigStore
from arksen_collector.webui import LocalUi

SERVICE_NAME = "ArksenCollector"


def configure_logging(store: ConfigStore) -> None:
    store.home.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        store.home / "collector.log", maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s : %(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)


class CollectorService(win32serviceutil.ServiceFramework):  # type: ignore[misc]
    _svc_name_ = SERVICE_NAME
    _svc_display_name_ = "ARKSEN Collector"
    _svc_description_ = (
        "Collecte SNMP des imprimantes, stockage local et synchronisation "
        "avec ARKSEN PRINT MANAGER."
    )

    def __init__(self, args: Any) -> None:
        super().__init__(args)
        self._stop_event = win32event.CreateEvent(None, 0, 0, None)
        self._stop = threading.Event()

    def SvcStop(self) -> None:  # noqa: N802 - API pywin32
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        self._stop.set()
        win32event.SetEvent(self._stop_event)

    def SvcDoRun(self) -> None:  # noqa: N802 - API pywin32
        servicemanager.LogMsg(
            servicemanager.EVENTLOG_INFORMATION_TYPE,
            servicemanager.PYS_SERVICE_STARTED,
            (self._svc_name_, ""),
        )
        store = ConfigStore()
        configure_logging(store)
        agent = Agent(store)
        ui = LocalUi(agent)
        try:
            ui.start()
        except OSError:
            logging.getLogger("arksen_collector").exception("Interface locale indisponible")
        try:
            agent.run(self._stop)
        finally:
            ui.stop()


def handle_command_line(argv: list[str]) -> None:
    """`install`, `start`, `stop`, `remove`… comme tout service pywin32."""
    win32serviceutil.HandleCommandLine(CollectorService, argv=["arksen-collector", *argv])


def run_as_service() -> None:
    """Point d'entrée quand le gestionnaire de services lance l'exécutable sans argument."""
    servicemanager.Initialize()
    servicemanager.PrepareToHostSingle(CollectorService)
    servicemanager.StartServiceCtrlDispatcher()
