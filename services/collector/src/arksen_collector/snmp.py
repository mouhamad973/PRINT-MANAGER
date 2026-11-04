"""Requêtes SNMP (v1, v2c, v3) avec PySNMP, et erreurs explicites pour l'utilisateur."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from pyasn1.type import univ
from pysnmp.error import PySnmpError
from pysnmp.hlapi.v3arch import asyncio as hlapi
from pysnmp.proto import rfc1905

SnmpValue = int | bytes | str | None


class SnmpError(Exception):
    """Échec SNMP, avec un message destiné à l'utilisateur."""


class SnmpTimeout(SnmpError):
    """Aucune réponse : machine éteinte, injoignable, ou communauté SNMPv1/v2c incorrecte."""


class SnmpAuthError(SnmpError):
    """Identifiants SNMPv3 refusés par la machine."""


_AUTH = {
    "MD5": hlapi.usmHMACMD5AuthProtocol,
    "SHA": hlapi.usmHMACSHAAuthProtocol,
    "SHA224": hlapi.usmHMAC128SHA224AuthProtocol,
    "SHA256": hlapi.usmHMAC192SHA256AuthProtocol,
    "SHA384": hlapi.usmHMAC256SHA384AuthProtocol,
    "SHA512": hlapi.usmHMAC384SHA512AuthProtocol,
}
_PRIV = {
    "DES": hlapi.usmDESPrivProtocol,
    "AES128": hlapi.usmAesCfb128Protocol,
    "AES192": hlapi.usmAesCfb192Protocol,
    "AES256": hlapi.usmAesCfb256Protocol,
}
_AUTH_FAILURES = (
    "digest",
    "unknownusername",
    "unsupportedseclevel",
    "decryption",
    "notintimewindow",
)


@dataclass(frozen=True)
class SnmpCredentials:
    version: str = "V2C"
    port: int = 161
    community: str | None = "public"
    username: str | None = None
    security_level: str | None = None
    auth_protocol: str | None = None
    auth_password: str | None = None
    priv_protocol: str | None = None
    priv_password: str | None = None
    #: Contexte SNMPv3 ; vide pour la plupart des imprimantes.
    context_name: str = ""


def to_python(value: Any) -> SnmpValue:
    """Valeur SNMP en type Python ; `None` pour noSuchObject, noSuchInstance et endOfMibView."""
    if isinstance(value, (rfc1905.NoSuchObject, rfc1905.NoSuchInstance, rfc1905.EndOfMibView)):
        return None
    if isinstance(value, univ.Integer):
        return int(value)
    if isinstance(value, univ.ObjectIdentifier):
        return ".".join(str(part) for part in value)
    if isinstance(value, univ.OctetString):
        return bytes(value.asOctets())
    if isinstance(value, univ.Null):
        return None
    return str(value.prettyPrint())


