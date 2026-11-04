"""Génère les jeux de données du simulateur SNMP (snmpsim) utilisés par les tests.

Ce sont des équipements de TEST : leurs descriptions le disent, et leurs OID constructeur
sont pris sous l'entreprise fictive 99999. Le fichier `<communauté>.snmprec` répond à la
communauté de même nom. Usage : `python tests/snmpdata/generate.py`.
"""

from __future__ import annotations

from pathlib import Path

HERE = Path(__file__).parent
VENDOR = "1.3.6.1.4.1.99999"
BLACK_OID = f"{VENDOR}.2.1.0"
COLOR_OID = f"{VENDOR}.2.2.0"

STRING, INTEGER, OID, COUNTER32, HEX = "4", "2", "6", "65", "4x"


def printer(
    *,
    name: str,
    description: str,
    serial: str,
    life_count: int,
    device_status: int,
    printer_status: int,
    error_state_hex: str,
    supplies: list[tuple[int, int, str, int, int]],
    colorants: list[str],
    vendor_counters: tuple[int, int] | None,
    mac_hex: str,
) -> dict[str, tuple[str, str]]:
    records: dict[str, tuple[str, str]] = {
        "1.3.6.1.2.1.1.1.0": (STRING, f"ARKSEN simulateur SNMP (test) - {description}"),
        "1.3.6.1.2.1.1.2.0": (OID, f"{VENDOR}.1"),
        "1.3.6.1.2.1.1.5.0": (STRING, name),
        "1.3.6.1.2.1.2.2.1.6.1": (HEX, mac_hex),
        "1.3.6.1.2.1.25.3.2.1.2.1": (OID, "1.3.6.1.2.1.25.3.1.5"),
        "1.3.6.1.2.1.25.3.2.1.3.1": (STRING, description),
        "1.3.6.1.2.1.25.3.2.1.5.1": (INTEGER, str(device_status)),
        "1.3.6.1.2.1.25.3.5.1.1.1": (INTEGER, str(printer_status)),
        "1.3.6.1.2.1.25.3.5.1.2.1": (HEX, error_state_hex),
        "1.3.6.1.2.1.43.5.1.1.17.1": (STRING, serial),
        "1.3.6.1.2.1.43.10.2.1.4.1.1": (COUNTER32, str(life_count)),
    }
    for index, (colorant, kind, label, capacity, level) in enumerate(supplies, start=1):
        base = "1.3.6.1.2.1.43.11.1.1"
        records[f"{base}.3.1.{index}"] = (INTEGER, str(colorant))
        records[f"{base}.5.1.{index}"] = (INTEGER, str(kind))
        records[f"{base}.6.1.{index}"] = (STRING, label)
        records[f"{base}.8.1.{index}"] = (INTEGER, str(capacity))
        records[f"{base}.9.1.{index}"] = (INTEGER, str(level))
    for position, name in enumerate(colorants, start=1):
        records[f"1.3.6.1.2.1.43.12.1.1.4.1.{position}"] = (STRING, name)
    if vendor_counters:
        records[BLACK_OID] = (COUNTER32, str(vendor_counters[0]))
        records[COLOR_OID] = (COUNTER32, str(vendor_counters[1]))
    return records


DATASETS = {
    # Multifonction couleur : alerte « toner bientôt épuisé » (bit 2), compteurs constructeur.
    "public": printer(
        name="SIM-COULEUR-01",
        description="Multifonction couleur A3 (test)",
        serial="SIMCOL0001",
        life_count=152340,
        device_status=3,
        printer_status=3,
        error_state_hex="2000",
        supplies=[
            (1, 21, "Cyan Toner Cartridge", 100, 64),
            (2, 21, "Magenta Toner Cartridge", 100, 12),
            (3, 21, "Yellow Toner Cartridge", 100, -3),
            (4, 21, "Black Toner Cartridge", 20000, 8200),
            (0, 4, "Waste Toner Box", -2, -3),
            (0, 15, "Fuser Unit", 100000, 72000),
        ],
        colorants=["cyan", "magenta", "yellow", "black"],
        vendor_counters=(98340, 54000),
        mac_hex="001122AABBCC",
    ),
    # Imprimante noir et blanc : compteur total de la Printer-MIB seulement.
    "mono": printer(
        name="SIM-MONO-01",
        description="Imprimante noir et blanc A4 (test)",
        serial="SIMMONO001",
        life_count=48210,
        device_status=2,
        printer_status=4,
        error_state_hex="0000",
        supplies=[(1, 3, "Toner noir", 100, 80)],
        colorants=["black"],
        vendor_counters=None,
        mac_hex="001122AABBDD",
    ),
}

#: Équipement qui répond en SNMP mais n'est pas une imprimante.
SWITCH = {
    "1.3.6.1.2.1.1.1.0": (STRING, "ARKSEN simulateur SNMP (test) - commutateur réseau"),
    "1.3.6.1.2.1.1.2.0": (OID, f"{VENDOR}.9"),
    "1.3.6.1.2.1.1.5.0": (STRING, "SIM-SWITCH-01"),
}


def sort_key(oid: str) -> tuple[int, ...]:
    return tuple(int(part) for part in oid.split("."))


def write(name: str, records: dict[str, tuple[str, str]]) -> None:
    # snmpsim exige des OID triés dans l'ordre SNMP (numérique) pour parcourir les tables.
    lines = [
        f"{oid}|{tag}|{value}"
        for oid, (tag, value) in sorted(records.items(), key=lambda item: sort_key(item[0]))
    ]
    (HERE / f"{name}.snmprec").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    for community, records in DATASETS.items():
        write(community, records)
    write("switch", SWITCH)
