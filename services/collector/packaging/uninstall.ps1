# Désinstalle le service ARKSEN Collector. Les données (ProgramData\Arksen\Collector) sont
# conservées : elles peuvent contenir des relevés pas encore synchronisés.
param([string]$Destination = "$env:ProgramFiles\Arksen\Collector")
$ErrorActionPreference = 'Stop'
$exe = Join-Path $Destination 'arksen-collector.exe'
& $exe service stop 2>$null
& $exe service remove
Remove-Item -Recurse -Force $Destination
Write-Host 'Service supprimé. Données conservées dans ProgramData\Arksen\Collector.'
