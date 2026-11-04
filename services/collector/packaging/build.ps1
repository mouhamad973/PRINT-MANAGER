# Construit l'agent ARKSEN Collector pour Windows : dist\arksen-collector\ (exécutable et
# bibliothèques) et dist\arksen-collector-<version>.zip, prêt à copier sur le poste du client.
#
# Usage, depuis services\collector : powershell -ExecutionPolicy Bypass -File packaging\build.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$python = '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { py -3.12 -m venv .venv }
& $python -m pip install --quiet --upgrade pip
& $python -m pip install --quiet -e '.[package]'

$version = & $python -c 'import arksen_collector; print(arksen_collector.__version__)'
Push-Location packaging
try {
    & ..\$python -m PyInstaller --noconfirm --clean --distpath ..\dist --workpath ..\build arksen-collector.spec
} finally {
    Pop-Location
}

Copy-Item packaging\install.ps1, packaging\uninstall.ps1 dist\arksen-collector\
& dist\arksen-collector\arksen-collector.exe --version
$archive = "dist\arksen-collector-$version.zip"
if (Test-Path $archive) { Remove-Item $archive }
Compress-Archive -Path dist\arksen-collector\* -DestinationPath $archive
Write-Host "Paquet prêt : $archive"
