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

if (-not $appHost) {
  throw "APP_HOST is missing from $envPath"
}

Write-Host "Checking public website URL settings..." -ForegroundColor Cyan
Write-Host "App URL:  https://$appHost/"
if ($authHost) {
  Write-Host "Auth URL: https://$authHost/"
}
Write-Host ""

$hosts = @($appHost)
if ($authHost) {
  $hosts += $authHost
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

Write-Host "If DNS is correct but ports fail, check router forwarding to this machine and NAT loopback." -ForegroundColor Yellow
