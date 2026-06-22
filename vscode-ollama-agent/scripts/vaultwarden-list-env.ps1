param(
  [string]$Environment = 'prod',
  [string]$VaultUrl = '',
  [string]$ItemPrefix = '',
  [string]$Session = $env:BW_SESSION
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$envFile = Join-Path $repoRoot "env/$Environment.env"

function Read-EnvFile($Path) {
  $values = @{}
  if (-not (Test-Path $Path)) { return $values }

  Get-Content -Path $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }

    $index = $line.IndexOf('=')
    if ($index -lt 1) { return }

    $key = $line.Substring(0, $index).Trim()
    $value = $line.Substring($index + 1).Trim().Trim('"').Trim("'")
    $values[$key] = $value
  }
  return $values
}

function Invoke-BwJson($Arguments) {
  $output = & bw @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "bw $($Arguments -join ' ') failed."
  }
  if (-not $output) { return $null }
  return $output | ConvertFrom-Json
}

if (-not (Get-Command bw -ErrorAction SilentlyContinue)) {
  throw 'Bitwarden CLI (bw) was not found on PATH.'
}

if (-not $Session) {
  throw 'Missing Bitwarden session. Choose push/pull from the menu first or run `bw unlock --raw` and set BW_SESSION.'
}

$envValues = Read-EnvFile $envFile
if (-not $VaultUrl) {
  $VaultUrl = $envValues['VAULT_SITE']
}
if (-not $ItemPrefix) {
  $ItemPrefix = "Hal9000 $Environment.env"
}

& bw sync --session $Session | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'bw sync failed. Listing may use cached data.'
}

$items = @(Invoke-BwJson @('list', 'items', '--search', $ItemPrefix, '--session', $Session))
$snapshots = $items |
  Where-Object { $_.name -like "$ItemPrefix *" } |
  Sort-Object -Property revisionDate, creationDate -Descending |
  Select-Object name, creationDate, revisionDate

if (-not $snapshots -or $snapshots.Count -eq 0) {
  Write-Host "No Vaultwarden env snapshots found for prefix: $ItemPrefix"
  exit 0
}

Write-Host "Vaultwarden env snapshots for prefix: $ItemPrefix"
$snapshots | Format-Table -AutoSize
