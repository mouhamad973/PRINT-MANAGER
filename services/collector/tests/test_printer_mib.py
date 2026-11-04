from arksen_collector import printer_mib as mib
from arksen_collector.snmp import SnmpValue


def test_alerts_are_read_from_the_most_significant_bit() -> None:
    # 0x20 : troisième bit du premier octet, « lowToner » ; 0x04 : « jammed » (bit 5).
    assert mib.decode_alerts(bytes([0x20])) == ["lowToner"]
    assert mib.decode_alerts(bytes([0x24])) == ["lowToner", "jammed"]
    # Second octet : 0x80 est « inputTrayMissing » (bit 8).
    assert mib.decode_alerts(bytes([0x00, 0x80])) == ["inputTrayMissing"]
    assert mib.decode_alerts(bytes([0x00, 0x00])) == []
    assert mib.decode_alerts(None) == []


def test_levels_only_become_percentages_when_the_printer_gives_both_values() -> None:
    assert mib.level_percent(8200, 20000) == 41.0
    assert mib.level_percent(0, 100) == 0.0
    # Valeurs réservées de la Printer-MIB : -3 « il en reste », -2 « inconnu », -1 « autre ».
    assert mib.level_percent(-3, 100) is None
    assert mib.level_percent(50, -2) is None
    assert mib.level_percent(None, 100) is None
    # Un niveau supérieur à la capacité est borné à 100 %.
    assert mib.level_percent(120, 100) == 100.0


def test_channel_is_recognised_from_the_colorant_then_the_description() -> None:
    assert mib.channel_of("cyan", "Toner A") == "CYAN"
    assert mib.channel_of(None, "Black Toner Cartridge") == "BLACK"
    assert mib.channel_of(None, "Toner noir") == "BLACK"
    assert mib.channel_of(None, "Cartouche jaune") == "YELLOW"
    assert mib.channel_of(None, "Fuser") is None


def test_supplies_table_is_parsed_by_column() -> None:
    base = mib.SUPPLIES_TABLE
    rows: list[tuple[str, SnmpValue]] = [
        (f"{base}.3.1.1", 1),
        (f"{base}.3.1.2", 0),
        (f"{base}.5.1.1", 21),
        (f"{base}.5.1.2", 4),
        (f"{base}.6.1.1", b"Toner A"),
        (f"{base}.6.1.2", b"Waste Toner Box"),
        (f"{base}.8.1.1", 100),
        (f"{base}.8.1.2", -2),
        (f"{base}.9.1.1", 37),
        (f"{base}.9.1.2", -3),
    ]
    colorants: list[tuple[str, SnmpValue]] = [(f"{mib.COLORANT_VALUE}.1.1", b"magenta")]
    supplies = mib.parse_supplies(rows, colorants)
    assert [supply.to_payload() for supply in supplies] == [
        {
            "index": 1,
            "description": "Toner A",
            "kind": "tonerCartridge",
            "channel": "MAGENTA",
            "levelPercent": 37.0,
        },
        # Le bac de récupération n'est pas un toner : aucun canal, niveau inconnu.
        {
            "index": 2,
            "description": "Waste Toner Box",
            "kind": "wasteToner",
            "channel": None,
            "levelPercent": None,
        },
    ]


def test_text_values_are_cleaned() -> None:
    assert mib.text(b"SIMCOL0001\x00") == "SIMCOL0001"
    assert mib.text("Imprimante d\xe9mo".encode("latin-1")) == "Imprimante démo"
    assert mib.text(b"") is None
    assert mib.mac_address(bytes.fromhex("001122AABBCC")) == "00:11:22:AA:BB:CC"
    assert mib.mac_address(bytes(6)) is None
