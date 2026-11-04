"""Configuration locale de l'agent : serveur, identité, fréquences et découverte réseau.

Elle est enregistrée en JSON dans le dossier de données de l'agent. Le jeton n'y figure que
protégé (DPAPI sous Windows) : voir `protect.py`.
"""

from __future__ import annotations

import ipaddress
import json
import os
import sys
import tempfile
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from urllib.parse import urlsplit

from arksen_collector.protect import protect, unprotect

#: Bornes des fréquences, en secondes.
MIN_COLLECT_INTERVAL = 60
MAX_COLLECT_INTERVAL = 24 * 3600
MIN_DISCOVERY_INTERVAL = 3600
#: Une découverte n'explore pas plus de 4 096 adresses : au-delà, elle saturerait le réseau.
MAX_DISCOVERY_HOSTS = 4096

CONFIG_FILE = "config.json"
DATABASE_FILE = "collector.db"


class ConfigError(ValueError):
    """Configuration invalide, avec un message destiné à l'utilisateur."""


def default_home() -> Path:
    """Dossier de données : `ARKSEN_COLLECTOR_HOME`, sinon ProgramData sous Windows."""
    override = os.environ.get("ARKSEN_COLLECTOR_HOME")
    if override:
        return Path(override)
    if sys.platform == "win32":
        return Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "Arksen" / "Collector"
    return Path.home() / ".arksen-collector"


@dataclass
class AgentSettings:
    #: Adresse web d'ARKSEN PRINT MANAGER, par exemple https://print.exemple.com.
    server_url: str = ""
    agent_id: str = ""
    tenant_id: str = ""
    agent_name: str = ""
    #: Jeton protégé ; vide tant que l'agent n'est pas enregistré.
    token_sealed: str = ""
    collect_interval: int = 900
    discovery_ranges: list[str] = field(default_factory=list)
    discovery_communities: list[str] = field(default_factory=lambda: ["public"])
    discovery_interval: int = 6 * 3600
    #: Adresse HTTP en clair : refusée sauf sur la boucle locale ou si cette option est cochée.
    allow_insecure_http: bool = False
    #: Certificat d'autorité supplémentaire (serveur On-Premise à certificat interne).
    ca_file: str = ""
    ui_port: int = 8765

    @property
    def enrolled(self) -> bool:
        return bool(self.agent_id and self.token_sealed)

    @property
    def token(self) -> str:
        return unprotect(self.token_sealed).decode("utf-8") if self.token_sealed else ""

    def set_token(self, token: str) -> None:
        self.token_sealed = protect(token.encode("utf-8"))

    @property
    def api_base(self) -> str:
        """Base des routes de l'agent, via le relais du frontend."""
        return f"{self.server_url.rstrip('/')}/backend/api/v1/agent/v1"

    def validate(self) -> None:
        check_server_url(self.server_url, self.allow_insecure_http)
        if not MIN_COLLECT_INTERVAL <= self.collect_interval <= MAX_COLLECT_INTERVAL:
            raise ConfigError(
                f"Fréquence de collecte entre {MIN_COLLECT_INTERVAL} s et {MAX_COLLECT_INTERVAL} s."
            )
        if self.discovery_interval < MIN_DISCOVERY_INTERVAL:
            raise ConfigError("Une découverte au plus par heure.")
        hosts = sum(len(expand_range(item)) for item in self.discovery_ranges)
        if hosts > MAX_DISCOVERY_HOSTS:
            raise ConfigError(
                f"La découverte couvre {hosts} adresses : {MAX_DISCOVERY_HOSTS} au plus."
            )
        if not 1024 <= self.ui_port <= 65535:
            raise ConfigError("Port de l'interface locale entre 1024 et 65535.")
        if self.ca_file and not Path(self.ca_file).is_file():
            raise ConfigError(f"Certificat introuvable : {self.ca_file}")


def check_server_url(url: str, allow_insecure_http: bool) -> None:
    if not url:
        return
    parts = urlsplit(url)
    if parts.scheme not in {"https", "http"} or not parts.hostname:
        raise ConfigError("Adresse du serveur invalide : https://… attendu.")
    if parts.scheme == "http" and not allow_insecure_http and not _is_loopback(parts.hostname):
        raise ConfigError(
            "Le serveur doit être joint en HTTPS. HTTP n'est admis que sur ce poste, "
            "ou si vous l'autorisez explicitement."
        )


def _is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def expand_range(value: str) -> list[str]:
    """Adresses d'une plage : `192.168.1.0/24`, `192.168.1.10-192.168.1.50` ou une adresse seule."""
    value = value.strip()
    try:
        if "-" in value:
            start_text, end_text = (part.strip() for part in value.split("-", 1))
            start = ipaddress.IPv4Address(start_text)
            end = ipaddress.IPv4Address(end_text)
            if end < start:
                raise ConfigError(f"Plage inversée : {value}")
            if int(end) - int(start) >= MAX_DISCOVERY_HOSTS:
                raise ConfigError(f"Plage trop large : {value}")
            return [str(ipaddress.IPv4Address(n)) for n in range(int(start), int(end) + 1)]
        network = ipaddress.IPv4Network(value, strict=False)
        if network.num_addresses > MAX_DISCOVERY_HOSTS:
            raise ConfigError(f"Plage trop large : {value}")
        if network.num_addresses == 1:
            return [str(network.network_address)]
        return [str(host) for host in network.hosts()]
    except (ValueError, ipaddress.AddressValueError) as error:
        if isinstance(error, ConfigError):
            raise
        raise ConfigError(f"Plage d'adresses invalide : {value}") from error


class ConfigStore:
    """Lecture et écriture atomique de la configuration dans le dossier de données."""

    def __init__(self, home: Path | None = None) -> None:
        self.home = home or default_home()
        self.path = self.home / CONFIG_FILE

    @property
    def database_path(self) -> Path:
        return self.home / DATABASE_FILE

    def load(self) -> AgentSettings:
        if not self.path.exists():
            return AgentSettings()
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ConfigError(f"Configuration illisible ({self.path}) : {error}") from error
        known = {item.name for item in fields(AgentSettings)}
        return AgentSettings(**{key: value for key, value in raw.items() if key in known})

    def save(self, settings: AgentSettings) -> None:
        settings.validate()
        self.home.mkdir(parents=True, exist_ok=True)
        data = json.dumps(asdict(settings), indent=2, ensure_ascii=False)
        # Écriture dans un fichier temporaire puis remplacement : jamais de fichier à moitié écrit.
        handle, temporary = tempfile.mkstemp(dir=self.home, prefix=".config-", suffix=".json")
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                stream.write(data)
            os.replace(temporary, self.path)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise
