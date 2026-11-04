"""Lecture des informations standard d'une imprimante : MIB-II, Host Resources (RFC 2790)
et Printer-MIB (RFC 3805).

Seuls des OID normalisés sont lus ici. Les compteurs noir et couleur, propres à chaque
constructeur, viennent de la fiche technique du modèle (configuration reçue du serveur).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from arksen_collector.snmp import SnmpValue

SYS_DESCR = "1.3.6.1.2.1.1.1.0"
SYS_OBJECT_ID = "1.3.6.1.2.1.1.2.0"
SYS_NAME = "1.3.6.1.2.1.1.5.0"
HR_DEVICE_TYPE = "1.3.6.1.2.1.25.3.2.1.2.1"
HR_DEVICE_DESCR = "1.3.6.1.2.1.25.3.2.1.3.1"
HR_DEVICE_STATUS = "1.3.6.1.2.1.25.3.2.1.5.1"
HR_PRINTER_STATUS = "1.3.6.1.2.1.25.3.5.1.1.1"
HR_PRINTER_ERROR_STATE = "1.3.6.1.2.1.25.3.5.1.2.1"
PRT_SERIAL_NUMBER = "1.3.6.1.2.1.43.5.1.1.17.1"
PRT_MARKER_LIFE_COUNT = "1.3.6.1.2.1.43.10.2.1.4.1.1"
IF_PHYS_ADDRESS = "1.3.6.1.2.1.2.2.1.6"
SUPPLIES_TABLE = "1.3.6.1.2.1.43.11.1.1"
COLORANT_VALUE = "1.3.6.1.2.1.43.12.1.1.4"
#: hrDevicePrinter : valeur de hrDeviceType d'une imprimante.
HR_DEVICE_PRINTER = "1.3.6.1.2.1.25.3.1.5"

DEVICE_STATUSES = {1: "unknown", 2: "running", 3: "warning", 4: "testing", 5: "down"}
PRINTER_STATUSES = {1: "other", 2: "unknown", 3: "idle", 4: "printing", 5: "warmup"}

#: Bits de hrPrinterDetectedErrorState, du bit de poids fort du premier octet au suivant.
ALERT_BITS = (
    "lowPaper",
    "noPaper",
    "lowToner",
    "noToner",
    "doorOpen",
    "jammed",
    "offline",
    "serviceRequested",
    "inputTrayMissing",
    "outputTrayMissing",
    "markerSupplyMissing",
    "outputNearFull",
    "outputFull",
    "inputTrayEmpty",
    "overduePreventMaint",
)

#: PrtMarkerSuppliesTypeTC (RFC 3805).
SUPPLY_KINDS = {
    1: "other",
    2: "unknown",
    3: "toner",
    4: "wasteToner",
    5: "ink",
    6: "inkCartridge",
    7: "inkRibbon",
    8: "wasteInk",
    9: "opc",
    10: "developer",
    11: "fuserOil",
    12: "solidWax",
    13: "ribbonWax",
    14: "wasteWax",
    15: "fuser",
    16: "coronaWire",
    17: "fuserOilWick",
    18: "cleanerUnit",
    19: "fuserCleaningPad",
    20: "transferUnit",
    21: "tonerCartridge",
    22: "fuserOiler",
}
#: Consommables d'encre ou de toner, rattachables à un canal CMJN.
MARKER_KINDS = {"toner", "ink", "inkCartridge", "tonerCartridge", "solidWax"}

_CHANNEL_WORDS = {
    "CYAN": ("cyan",),
    "MAGENTA": ("magenta",),
    "YELLOW": ("yellow", "jaune", "gelb"),
    "BLACK": ("black", "noir", "schwarz", "mono"),
}


def text(value: SnmpValue) -> str | None:
    """Chaîne lisible d'une OCTET STRING : UTF-8, sinon Latin-1, sans caractères de contrôle."""
    if value is None:
        return None
    if isinstance(value, bytes):
        try:
            decoded = value.decode("utf-8")
        except UnicodeDecodeError:
            decoded = value.decode("latin-1")
    else:
        decoded = str(value)
    cleaned = "".join(char for char in decoded if char.isprintable()).strip()
    return cleaned or None


