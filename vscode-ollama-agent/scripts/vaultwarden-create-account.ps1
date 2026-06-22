param(
  [string]$Environment = 'prod',
  [string]$VaultUrl = '',
  [switch]$KeepSignupsEnabled
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$envFile = Join-Path $repoRoot "env/$Environment.env"

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

function Set-EnvValue($Path, $Key, $Value) {
  $lines = @()
  if (Test-Path $Path) {
    $lines = @(Get-Content -Path $Path)
  }

  $pattern = "^\s*$([regex]::Escape($Key))\s*="
  $updated = $false
  $next = foreach ($line in $lines) {
    if ($line -match $pattern) {
      "$Key=$Value"
      $updated = $true
    } else {
      $line
    }
  }

  if (-not $updated) {
    $next += "$Key=$Value"
  }

  Set-Content -Path $Path -Value $next
}

function Invoke-Compose($Environment, $Arguments) {
  & (Join-Path $PSScriptRoot 'docker-env.ps1') $Environment @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker-env.ps1 $Environment $($Arguments -join ' ') failed."
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

Repair-BwPath

if (-not (Get-Command bw -ErrorAction SilentlyContinue)) {
  throw 'Bitwarden CLI (bw) was not found on PATH. Run `npm run secrets:vault:install-cli` first.'
}

if (-not (Test-Path $envFile)) {
  throw "Missing $envFile. Create it from env/$Environment.env.example first."
}

$envValues = Read-EnvFile $envFile
if (-not $VaultUrl) {
  $VaultUrl = $envValues['VAULT_SITE']
}
if (-not $VaultUrl) {
  throw 'Vault URL is required. Set VAULT_SITE in the env file or pass -VaultUrl.'
}

$previousSignups = $envValues['VAULTWARDEN_SIGNUPS_ALLOWED']
if (-not $previousSignups) {
  $previousSignups = 'false'
}

$changedSignups = $false
if ($previousSignups.ToLowerInvariant() -ne 'true') {
  Write-Host "Temporarily enabling Vaultwarden signups in $envFile."
  Copy-Item -Path $envFile -Destination "$envFile.bootstrap-account.bak" -Force
  Set-EnvValue $envFile 'VAULTWARDEN_SIGNUPS_ALLOWED' 'true'
  $changedSignups = $true
  Invoke-Compose $Environment @('up', '-d', '--force-recreate', 'vaultwarden', 'caddy')
}

try {
  Write-Host "Configuring Bitwarden CLI for $VaultUrl."
  & bw config server $VaultUrl
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $registerUrl = "$($VaultUrl.TrimEnd('/'))/#/register"
  if (-not (Test-UrlPort $VaultUrl)) {
    Write-Warning "$VaultUrl is not reachable from this machine yet, so the browser registration page will time out."
    Write-Host 'Check that host port 443 reaches Caddy, your firewall allows inbound HTTPS, and DuckDNS points to the right reachable address.'
    Write-Host 'If you are on the same machine as the server, a local hosts entry for the vault hostname may be needed when router hairpin NAT is unavailable.'
    Write-Host ''
    Write-Host 'Run this next:'
    Write-Host 'npm run secrets:vault:check-routing'
    throw 'Vaultwarden registration stopped because the vault URL is unreachable.'
  }

  Write-Host "Opening Vaultwarden registration page: $registerUrl"
  Write-Host 'Create the account in the browser, then return here.'
  Start-Process $registerUrl | Out-Null
  Read-Host 'Press Enter after the Vaultwarden account has been created'

  Write-Host 'Vaultwarden account step complete. You can now use `bw login` or choose the login option from the menu.'
}
finally {
  if ($changedSignups -and -not $KeepSignupsEnabled) {
    Write-Host "Restoring VAULTWARDEN_SIGNUPS_ALLOWED=$previousSignups."
    Set-EnvValue $envFile 'VAULTWARDEN_SIGNUPS_ALLOWED' $previousSignups
    Invoke-Compose $Environment @('up', '-d', '--force-recreate', 'vaultwarden', 'caddy')
  } elseif ($changedSignups) {
    Write-Host 'Leaving Vaultwarden signups enabled because -KeepSignupsEnabled was passed.'
  }
}
