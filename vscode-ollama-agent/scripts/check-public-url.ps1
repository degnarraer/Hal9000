param(
  [string]$EnvFile = "env/prod.env"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$envPath = Join-Path $repoRoot $EnvFile

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

$appHost = Read-EnvValue $envPath 'APP_HOST'
$authHost = Read-EnvValue $envPath 'AUTH_HOST'
$vaultHost = Read-EnvValue $envPath 'VAULT_HOST'

if (-not $appHost) {
  throw "APP_HOST is missing from $envPath"
}

Write-Host "Checking public website URL settings..." -ForegroundColor Cyan
Write-Host "App URL:  https://$appHost/"
if ($authHost) {
  Write-Host "Auth URL: https://$authHost/"
}
if ($vaultHost) {
  Write-Host "Vault URL: https://$vaultHost/"
}
Write-Host ""

$hosts = @($appHost)
if ($authHost) {
  $hosts += $authHost
}
if ($vaultHost) {
  $hosts += $vaultHost
}

$hostsPath = "$env:WINDIR\System32\drivers\etc\hosts"
$hostsFileText = ''
if (Test-Path $hostsPath) {
  $hostsFileText = Get-Content -Path $hostsPath -Raw
}

foreach ($hostName in $hosts) {
  Write-Host "DNS: $hostName" -ForegroundColor Cyan
  try {
    Resolve-DnsName $hostName -Type A | Select-Object Name, Type, IPAddress, TTL | Format-Table -AutoSize
  }
  catch {
    Write-Host "DNS lookup failed: $($_.Exception.Message)" -ForegroundColor Red
  }

  foreach ($port in @(80, 443)) {
    Write-Host "Port check: ${hostName}:$port" -ForegroundColor Cyan
    $result = Test-NetConnection $hostName -Port $port -WarningAction SilentlyContinue
    if ($result.TcpTestSucceeded) {
      Write-Host "OK: TCP $port is reachable." -ForegroundColor Green
    }
    else {
      Write-Host "FAILED: TCP $port is not reachable." -ForegroundColor Red
    }
  }

  Write-Host ""
}

$localhost443 = Test-NetConnection 127.0.0.1 -Port 443 -WarningAction SilentlyContinue
if ($localhost443.TcpTestSucceeded) {
  Write-Host "Local Caddy check: OK, 127.0.0.1:443 is reachable." -ForegroundColor Green
} else {
  Write-Host "Local Caddy check: FAILED, 127.0.0.1:443 is not reachable." -ForegroundColor Red
}

$missingLocalHosts = @()
foreach ($hostName in $hosts) {
  if ($hostsFileText -notmatch "(?m)^\s*127\.0\.0\.1\s+.*\b$([regex]::Escape($hostName))\b") {
    $missingLocalHosts += $hostName
  }
}

if ($missingLocalHosts.Count -gt 0) {
  Write-Host ""
  Write-Host "Missing local hosts entries for same-machine testing:" -ForegroundColor Yellow
  foreach ($hostName in $missingLocalHosts) {
    Write-Host "127.0.0.1 $hostName"
  }
  Write-Host ""
  Write-Host "Add those lines to $hostsPath from an Administrator editor, then run:" -ForegroundColor Yellow
  Write-Host "ipconfig /flushdns"
}

Write-Host ""
Write-Host "If public DNS is correct but public ports fail, check router forwarding to this machine, Windows Firewall, and NAT loopback." -ForegroundColor Yellow
