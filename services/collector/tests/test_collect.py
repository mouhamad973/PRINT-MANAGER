"""Collecte réelle contre le simulateur SNMP : de vraies requêtes UDP, de vraies réponses."""

from __future__ import annotations

import asyncio
import uuid

import pytest

from arksen_collector.collect import PrinterTarget, collect_printer, discover, probe
from arksen_collector.snmp import SnmpAuthError, SnmpCredentials, SnmpSession, SnmpTimeout
from tests.conftest import V3_AUTH, V3_PRIV, V3_USER, SimulatedNetwork
from tests.snmpdata.generate import BLACK_OID, COLOR_OID

TOTAL_OID = "1.3.6.1.2.1.43.10.2.1.4.1.1"
AGENT = str(uuid.uuid4())


def target(
    network: SimulatedNetwork,
    *,
    community: str = "public",
    color: bool = True,
    vendor_counters: bool = True,
    **snmp: object,
) -> PrinterTarget:
    return PrinterTarget(
        id=str(uuid.uuid4()),
        name="Machine de test",
        host=network.host,
        color=color,
        credentials=SnmpCredentials(port=network.port, community=community, **snmp),  # type: ignore[arg-type]
        total_oid=TOTAL_OID,
        black_oid=BLACK_OID if vendor_counters else None,
        color_oid=COLOR_OID if vendor_counters and color else None,
    )


def test_collects_counters_status_and_supply_levels(snmp_network: SimulatedNetwork) -> None:
    printer = target(snmp_network)
    result = asyncio.run(collect_printer(printer, AGENT, timeout=1))

    assert result.ok
    status, reading = result.events
    assert status["type"] == "printer.status"
    assert status["printerId"] == printer.id
    assert status["agentId"] == AGENT
    payload = status["payload"]
    assert payload["reachable"] is True
    assert payload["deviceStatus"] == "warning"
    assert payload["printerStatus"] == "idle"
    assert payload["alerts"] == ["lowToner"]
    assert payload["serialNumber"] == "SIMCOL0001"
    assert payload["totalCount"] == 152340
    levels = {supply["description"]: supply for supply in payload["supplies"]}
    assert levels["Cyan Toner Cartridge"]["channel"] == "CYAN"
    assert levels["Cyan Toner Cartridge"]["levelPercent"] == 64.0
    assert levels["Black Toner Cartridge"]["levelPercent"] == 41.0
    assert levels["Yellow Toner Cartridge"]["levelPercent"] is None
    assert levels["Waste Toner Box"]["channel"] is None
    assert levels["Fuser Unit"]["levelPercent"] == 72.0

    assert reading["type"] == "meter.reading"
    assert reading["payload"] == {"totalCount": 152340, "blackCount": 98340, "colorCount": 54000}
    assert reading["occurredAt"] == status["occurredAt"]
    assert result.reading is not None
    assert result.reading["event_id"] == reading["id"]


def test_monochrome_printer_reads_the_standard_total(snmp_network: SimulatedNetwork) -> None:
    printer = target(snmp_network, community="mono", color=False, vendor_counters=False)
    result = asyncio.run(collect_printer(printer, AGENT, timeout=1))
    assert result.ok
    reading = result.events[1]
    assert reading["payload"] == {"totalCount": 48210, "blackCount": None, "colorCount": None}
    assert result.events[0]["payload"]["printerStatus"] == "printing"


def test_color_printer_without_vendor_counters_gives_no_reading(
    snmp_network: SimulatedNetwork,
) -> None:
    # Le total seul ne dit pas combien de pages couleur : aucun relevé n'est inventé.
    printer = target(snmp_network, vendor_counters=False)
    result = asyncio.run(collect_printer(printer, AGENT, timeout=1))
    assert result.ok
    assert [event["type"] for event in result.events] == ["printer.status"]
    assert result.reading is None


def test_unreachable_printer_is_reported_without_reading(snmp_network: SimulatedNetwork) -> None:
    # Communauté inconnue : en SNMPv2c, la machine ne répond simplement pas.
    printer = target(snmp_network, community="mauvaise")
    result = asyncio.run(collect_printer(printer, AGENT, timeout=0.5, retries=0))
    assert not result.ok
    assert result.error and "Pas de réponse SNMP" in result.error
    [event] = result.events
    assert event["payload"]["reachable"] is False
    assert event["payload"]["error"] == result.error
    assert result.reading is None


def test_snmpv3_with_authentication_and_privacy(snmp_network: SimulatedNetwork) -> None:
    printer = target(
        snmp_network,
        community=None,  # type: ignore[arg-type]
        version="V3",
        context_name="public",
        username=V3_USER,
        security_level="AUTH_PRIV",
        auth_protocol="SHA",
        auth_password=V3_AUTH,
        priv_protocol="AES128",
        priv_password=V3_PRIV,
    )
    result = asyncio.run(collect_printer(printer, AGENT, timeout=1))
    assert result.ok
    assert result.events[1]["payload"]["blackCount"] == 98340


def test_snmpv3_wrong_password_is_an_explicit_error(snmp_network: SimulatedNetwork) -> None:
    credentials = SnmpCredentials(
        version="V3",
        port=snmp_network.port,
        community=None,
        context_name="public",
        username=V3_USER,
        security_level="AUTH_PRIV",
        auth_protocol="SHA",
        auth_password="mauvais-mot-de-passe",
        priv_protocol="AES128",
        priv_password=V3_PRIV,
    )

    async def query() -> None:
        async with SnmpSession(snmp_network.host, credentials, timeout=1, retries=0) as session:
            await session.get([TOTAL_OID])

    with pytest.raises((SnmpAuthError, SnmpTimeout)):
        asyncio.run(query())


def test_snmpv1_is_supported(snmp_network: SimulatedNetwork) -> None:
    printer = target(
        snmp_network, community="mono", color=False, vendor_counters=False, version="V1"
    )
    result = asyncio.run(collect_printer(printer, AGENT, timeout=1))
    assert result.ok
    assert result.events[1]["payload"]["totalCount"] == 48210


def test_discovery_keeps_printers_and_ignores_other_devices(
    snmp_network: SimulatedNetwork,
) -> None:
    found = asyncio.run(probe(snmp_network.host, ["mauvaise", "public"], port=snmp_network.port))
    assert found == {
        "ipAddress": "127.0.0.1",
        "serialNumber": "SIMCOL0001",
        "sysName": "SIM-COULEUR-01",
        "description": "Multifonction couleur A3 (test)",
        "macAddress": "00:11:22:AA:BB:CC",
    }
    # Un commutateur répond en SNMP mais n'est pas une imprimante.
    assert asyncio.run(probe(snmp_network.host, ["switch"], port=snmp_network.port)) is None

    events = asyncio.run(
        discover(["127.0.0.1"], ["public"], AGENT, port=snmp_network.port, timeout=1)
    )
    assert len(events) == 1
    assert events[0]["type"] == "device.discovered"
    assert events[0]["printerId"] is None
    assert events[0]["payload"]["serialNumber"] == "SIMCOL0001"
