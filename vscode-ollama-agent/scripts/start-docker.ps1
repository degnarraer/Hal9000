param(
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'

function Add-SessionPath {
  $paths = @(
    "$env:ProgramFiles\Docker\Docker\resources\bin",
    "$env:LOCALAPPDATA\Microsoft\WindowsApps"
  )

  foreach ($entry in $paths) {
    if ((Test-Path $entry) -and (($env:Path -split ';') -notcontains $entry)) {
      $env:Path = "$entry;$env:Path"
    }
  }
}

function Test-DockerReady {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & docker info *> $null
  $ready = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $previousPreference
  return $ready
}

function Test-WslInstalled {
  $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
  if (-not $wsl) {
    return $false
  }

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & wsl.exe --status *> $null
  $ready = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $previousPreference
  return $ready
}

Add-SessionPath

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker CLI was not found. Run npm run server:install:persist-path, then restart VS Code."
}

if (-not (Test-WslInstalled)) {
  throw "WSL is not installed. Run wsl --install from an elevated PowerShell, reboot if prompted, then rerun npm run docker:start."
}

$virtualizationScript = Join-Path $PSScriptRoot "test-virtualization.ps1"
if (Test-Path $virtualizationScript) {
  $virtualizationOk = & $virtualizationScript
  if ($LASTEXITCODE -ne 0 -or $virtualizationOk -contains $false) {
    throw "Virtualization support is required before Docker Desktop can start."
  }
}

if (Test-DockerReady) {
  Write-Host "[ok] Docker engine is already running"
  exit 0
}

$dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
if (-not (Test-Path $dockerDesktop)) {
  throw "Docker Desktop executable was not found at $dockerDesktop"
}

Write-Host "[start] Launching Docker Desktop"
Start-Process -FilePath $dockerDesktop -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  if (Test-DockerReady) {
    Write-Host "[ok] Docker engine is running"
    exit 0
  }

  Write-Host "[wait] Waiting for Docker engine..."
  Start-Sleep -Seconds 3
}

throw "Docker Desktop did not become ready within $TimeoutSeconds seconds."
