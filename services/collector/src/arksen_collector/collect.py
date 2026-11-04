"""Collecte d'une machine et découverte réseau : transforme les réponses SNMP en événements."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from arksen_collector import printer_mib as mib
from arksen_collector.config import expand_range
from arksen_collector.snmp import SnmpCredentials, SnmpError, SnmpSession, SnmpTimeout

#: Requêtes SNMP simultanées : assez pour un grand parc, sans saturer le réseau.
CONCURRENCY = 16
DISCOVERY_CONCURRENCY = 64


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_id() -> str:
    return str(uuid.uuid4())


@dataclass
class PrinterTarget:
    """Machine à interroger, telle que la décrit la configuration reçue du serveur."""

    id: str
    name: str
    host: str
    color: bool
    credentials: SnmpCredentials
    total_oid: str
    black_oid: str | None = None
    color_oid: str | None = None

    @classmethod
    def from_config(cls, item: dict[str, Any]) -> PrinterTarget:
        snmp = item["snmp"]
        counters = item["counters"]
        return cls(
            id=item["id"],
            name=item["name"],
            host=item["host"],
            color=item["colorMode"] == "COLOR",
            credentials=SnmpCredentials(
                version=snmp["version"],
                port=snmp["port"],
                community=snmp.get("community"),
                username=snmp.get("username"),
                security_level=snmp.get("securityLevel"),
                auth_protocol=snmp.get("authProtocol"),
                auth_password=snmp.get("authPassword"),
                priv_protocol=snmp.get("privProtocol"),
                priv_password=snmp.get("privPassword"),
            ),
            total_oid=counters["totalOid"],
            black_oid=counters.get("blackOid"),
            color_oid=counters.get("colorOid"),
        )


@dataclass
class CollectResult:
    printer: PrinterTarget
    ok: bool
    error: str | None
    events: list[dict[str, Any]] = field(default_factory=list)
    reading: dict[str, Any] | None = None


async def collect_printer(
    target: PrinterTarget, agent_id: str, *, timeout: float = 2.0, retries: int = 1
) -> CollectResult:
    """Interroge une machine. Une machine injoignable produit un état « injoignable », jamais
    un relevé inventé."""
    occurred_at = now_iso()

    def status_event(payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": new_id(),
            "type": "printer.status",
            "printerId": target.id,
            "agentId": agent_id,
            "occurredAt": occurred_at,
            "payload": payload,
        }

    try:
        async with SnmpSession(
            target.host, target.credentials, timeout=timeout, retries=retries
        ) as session:
            counter_oids = [target.total_oid]
            if target.black_oid:
                counter_oids.append(target.black_oid)
            if target.color and target.color_oid:
                counter_oids.append(target.color_oid)
            values = await session.get(
                [
                    mib.SYS_DESCR,
                    mib.HR_DEVICE_DESCR,
                    mib.HR_DEVICE_STATUS,
                    mib.HR_PRINTER_STATUS,
                    mib.HR_PRINTER_ERROR_STATE,
                    mib.PRT_SERIAL_NUMBER,
                    *counter_oids,
                ]
            )
            try:
                supplies = mib.parse_supplies(
                    await session.walk(mib.SUPPLIES_TABLE),
                    await session.walk(mib.COLORANT_VALUE),
                )
            except SnmpTimeout:
                raise
            except SnmpError:
                # Table des consommables absente : l'état reste utile sans les niveaux.
                supplies = []
    except SnmpError as error:
        message = str(error)
        return CollectResult(
            target,
            ok=False,
            error=message,
            events=[
                status_event({"reachable": False, "error": message, "alerts": [], "supplies": []})
            ],
        )

    total = mib.integer(values.get(target.total_oid))
    black = mib.integer(values.get(target.black_oid)) if target.black_oid else None
    color = mib.integer(values.get(target.color_oid)) if target.color and target.color_oid else None

    events = [
        status_event(
            {
                "reachable": True,
                "error": None,
                "deviceStatus": mib.DEVICE_STATUSES.get(
                    mib.integer(values.get(mib.HR_DEVICE_STATUS)) or 0
                ),
                "printerStatus": mib.PRINTER_STATUSES.get(
                    mib.integer(values.get(mib.HR_PRINTER_STATUS)) or 0
                ),
                "alerts": mib.decode_alerts(values.get(mib.HR_PRINTER_ERROR_STATE)),
                "supplies": [supply.to_payload() for supply in supplies],
                "totalCount": total,
                "serialNumber": mib.text(values.get(mib.PRT_SERIAL_NUMBER)),
                "description": (
                    mib.text(values.get(mib.HR_DEVICE_DESCR)) or mib.text(values.get(mib.SYS_DESCR))
                ),
            }
        )
    ]

    # Un relevé n'est produit que si les compteurs nécessaires ont été lus : le total pour
    # une machine noir et blanc, le noir et la couleur pour une machine couleur.
    reading: dict[str, Any] | None = None
    has_counters = (
        (black is not None and color is not None)
        if target.color
        else (black is not None or total is not None)
    )
    if has_counters:
        payload = {"totalCount": total, "blackCount": black, "colorCount": color}
        event = {
            "id": new_id(),
            "type": "meter.reading",
            "printerId": target.id,
            "agentId": agent_id,
            "occurredAt": occurred_at,
            "payload": payload,
        }
        events.append(event)
        reading = {"event_id": event["id"], "read_at": occurred_at, **payload}
    return CollectResult(target, ok=True, error=None, events=events, reading=reading)


async def collect_all(
    targets: Sequence[PrinterTarget], agent_id: str, *, timeout: float = 2.0, retries: int = 1
) -> list[CollectResult]:
    semaphore = asyncio.Semaphore(CONCURRENCY)

    async def run(target: PrinterTarget) -> CollectResult:
        async with semaphore:
            return await collect_printer(target, agent_id, timeout=timeout, retries=retries)

    return list(await asyncio.gather(*(run(target) for target in targets)))


async def probe(
    host: str, communities: Sequence[str], *, port: int = 161, timeout: float = 1.0
) -> dict[str, Any] | None:
    """Identifie un équipement : `None` s'il ne répond pas ou n'est pas une imprimante."""
    for community in communities:
        credentials = SnmpCredentials(version="V2C", port=port, community=community)
        try:
            async with SnmpSession(host, credentials, timeout=timeout, retries=0) as session:
                values = await session.get(
                    [
                        mib.SYS_DESCR,
                        mib.SYS_NAME,
                        mib.HR_DEVICE_TYPE,
                        mib.HR_DEVICE_DESCR,
                        mib.PRT_SERIAL_NUMBER,
                    ]
                )
                if values.get(mib.SYS_DESCR) is None:
                    continue
                found = mib.identity(values)
                if not found.is_printer:
                    return None
                mac = None
                try:
                    for _, value in await session.walk(mib.IF_PHYS_ADDRESS, limit=16):
                        mac = mib.mac_address(value)
                        if mac:
                            break
                except SnmpError:
                    pass
                return {
                    "ipAddress": host,
                    "serialNumber": found.serial_number,
                    "sysName": found.sys_name,
                    "description": found.description,
                    "macAddress": mac,
                }
        except SnmpTimeout:
            continue
        except SnmpError:
            continue
    return None


async def discover(
    ranges: Sequence[str],
    communities: Sequence[str],
    agent_id: str,
    *,
    port: int = 161,
    timeout: float = 1.0,
) -> list[dict[str, Any]]:
    """Explore des plages d'adresses et produit un événement par imprimante trouvée."""
    hosts = sorted({host for item in ranges for host in expand_range(item)})
    semaphore = asyncio.Semaphore(DISCOVERY_CONCURRENCY)

    async def run(host: str) -> dict[str, Any] | None:
        async with semaphore:
            return await probe(host, communities, port=port, timeout=timeout)

    found = [item for item in await asyncio.gather(*(run(host) for host in hosts)) if item]
    occurred_at = now_iso()
    return [
        {
            "id": new_id(),
            "type": "device.discovered",
            "printerId": None,
            "agentId": agent_id,
            "occurredAt": occurred_at,
            "payload": payload,
        }
        for payload in found
    ]
