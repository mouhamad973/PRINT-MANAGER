# Installe l'agent ARKSEN Collector comme service Windows, à lancer en administrateur depuis le
# dossier décompressé. Avec -Server et -Code, enregistre aussi l'agent auprès du serveur.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Server https://print.exemple.com -Code XXXX-XXXX-XXXX-XXXX
param(
    [string]$Server,
    [string]$Code,
    [string]$Destination = "$env:ProgramFiles\Arksen\Collector"
)
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Lancez ce script en administrateur.'
}

$exe = Join-Path $Destination 'arksen-collector.exe'
if (Get-Service ArksenCollector -ErrorAction SilentlyContinue) {
    & $exe service stop 2>$null
}
New-Item -ItemType Directory -Force $Destination | Out-Null
Copy-Item -Recurse -Force "$PSScriptRoot\*" $Destination

# Dossier de données : lisible et modifiable par les administrateurs et le système seulement.
$data = "$env:ProgramData\Arksen\Collector"
New-Item -ItemType Directory -Force $data | Out-Null
icacls $data /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null

if ($Server -and $Code) {
    & $exe enroll --server $Server --code $Code
}

& $exe service install
& $exe service start
Write-Host "Service ArksenCollector installé. Interface locale : http://127.0.0.1:8765/"