class SnmpSession:
    """Session vers une machine. À utiliser comme gestionnaire de contexte asynchrone."""

    def __init__(
        self,
        host: str,
        credentials: SnmpCredentials,
        *,
        timeout: float = 2.0,
        retries: int = 1,
        engine: Any | None = None,
    ) -> None:
        self.host = host
        self.credentials = credentials
        self.timeout = timeout
        self.retries = retries
        self._own_engine = engine is None
        self._engine = engine or hlapi.SnmpEngine()
        self._target: Any = None

    async def __aenter__(self) -> SnmpSession:
        try:
            self._target = await hlapi.UdpTransportTarget.create(
                (self.host, self.credentials.port), timeout=self.timeout, retries=self.retries
            )
        except PySnmpError as error:
            raise SnmpError(f"Adresse introuvable : {self.host} ({error})") from error
        return self

    async def __aexit__(self, *_: object) -> None:
        if self._own_engine:
            self._engine.close_dispatcher()

    @property
    def _label(self) -> str:
        return f"{self.host}:{self.credentials.port}"

    def _auth(self) -> Any:
        c = self.credentials
        if c.version in {"V1", "V2C"}:
            if not c.community:
                raise SnmpError("Communauté SNMP non renseignée.")
            return hlapi.CommunityData(c.community, mpModel=0 if c.version == "V1" else 1)
        if not c.username:
            raise SnmpError("Utilisateur SNMPv3 non renseigné.")
        level = c.security_level or "NO_AUTH_NO_PRIV"
        if level == "NO_AUTH_NO_PRIV":
            return hlapi.UsmUserData(c.username)
        if not c.auth_password or not c.auth_protocol:
            raise SnmpError("Authentification SNMPv3 incomplète.")
        auth = _AUTH[c.auth_protocol]
        if level == "AUTH_NO_PRIV":
            return hlapi.UsmUserData(c.username, authKey=c.auth_password, authProtocol=auth)
        if not c.priv_password or not c.priv_protocol:
            raise SnmpError("Chiffrement SNMPv3 incomplet.")
        return hlapi.UsmUserData(
            c.username,
            authKey=c.auth_password,
            privKey=c.priv_password,
            authProtocol=auth,
            privProtocol=_PRIV[c.priv_protocol],
        )

    def _context(self) -> Any:
        if self.credentials.version == "V3" and self.credentials.context_name:
            return hlapi.ContextData(contextName=self.credentials.context_name)
        return hlapi.ContextData()

    def _raise_for(self, indication: Any, status: Any, index: Any) -> None:
        if indication:
            text = str(indication)
            name = type(indication).__name__
            if name == "RequestTimedOut" or "timeout" in text.lower():
                raise SnmpTimeout(
                    f"Pas de réponse SNMP de {self._label} : machine éteinte, adresse, port "
                    "ou communauté incorrects."
                )
            if any(marker in (name + text).lower() for marker in _AUTH_FAILURES):
                raise SnmpAuthError(f"Identifiants SNMPv3 refusés par {self._label} : {text}.")
            raise SnmpError(f"Erreur SNMP avec {self._label} : {text}.")
        if status and int(status) != 0:
            raise SnmpError(f"Erreur SNMP de {self._label} : {status.prettyPrint()} (#{index}).")

    async def get(self, oids: Sequence[str]) -> dict[str, SnmpValue]:
        """Valeurs de plusieurs OID ; une valeur absente vaut `None`."""
        if not oids:
            return {}
        if self.credentials.version == "V1":
            # En SNMPv1, un OID absent fait échouer toute la requête : une requête par OID.
            values: dict[str, SnmpValue] = {}
            for oid in oids:
                try:
                    values.update(await self._get(oids=[oid]))
                except SnmpTimeout:
                    raise
                except SnmpError:
                    values[oid] = None
            return values
        return await self._get(oids)

    async def _get(self, oids: Sequence[str]) -> dict[str, SnmpValue]:
        indication, status, index, binds = await hlapi.get_cmd(
            self._engine,
            self._auth(),
            self._target,
            self._context(),
            *(hlapi.ObjectType(hlapi.ObjectIdentity(oid)) for oid in oids),
        )
        self._raise_for(indication, status, index)
        return {str(name): to_python(value) for name, value in binds}

    async def walk(self, base: str, *, limit: int = 2000) -> list[tuple[str, SnmpValue]]:
        """Parcourt une table, sans en sortir."""
        rows: list[tuple[str, SnmpValue]] = []
        if self.credentials.version == "V1":
            generator = hlapi.walk_cmd(
                self._engine,
                self._auth(),
                self._target,
                self._context(),
                hlapi.ObjectType(hlapi.ObjectIdentity(base)),
                lexicographicMode=False,
            )
        else:
            generator = hlapi.bulk_walk_cmd(
                self._engine,
                self._auth(),
                self._target,
                self._context(),
                0,
                25,
                hlapi.ObjectType(hlapi.ObjectIdentity(base)),
                lexicographicMode=False,
            )
        async for indication, status, index, binds in generator:
            self._raise_for(indication, status, index)
            for name, value in binds:
                oid = str(name)
                if not (oid == base or oid.startswith(base + ".")):
                    return rows
                rows.append((oid, to_python(value)))
                if len(rows) >= limit:
                    return rows
        return rows
