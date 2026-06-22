param(
  [ValidateSet('push', 'pull', 'list', 'login', 'create-account', 'sync-sso-client', 'backup-cloud', 'check-routing', 'fix-local-hosts', 'install')]
  [string]$Action = ''
)

$ErrorActionPreference = 'Stop'

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

  $packageRoot = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages"
  if (Test-Path $packageRoot) {
    $candidate = Get-ChildItem -Path $packageRoot -Recurse -Filter bw.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) {
      $dir = Split-Path -Parent $candidate.FullName
      if (($env:Path -split ';') -notcontains $dir) {
        $env:Path = "$dir;$env:Path"
      }
    }
  }
}

function Test-UrlPort($Url) {
  try {
    $uri = [System.Uri]$Url
    $port = $uri.Port
    if ($port -lt 1) {
      $port = if ($uri.Scheme -eq 'https') { 443 } else { 80 }
    }

    $result = Test-NetConnection -ComputerName $uri.Host -Port $port -WarningAction SilentlyContinue
    return [bool]$result.TcpTestSucceeded
  } catch {
    return $false
  }
}

function Assert-VaultReachable($VaultUrl) {
  if (Test-UrlPort $VaultUrl) { return }

  Write-Warning "$VaultUrl is not reachable from this machine yet."
  Write-Host 'Run this to diagnose DNS, ports, and local hosts-file entries:'
  Write-Host 'npm run secrets:vault:check-routing'
  Write-Host ''
  Write-Host 'If the local hosts entry is missing, run this from an Administrator PowerShell:'
  Write-Host 'powershell -ExecutionPolicy Bypass -File scripts/fix-local-hosts.ps1 -Apply'
  throw 'Vaultwarden action stopped because the vault URL is unreachable.'
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

  bw config server $VaultUrl | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not configure bw server as $VaultUrl."
  }
}

Repair-BwPath

if (-not $Action) {
  Write-Host ''
  Write-Host 'Vaultwarden Secrets'
  Write-Host '1. Push env/prod.env to Vaultwarden as a new version'
  Write-Host '2. Pull newest env/prod.env from Vaultwarden'
  Write-Host '3. List Vaultwarden env snapshots'
  Write-Host '4. Login to Vaultwarden'
  Write-Host '5. Create first Vaultwarden account'
  Write-Host '6. Sync Vaultwarden SSO client in Keycloak'
  Write-Host '7. Back up production to cloud drive'
  Write-Host '8. Check public/local URL routing'
  Write-Host '9. Show/fix local hosts entries'
  Write-Host '10. Install/check Bitwarden CLI'
  $choice = Read-Host 'Choose 1-10'
  $Action = switch ($choice) {
    '1' { 'push' }
    '2' { 'pull' }
    '3' { 'list' }
    '4' { 'login' }
    '5' { 'create-account' }
    '6' { 'sync-sso-client' }
    '7' { 'backup-cloud' }
    '8' { 'check-routing' }
    '9' { 'fix-local-hosts' }
    '10' { 'install' }
    default { throw 'Invalid choice.' }
  }
}

if ($Action -eq 'install') {
  & (Join-Path $PSScriptRoot 'install-bitwarden-cli.ps1')
  exit $LASTEXITCODE
}

if ($Action -eq 'create-account') {
  & (Join-Path $PSScriptRoot 'vaultwarden-create-account.ps1')
  exit $LASTEXITCODE
}

if ($Action -eq 'backup-cloud') {
  & (Join-Path $PSScriptRoot 'backup-prod.ps1')
  exit $LASTEXITCODE
}

if ($Action -eq 'sync-sso-client') {
  & (Join-Path $PSScriptRoot 'keycloak-sync-vaultwarden-client.ps1')
  exit $LASTEXITCODE
}

if ($Action -eq 'check-routing') {
  & (Join-Path $PSScriptRoot 'check-public-url.ps1')
  exit $LASTEXITCODE
}

if ($Action -eq 'fix-local-hosts') {
  & (Join-Path $PSScriptRoot 'fix-local-hosts.ps1')
  exit $LASTEXITCODE
}

$vaultUrl = 'https://bobassist-vault.duckdns.org'

if ($Action -eq 'login') {
  Repair-BwPath
  Assert-VaultReachable $vaultUrl
  Set-BwServerIfLoggedOut $vaultUrl
  $status = Get-BwStatus
  if ($status -and $status.status -ne 'unauthenticated') {
    Write-Host "Bitwarden CLI is already $($status.status) for $($status.serverUrl)."
    exit 0
  }

  bw login
  exit $LASTEXITCODE
}

if (-not (Get-Command bw -ErrorAction SilentlyContinue)) {
  throw 'Bitwarden CLI (bw) was not found on PATH. Run this script again and choose install.'
}

Assert-VaultReachable $vaultUrl

Set-BwServerIfLoggedOut $vaultUrl

$status = Get-BwStatus
if (-not $status -or $status.status -eq 'unauthenticated') {
  Write-Host 'You are not logged in to Vaultwarden yet. Logging in now.'
  bw login
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$env:BW_SESSION = bw unlock --raw
if ($LASTEXITCODE -ne 0 -or -not $env:BW_SESSION) {
  throw 'Vaultwarden unlock failed.'
}

if ($Action -eq 'push') {
  & (Join-Path $PSScriptRoot 'vaultwarden-push-env.ps1')
  exit $LASTEXITCODE
}

if ($Action -eq 'pull') {
  & (Join-Path $PSScriptRoot 'vaultwarden-pull-env.ps1') -Force
  exit $LASTEXITCODE
}

if ($Action -eq 'list') {
  & (Join-Path $PSScriptRoot 'vaultwarden-list-env.ps1')
  exit $LASTEXITCODE
}
