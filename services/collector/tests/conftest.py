"""Simulateur SNMP pour les tests : un vrai répondeur SNMP (snmpsim) sur la boucle locale.

Il sert les équipements de test de `tests/snmpdata` : chaque fichier répond à la communauté
de même nom (`public` : multifonction couleur, `mono` : noir et blanc, `switch` : un
commutateur). Aucune donnée de collecte n'est inventée par les tests : l'agent interroge ce
répondeur exactement comme une vraie imprimante.
"""

from __future__ import annotations

import asyncio
import shutil
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest

from arksen_collector.snmp import SnmpCredentials, SnmpError, SnmpSession

DATA_DIR = Path(__file__).parent / "snmpdata"
V3_USER = "arksen-test"
V3_AUTH = "authentification-test"
V3_PRIV = "chiffrement-test"


@dataclass(frozen=True)
class SimulatedNetwork:
    host: str
    port: int


def _free_udp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _responder() -> str:
    scripts = Path(sys.executable).parent
    for name in ("snmpsim-command-responder.exe", "snmpsim-command-responder"):
        candidate = scripts / name
        if candidate.exists():
            return str(candidate)
    found = shutil.which("snmpsim-command-responder")
    if not found:
        pytest.skip("snmpsim n'est pas installé (dépendance de développement)")
    return found


async def _ready(port: int) -> bool:
    try:
        async with SnmpSession(
            "127.0.0.1", SnmpCredentials(port=port), timeout=0.5, retries=0
        ) as session:
            values = await session.get(["1.3.6.1.2.1.1.5.0"])
            return values.get("1.3.6.1.2.1.1.5.0") is not None
    except SnmpError:
        return False


@pytest.fixture(scope="session")
def snmp_network(tmp_path_factory: pytest.TempPathFactory) -> Iterator[SimulatedNetwork]:
    port = _free_udp_port()
    cache = tmp_path_factory.mktemp("snmpsim-cache")
    process = subprocess.Popen(
        # snmpsim lit ses options par moteur SNMP : chaque moteur commence à --v3-engine-id,
        # puis viennent ses données, son utilisateur SNMPv3 et enfin son adresse d'écoute.
        [
            _responder(),
            "--logging-method=null",
            f"--cache-dir={cache}",
            "--v3-engine-id=auto",
            "--data-dir=.",
            f"--v3-user={V3_USER}",
            f"--v3-auth-key={V3_AUTH}",
            "--v3-auth-proto=SHA",
            f"--v3-priv-key={V3_PRIV}",
            "--v3-priv-proto=AES",
            f"--agent-udpv4-endpoint=127.0.0.1:{port}",
        ],
        cwd=DATA_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.monotonic() + 30
        while not asyncio.run(_ready(port)):
            if process.poll() is not None or time.monotonic() > deadline:
                pytest.fail("Le simulateur SNMP n'a pas démarré")
            time.sleep(0.3)
        yield SimulatedNetwork("127.0.0.1", port)
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
