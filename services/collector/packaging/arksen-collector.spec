# -*- mode: python ; coding: utf-8 -*-
# Exécutable autonome de l'agent ARKSEN Collector (PyInstaller, mode « onedir »).
# Construction : packaging\build.ps1 (voir docs/collector.md).
from PyInstaller.utils.hooks import collect_submodules

hidden = (
    collect_submodules("pysnmp")
    + collect_submodules("pyasn1")
    + collect_submodules("cryptography")
    + ["win32timezone", "win32serviceutil", "win32service", "win32event", "servicemanager"]
)

analysis = Analysis(
    ["launcher.py"],
    pathex=["../src"],
    hiddenimports=hidden,
    excludes=["tkinter", "pytest", "snmpsim", "pysmi"],
    noarchive=False,
)
pyz = PYZ(analysis.pure)
exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="arksen-collector",
    console=True,
    version="version.txt",
)
COLLECT(exe, analysis.binaries, analysis.datas, name="arksen-collector")
