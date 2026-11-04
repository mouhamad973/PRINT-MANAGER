"""Parcours complet : enregistrement, configuration, collecte SNMP réelle sur le simulateur,
fonctionnement hors ligne et synchronisation à la reprise."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import httpx

from arksen_collector.agent import Agent
from arksen_collector.config import ConfigStore
from tests.conftest import SimulatedNetwork
from tests.fake_server import FakeServer
from tests.snmpdata.generate import BLACK_OID, COLOR_OID

TOTAL_OID = "1.3.6.1.2.1.43.10.2.1.4.1.1"


def printer_config(network: SimulatedNetwork, community: str, color: bool) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "name": f"Simulateur {community}",
        "serialNumber": "SIM",
        "colorMode": "COLOR" if color else "MONOCHROME",
        "host": network.host,
        "snmp": {
            "version": "V2C",
            "port": network.port,
            "community": community,
            "username": None,
            "securityLevel": None,
            "authProtocol": None,
            "authPassword": None,
            "privProtocol": None,
            "privPassword": None,
        },
        "counters": {
            "totalOid": TOTAL_OID,
            "blackOid": BLACK_OID if color else None,
            "colorOid": COLOR_OID if color else None,
        },
    }


def test_full_cycle_with_an_offline_period(tmp_path: Path, snmp_network: SimulatedNetwork) -> None:
    server = FakeServer(
        printers=[
            printer_config(snmp_network, "public", color=True),
            printer_config(snmp_network, "mono", color=False),
            printer_config(snmp_network, "mauvaise", color=False),
        ]
    )
    agent = Agent(
        ConfigStore(tmp_path / "home"),
        transport=server.transport(),
        # Large : la machine de test peut être chargée ; la mauvaise communauté expire quand même.
        snmp_timeout=2,
        snmp_retries=0,
    )
    agent.enroll("http://localhost:3000", server.code)
    assert agent.refresh_configuration()
    assert len(agent.targets()) == 3

    # Internet coupé : la configuration en cache suffit pour collecter.
    def offline(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("réseau indisponible", request=request)

    server.failure = offline
    assert agent.collect_once() == 2
    report = agent.sync_once()
    assert report.error
    # 3 états (dont un « injoignable ») et 2 relevés : tous conservés localement.
    assert agent.store.counts()["pending"] == 5
    readings = {reading.total_count: reading for reading in agent.store.readings()}
    assert readings[152340].black_count == 98340
    assert readings[48210].black_count is None
    runs = {run["name"]: run for run in agent.store.printer_runs()}
    assert runs["Simulateur mauvaise"]["last_error"]
    assert runs["Simulateur public"]["last_error"] is None

    # Retour du réseau : tout part, une seule fois.
    agent.store.retry_now()
    report = agent.sync_once()
    assert (report.sent, report.accepted) == (5, 5)
    types = sorted(event["type"] for event in server.received.values())
    assert types == ["meter.reading"] * 2 + ["printer.status"] * 3
    status = agent.status()
    assert status.pending == 0 and status.accepted == 5 and status.printers == 3