def integer(value: SnmpValue) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def mac_address(value: SnmpValue) -> str | None:
    if isinstance(value, bytes) and len(value) == 6 and any(value):
        return ":".join(f"{byte:02X}" for byte in value)
    return None


def decode_alerts(value: SnmpValue) -> list[str]:
    """Alertes actives de hrPrinterDetectedErrorState (chaîne de bits)."""
    if not isinstance(value, bytes):
        return []
    alerts = []
    for position, name in enumerate(ALERT_BITS):
        byte_index, bit = divmod(position, 8)
        if byte_index < len(value) and value[byte_index] & (0x80 >> bit):
            alerts.append(name)
    return alerts


def channel_of(colorant: str | None, description: str | None) -> str | None:
    """Canal CMJN d'après le nom du colorant, sinon d'après la description du consommable."""
    for source in (colorant, description):
        if not source:
            continue
        lowered = source.lower()
        for channel, words in _CHANNEL_WORDS.items():
            if any(word in lowered for word in words):
                return channel
    return None


def level_percent(level: int | None, capacity: int | None) -> float | None:
    """Niveau en % de la capacité. Les valeurs négatives de la Printer-MIB signifient :
    -1 « autre », -2 « inconnu », -3 « il en reste » : aucun pourcentage n'en est tiré."""
    if level is None or capacity is None or level < 0 or capacity <= 0:
        return None
    return round(min(level, capacity) * 100 / capacity, 1)


@dataclass
class Supply:
    index: int
    description: str
    kind: str
    channel: str | None
    level_percent: float | None

    def to_payload(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "description": self.description,
            "kind": self.kind,
            "channel": self.channel,
            "levelPercent": self.level_percent,
        }


def parse_supplies(
    rows: list[tuple[str, SnmpValue]], colorants: list[tuple[str, SnmpValue]]
) -> list[Supply]:
    """Consommables de prtMarkerSuppliesTable, avec leur canal CMJN quand il est reconnu."""
    columns: dict[int, dict[int, SnmpValue]] = {}
    prefix = SUPPLIES_TABLE + "."
    for oid, value in rows:
        parts = oid[len(prefix) :].split(".")
        if len(parts) < 3:
            continue
        column, index = int(parts[0]), int(parts[-1])
        columns.setdefault(index, {})[column] = value

    colorant_names: dict[int, str | None] = {}
    for oid, value in colorants:
        colorant_names[int(oid.rsplit(".", 1)[-1])] = text(value)

    supplies = []
    for index in sorted(columns):
        row = columns[index]
        description = text(row.get(6)) or f"Consommable {index}"
        kind = SUPPLY_KINDS.get(integer(row.get(5)) or 2, "unknown")
        colorant = colorant_names.get(integer(row.get(3)) or 0)
        channel = channel_of(colorant, description) if kind in MARKER_KINDS else None
        supplies.append(
            Supply(
                index=index,
                description=description[:200],
                kind=kind,
                channel=channel,
                level_percent=level_percent(integer(row.get(9)), integer(row.get(8))),
            )
        )
    return supplies


@dataclass
class DeviceIdentity:
    description: str | None = None
    sys_name: str | None = None
    serial_number: str | None = None
    is_printer: bool = False
    mac_address: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def identity(values: dict[str, SnmpValue]) -> DeviceIdentity:
    device_type = values.get(HR_DEVICE_TYPE)
    serial = text(values.get(PRT_SERIAL_NUMBER))
    return DeviceIdentity(
        description=text(values.get(HR_DEVICE_DESCR)) or text(values.get(SYS_DESCR)),
        sys_name=text(values.get(SYS_NAME)),
        serial_number=serial,
        is_printer=device_type == HR_DEVICE_PRINTER or serial is not None,
    )
