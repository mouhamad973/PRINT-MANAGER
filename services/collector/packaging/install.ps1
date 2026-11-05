# Installe l'agent ARKSEN Collector comme service Windows, à lancer en administrateur depuis le
# dossier décompressé. Avec -Server et -Code, enregistre aussi l'agent auprès du serveur.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Server https://print.exemple.com -Code XXXX-XXXX-XXXX-XXXX
#
# Serveur On-Premise à certificat interne : ajouter -CaFile chemin\ca.pem (autorité du serveur).
param(
    [string]$Server,
    [string]$Code,
    [string]$CaFile,
    [string]$Destination = "$env:ProgramFiles\Arksen\Collector"
)
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Lancez ce script en administrateur.'
}

$signature = Get-AuthenticodeSignature (Join-Path $PSScriptRoot 'arksen-collector.exe')
if ($signature.Status -eq 'Valid') {
    Write-Host "Exécutable signé par : $($signature.SignerCertificate.Subject)"
} else {
    Write-Warning "Exécutable non signé ($($signature.Status)) : vérifiez son empreinte (SHA256SUMS.txt)."
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

$enrollOptions = @()
if ($CaFile) {
    # Copié dans le dossier protégé : le service le relit à chaque synchronisation.
    $authority = Join-Path $data 'ca.pem'
    Copy-Item -Force $CaFile $authority
    $enrollOptions = @('--ca-file', $authority)
}

if ($Server -and $Code) {
    & $exe enroll --server $Server --code $Code @enrollOptions
}

& $exe service install
& $exe service start
Write-Host "Service ArksenCollector installé. Interface locale : http://127.0.0.1:8765/"
