# Installe ou met à jour ARKSEN PRINT MANAGER sur un serveur Windows SANS accès Internet, depuis
# le paquet hors ligne (scripts/offline-bundle.mjs). Prérequis : Docker Desktop démarré.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-InstallDir C:\ARKSEN]
#
# Première installation : pose les questions (nom du serveur, compte Super Administrateur),
# génère les secrets dans <InstallDir>\.env.production. Mise à jour : sauvegarde la base, puis
# démarre la nouvelle version. Voir LISEZMOI.md.
[CmdletBinding()]
param(
    [string]$InstallDir = 'C:\ARKSEN',
    [string]$ServerName,
    [string]$ServerIp,
    [int]$HttpsPort = 443,
    [int]$HttpPort = 80,
    [string]$AdminEmail,
    [securestring]$AdminPassword
)

$ErrorActionPreference = 'Stop'
$bundle = $PSScriptRoot
$composeFiles = @('compose.prod.yaml', 'compose.onprem.yaml', 'compose.offline.yaml')

function Write-Step([string]$message) {
    Write-Host ''
    Write-Host "== $message" -ForegroundColor Cyan
}

function Invoke-Native {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Échec de « $Command $($Arguments -join ' ') » (code $LASTEXITCODE)."
    }
}

function Invoke-Compose([string[]]$Arguments) {
    $files = $composeFiles | ForEach-Object { @('-f', "infrastructure\compose\$_") }
    Invoke-Native docker (@('compose', '--env-file', '.env.production') + $files + $Arguments)
}

