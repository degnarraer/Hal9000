param(
  [string]$Environment = 'prod',
  [string]$VaultUrl = '',
  [string]$ItemPrefix = '',
  [string]$ItemName = '',
  [string]$Session = $env:BW_SESSION,
  [switch]$Force
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

function Repair-BwPath {
  if (Get-Command bw -ErrorAction SilentlyContinue) { return }

  $knownDirs = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Bitwarden.CLI_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "$env:LOCALAPPDATA\Microsoft\WindowsApps"
  )

  foreach ($dir in $knownDirs) {
    if (-not (Test-Path $dir)) { continue }
    if (($env:Path -split ';') -notcontains $dir) {
      $env:Path = "$dir;$env:Path"
    }
    if (Get-Command bw -ErrorAction SilentlyContinue) { return }
  }
}

function Get-BwStatus {
  $statusText = & bw status 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $statusText) {
    return $null
  }

  try {
    return $statusText | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Set-BwServerIfLoggedOut($VaultUrl) {
  $status = Get-BwStatus
  if ($status -and $status.status -ne 'unauthenticated') {
    return
  }

  & bw config server $VaultUrl | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not configure bw server as $VaultUrl."
  }
}

Repair-BwPath

if (-not (Get-Command bw -ErrorAction SilentlyContinue)) {
  throw 'Bitwarden CLI (bw) was not found on PATH. Install it, run `bw config server <vault-url>`, log in, then unlock.'
}

if (-not $Session) {
  throw 'Missing Bitwarden session. Run `bw unlock --raw` and set BW_SESSION, or pass -Session.'
}

$envValues = Read-EnvFile $envFile
if (-not $VaultUrl) {
  $VaultUrl = $envValues['VAULT_SITE']
}
if (-not $VaultUrl) {
  throw 'Vault URL is required. Set VAULT_SITE in the env file or pass -VaultUrl.'
}
if (-not $ItemPrefix) {
  $ItemPrefix = "Hal9000 $Environment.env"
}

Set-BwServerIfLoggedOut $VaultUrl

if ($ItemName) {
  $items = @(Invoke-BwJson @('list', 'items', '--search', $ItemName, '--session', $Session))
  $item = $items | Where-Object { $_.name -eq $ItemName } | Select-Object -First 1
} else {
  $items = @(Invoke-BwJson @('list', 'items', '--search', $ItemPrefix, '--session', $Session))
  $item = $items |
    Where-Object { $_.name -like "$ItemPrefix *" } |
    Sort-Object -Property revisionDate, creationDate -Descending |
    Select-Object -First 1
}
if (-not $item) {
  throw "Vaultwarden item not found for prefix: $ItemPrefix"
}

$notes = [string]$item.notes
if (-not $notes.Contains('DEPLOYMENT_ENV=')) {
  throw "Vaultwarden item '$($item.name)' does not look like an env file."
}

if ((Test-Path $envFile) -and -not $Force) {
  throw "$envFile already exists. Pass -Force to replace it. A timestamped backup will be kept."
}

if (Test-Path $envFile) {
  $backupPath = "$envFile.$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
  Copy-Item -Path $envFile -Destination $backupPath
  Write-Host "Backed up existing env file to: $backupPath"
}

Set-Content -Path $envFile -Value $notes -Encoding UTF8
Write-Host "Wrote Vaultwarden item '$($item.name)' to $envFile"
