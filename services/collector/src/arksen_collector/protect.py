"""Protection des secrets au repos : jeton de l'agent et secrets SNMP mis en cache.

Sous Windows, DPAPI (portée machine) chiffre les données avec une clé du système : le fichier
copié sur un autre poste est illisible. Ailleurs (tests, développement), les données sont
seulement encodées, ce que signale le préfixe `plain:`.
"""

from __future__ import annotations

import base64
import ctypes
import sys
from typing import Any

_DPAPI_PREFIX = "dpapi:"
_PLAIN_PREFIX = "plain:"
_CRYPTPROTECT_UI_FORBIDDEN = 0x1
_CRYPTPROTECT_LOCAL_MACHINE = 0x4


class ProtectionError(Exception):
    """Secret illisible : fichier copié d'un autre poste, ou endommagé."""


def dpapi_available() -> bool:
    return sys.platform == "win32"


def protect(data: bytes) -> str:
    if dpapi_available():
        return _DPAPI_PREFIX + base64.b64encode(_dpapi(data, encrypt=True)).decode("ascii")
    return _PLAIN_PREFIX + base64.b64encode(data).decode("ascii")


def unprotect(sealed: str) -> bytes:
    try:
        if sealed.startswith(_DPAPI_PREFIX):
            if not dpapi_available():
                raise ProtectionError("Secret protégé par DPAPI : lisible sous Windows seulement.")
            return _dpapi(base64.b64decode(sealed[len(_DPAPI_PREFIX) :]), encrypt=False)
        if sealed.startswith(_PLAIN_PREFIX):
            return base64.b64decode(sealed[len(_PLAIN_PREFIX) :])
    except (ValueError, OSError) as error:
        raise ProtectionError(f"Secret illisible : {error}") from error
    raise ProtectionError("Format de secret inconnu.")


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi(data: bytes, *, encrypt: bool) -> bytes:  # pragma: no cover - dépend de Windows
    windll: Any = getattr(ctypes, "windll")  # noqa: B009 - absent hors de Windows
    crypt32 = windll.crypt32
    kernel32 = windll.kernel32
    buffer = ctypes.create_string_buffer(data, len(data))
    source = _Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    target = _Blob()
    flags = _CRYPTPROTECT_UI_FORBIDDEN | _CRYPTPROTECT_LOCAL_MACHINE
    function = crypt32.CryptProtectData if encrypt else crypt32.CryptUnprotectData
    ok = function(ctypes.byref(source), None, None, None, None, flags, ctypes.byref(target))
    if not ok:
        raise OSError(ctypes.get_last_error() or "échec de DPAPI")
    try:
        return ctypes.string_at(target.pbData, target.cbData)
    finally:
        kernel32.LocalFree(target.pbData)