function New-Secret {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

function Set-EnvValue([string]$Path, [string]$Key, [string]$Value) {
    $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
    $found = $false
    $lines = $lines | ForEach-Object {
        if ($_ -like "$Key=*") { $found = $true; "$Key=$Value" } else { $_ }
    }
    if (-not $found) { $lines += "$Key=$Value" }
    [IO.File]::WriteAllLines($Path, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
}

function Read-Default([string]$Prompt, [string]$Default) {
    $answer = Read-Host "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($answer)) { $Default } else { $answer.Trim() }
}

function Get-LocalIp {
    try {
        $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
            Sort-Object RouteMetric | Select-Object -First 1
        $address = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction Stop |
            Select-Object -First 1
        return $address.IPAddress
    } catch {
        return ''
    }
}

function ConvertTo-Plain([securestring]$Secure) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Read-AdminPassword {
    while ($true) {
        $first = ConvertTo-Plain (Read-Host 'Mot de passe du Super Administrateur (12 caractères minimum)' -AsSecureString)
        $second = ConvertTo-Plain (Read-Host 'Confirmez le mot de passe' -AsSecureString)
        if ($first -ne $second) { Write-Warning 'Les deux saisies diffèrent.'; continue }
        if ($first.Length -lt 12) { Write-Warning 'Au moins 12 caractères.'; continue }
        if ($first.Contains("'")) { Write-Warning "L'apostrophe ' n'est pas acceptée."; continue }
        return $first
    }
}

# --- 1. Vérifications ---
Write-Step 'Vérification de Docker'
$serverVersion = & docker version --format '{{.Server.Version}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker ne répond pas : démarrez Docker Desktop, puis relancez.' }
$composeVersion = (& docker compose version --short).Trim().TrimStart('v')
if ($LASTEXITCODE -ne 0 -or [version]($composeVersion -replace '-.*$', '') -lt [version]'2.24.0') {
    throw "Docker Compose 2.24 ou plus récent est requis (trouvé : $composeVersion)."
}
Write-Host "Docker $serverVersion, Compose $composeVersion"

Write-Step 'Vérification du paquet (SHA-256)'
$sums = Join-Path $bundle 'SHA256SUMS.txt'
if (-not (Test-Path -LiteralPath $sums)) { throw 'SHA256SUMS.txt introuvable : paquet incomplet.' }
foreach ($line in Get-Content -LiteralPath $sums) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $expected, $relative = $line -split '  ', 2
    $file = Join-Path $bundle ($relative -replace '/', '\')
    if (-not (Test-Path -LiteralPath $file)) { throw "Fichier manquant : $relative" }
    $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Fichier altéré ou mal copié : $relative" }
}
$version = (Get-Content -LiteralPath (Join-Path $bundle 'VERSION')).Trim()
Write-Host "Paquet intègre, version $version"

# --- 2. Fichiers ---
Write-Step "Copie des fichiers dans $InstallDir"
$composeTarget = Join-Path $InstallDir 'infrastructure\compose'
New-Item -ItemType Directory -Force -Path $composeTarget | Out-Null
foreach ($file in $composeFiles) {
    Copy-Item -LiteralPath (Join-Path $bundle "infrastructure\compose\$file") -Destination $composeTarget -Force
}
foreach ($file in @('.env.production.example', 'VERSION', 'LISEZMOI.md')) {
    Copy-Item -LiteralPath (Join-Path $bundle $file) -Destination $InstallDir -Force
}
if (Test-Path -LiteralPath (Join-Path $bundle 'agent')) {
    Copy-Item -LiteralPath (Join-Path $bundle 'agent') -Destination $InstallDir -Recurse -Force
}
$fileArgs = ($composeFiles | ForEach-Object { "-f infrastructure\compose\$_" }) -join ' '
Set-Content -LiteralPath (Join-Path $InstallDir 'arksen.cmd') -Encoding ascii -Value @(
    '@echo off',
    'rem Raccourci : arksen ps, arksen logs api, arksen down, arksen up -d ...',
    'cd /d "%~dp0"',
    "docker compose --env-file .env.production $fileArgs %*"
)
Set-Location -LiteralPath $InstallDir

# --- 3. Configuration (première installation) ---
$envFile = Join-Path $InstallDir '.env.production'
$firstInstall = -not (Test-Path -LiteralPath $envFile)
if ($firstInstall) {
    Write-Step 'Configuration'
    if (-not $ServerName) { $ServerName = Read-Default 'Nom du serveur sur le réseau' $env:COMPUTERNAME.ToLowerInvariant() }
    if (-not $PSBoundParameters.ContainsKey('ServerIp')) { $ServerIp = Read-Default 'Adresse IP du serveur' (Get-LocalIp) }
    while (-not $AdminEmail -or $AdminEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
        $AdminEmail = (Read-Host 'E-mail du Super Administrateur').Trim()
    }
    if ($AdminPassword) {
        $password = ConvertTo-Plain $AdminPassword
        if ($password.Length -lt 12 -or $password.Contains("'")) { throw 'Mot de passe refusé : 12 caractères minimum, sans apostrophe.' }
    } else {
        $password = Read-AdminPassword
    }
    $publicUrl = if ($HttpsPort -eq 443) { "https://$ServerName" } else { "https://${ServerName}:$HttpsPort" }

    Copy-Item -LiteralPath (Join-Path $InstallDir '.env.production.example') -Destination $envFile
    $values = [ordered]@{
        SERVER_NAME                = $ServerName
        PUBLIC_WEB_URL             = $publicUrl
        SERVER_IP                  = $ServerIp
        HTTP_PORT                  = $HttpPort
        HTTPS_PORT                 = $HttpsPort
        POSTGRES_PASSWORD          = New-Secret
        APP_DB_PASSWORD            = New-Secret
        SYSTEM_DB_PASSWORD         = New-Secret
        REDIS_PASSWORD             = New-Secret
        BETTER_AUTH_SECRET         = New-Secret
        CREDENTIALS_ENCRYPTION_KEY = New-Secret
        SUPER_ADMIN_EMAIL          = $AdminEmail
        SUPER_ADMIN_PASSWORD       = "'$password'"
        SUPER_ADMIN_NAME           = 'Super Administrateur'
    }
    foreach ($key in $values.Keys) { Set-EnvValue $envFile $key ([string]$values[$key]) }
    $password = $null
    # Lecture réservée à l'utilisateur courant, aux administrateurs et au système.
    & icacls $envFile /inheritance:r /grant:r "${env:USERNAME}:F" '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null
    Write-Host "Configuration écrite dans $envFile"
}
Set-EnvValue $envFile 'ARKSEN_VERSION' $version

# --- 4. Images ---
Write-Step 'Chargement des images Docker (quelques minutes)'
Invoke-Native docker @('load', '-i', (Join-Path $bundle 'images\arksen-images.tar.gz'))

# --- 5. Sauvegarde avant mise à jour ---
$existing = & docker compose --env-file .env.production @($composeFiles | ForEach-Object { @('-f', "infrastructure\compose\$_") }) ps -a -q postgres
if (-not $firstInstall -and $existing) {
    Write-Step 'Sauvegarde de la base avant mise à jour'
    Invoke-Compose @('up', '-d', '--wait', 'postgres')
    Invoke-Compose @('run', '--rm', '--no-deps', 'backup', 'once')
}

# --- 6. Démarrage ---
Write-Step 'Démarrage d''ARKSEN (premier démarrage : quelques minutes)'
Invoke-Compose @('up', '-d', '--wait', '--wait-timeout', '900', '--remove-orphans')

if ($firstInstall) {
    # Le compte est créé : le mot de passe n'a plus rien à faire sur le disque.
    Set-EnvValue $envFile 'SUPER_ADMIN_EMAIL' ''
    Set-EnvValue $envFile 'SUPER_ADMIN_PASSWORD' ''
    Invoke-Compose @('up', '-d', '--wait', '--wait-timeout', '300', 'api')
}

Invoke-Compose @('cp', 'nginx:/etc/nginx/certs/ca.pem', (Join-Path $InstallDir 'arksen-ca.pem'))

$publicUrl = ((Get-Content -LiteralPath $envFile -Encoding UTF8) | Where-Object { $_ -like 'PUBLIC_WEB_URL=*' }) -replace '^PUBLIC_WEB_URL=', ''
Write-Host ''
Write-Host "ARKSEN $version est démarré : $publicUrl" -ForegroundColor Green
Write-Host "Certificat de l'autorité locale : $InstallDir\arksen-ca.pem"
Write-Host '  - à installer sur chaque poste : certutil -addstore Root arksen-ca.pem'
Write-Host '  - à donner à l''agent de collecte : install.ps1 ... -CaFile arksen-ca.pem'
Write-Host "Commandes courantes : $InstallDir\arksen.cmd ps | logs api | down | up -d"
if ($firstInstall) {
    Write-Host "Conservez une copie de $envFile hors du serveur (clé de chiffrement)." -ForegroundColor Yellow
}
