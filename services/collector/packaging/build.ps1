# Construit l'agent ARKSEN Collector pour Windows : dist\arksen-collector\ (exécutable et
# bibliothèques) et dist\arksen-collector-<version>.zip, prêt à copier sur le poste du client.
#
# Usage, depuis services\collector : powershell -ExecutionPolicy Bypass -File packaging\build.ps1
#
# Signature Authenticode, facultative : définir ARKSEN_SIGN_PFX (fichier .pfx) et
# ARKSEN_SIGN_PASSWORD, ou ARKSEN_SIGN_THUMBPRINT (certificat du magasin de l'utilisateur).
# ARKSEN_SIGN_TIMESTAMP change le serveur d'horodatage. Sans eux, le paquet n'est pas signé.
# Dans tous les cas, dist\SHA256SUMS.txt donne l'empreinte de l'exécutable et de l'archive.
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
$exe = 'dist\arksen-collector\arksen-collector.exe'
& $exe --version

function Find-SignTool {
    $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $found = Get-ChildItem $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.Directory.Name -eq 'x64' } |
        Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $found) { throw 'signtool.exe introuvable : installez le SDK Windows.' }
    return $found.FullName
}

if ($env:ARKSEN_SIGN_PFX -or $env:ARKSEN_SIGN_THUMBPRINT) {
    $signtool = Find-SignTool
    $timestamp = 'http://timestamp.digicert.com'
    if ($env:ARKSEN_SIGN_TIMESTAMP) { $timestamp = $env:ARKSEN_SIGN_TIMESTAMP }
    if ($env:ARKSEN_SIGN_PFX) {
        $identity = @('/f', $env:ARKSEN_SIGN_PFX, '/p', $env:ARKSEN_SIGN_PASSWORD)
    } else {
        $identity = @('/sha1', $env:ARKSEN_SIGN_THUMBPRINT)
    }
    & $signtool sign /fd SHA256 /td SHA256 /tr $timestamp /d 'ARKSEN Collector' @identity $exe
    if ($LASTEXITCODE -ne 0) { throw 'Signature de l''exécutable impossible.' }
    & $signtool verify /pa $exe
    if ($LASTEXITCODE -ne 0) { throw 'Signature de l''exécutable invalide.' }
    Write-Host 'Exécutable signé.'
} else {
    Write-Warning 'Paquet non signé : définir ARKSEN_SIGN_PFX ou ARKSEN_SIGN_THUMBPRINT pour la diffusion.'
}

$archive = "dist\arksen-collector-$version.zip"
if (Test-Path $archive) { Remove-Item $archive }
Compress-Archive -Path dist\arksen-collector\* -DestinationPath $archive

$sums = foreach ($file in @($exe, $archive)) {
    $hash = (Get-FileHash -Algorithm SHA256 $file).Hash.ToLowerInvariant()
    "$hash  $(Split-Path -Leaf $file)"
}
$sums | Set-Content -Encoding ascii dist\SHA256SUMS.txt
$sums | ForEach-Object { Write-Host $_ }
Write-Host "Paquet prêt : $archive (empreintes dans dist\SHA256SUMS.txt)"
