param(
  [string]$EnvFile = 'env/prod.env',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$envPath = Join-Path $repoRoot $EnvFile
$hostsPath = "$env:WINDIR\System32\drivers\etc\hosts"

function Read-EnvValue($Path, $Name) {
  if (-not (Test-Path $Path)) {
    throw "Missing $Path"
  }

  $line = Get-Content -Path $Path | Where-Object {
    $_ -match "^\s*$Name\s*="
  } | Select-Object -First 1

  if (-not $line) {
    return ''
  }

  return ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
}

$hosts = @(
  Read-EnvValue $envPath 'APP_HOST'
  Read-EnvValue $envPath 'AUTH_HOST'
  Read-EnvValue $envPath 'VAULT_HOST'
) | Where-Object { $_ } | Select-Object -Unique

if ($hosts.Count -eq 0) {
  throw "No APP_HOST, AUTH_HOST, or VAULT_HOST values found in $envPath."
}

$hostsFileText = ''
if (Test-Path $hostsPath) {
  $hostsFileText = Get-Content -Path $hostsPath -Raw
}

$missing = foreach ($hostName in $hosts) {
  if ($hostsFileText -notmatch "(?m)^\s*127\.0\.0\.1\s+.*\b$([regex]::Escape($hostName))\b") {
    "127.0.0.1 $hostName"
  }
}

if (-not $missing -or $missing.Count -eq 0) {
  Write-Host 'All local hosts entries are already present.'
  exit 0
}

Write-Host 'Missing local hosts entries:'
$missing | ForEach-Object { Write-Host $_ }

if (-not $Apply) {
  Write-Host ''
  Write-Host "To apply them, run PowerShell as Administrator and execute:"
  Write-Host "powershell -ExecutionPolicy Bypass -File scripts/fix-local-hosts.ps1 -Apply"
  exit 0
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]$identity
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  throw 'Applying hosts entries requires an Administrator PowerShell.'
}

Add-Content -Path $hostsPath -Value ("`r`n# Hal9000 local production routing`r`n" + ($missing -join "`r`n"))
ipconfig /flushdns | Out-Null

Write-Host 'Added missing local hosts entries and flushed DNS.'
