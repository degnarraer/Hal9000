param(
  [switch]$CheckOnly,
  [switch]$Full,
  [switch]$InstallOllama,
  [switch]$InstallWsl,
  [switch]$PersistPath
)

$ErrorActionPreference = 'Stop'
$script:PathChanged = $false
$script:PackagesInstalled = $false

if ($Full) {
  $InstallWsl = $true
  $PersistPath = $true
}

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-Command {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-Winget {
  if (-not (Test-Command winget)) {
    throw "winget is required for automated host installs. Install App Installer from Microsoft Store or install dependencies manually."
  }
}

function Add-PathEntry {
  param(
    [string]$PathEntry,
    [switch]$Persist
  )

  if (-not $PathEntry -or -not (Test-Path $PathEntry)) {
    return
  }

  $currentEntries = $env:Path -split ';' | Where-Object { $_ }
  if ($currentEntries -notcontains $PathEntry) {
    $env:Path = "$PathEntry;$env:Path"
    $script:PathChanged = $true
    Write-Host "[path] Added to current session: $PathEntry"
  }

  if (-not $Persist -or $CheckOnly) {
    return
  }

  $target = if (Test-IsAdmin) { 'Machine' } else { 'User' }
  $existing = [Environment]::GetEnvironmentVariable('Path', $target)
  $existingEntries = ($existing -split ';') | Where-Object { $_ }
  if ($existingEntries -contains $PathEntry) {
    return
  }

  [Environment]::SetEnvironmentVariable('Path', "$existing;$PathEntry", $target)
  $script:PathChanged = $true
  Write-Host "[path] Persisted to $target PATH: $PathEntry"
}

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Repair-KnownPaths {
  param([switch]$Persist)

  Write-Step "Checking PATH entries"

  $paths = @(
    "$env:ProgramFiles\Git\cmd",
    "$env:ProgramFiles\nodejs",
    "$env:ProgramFiles\Docker\Docker\resources\bin",
    "$env:LOCALAPPDATA\Programs\Ollama",
    "$env:LOCALAPPDATA\Microsoft\WindowsApps",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Bitwarden.CLI_Microsoft.Winget.Source_8wekyb3d8bbwe"
  )

  foreach ($entry in $paths) {
    Add-PathEntry -PathEntry $entry -Persist:$Persist
  }
}

function Ensure-WingetPackage {
  param(
    [string]$Command,
    [string]$PackageId,
    [string]$DisplayName
  )

  if (Test-Command $Command) {
    Write-Host "[ok] $DisplayName is installed"
    return
  }

  if ($CheckOnly) {
    Write-Host "[missing] $DisplayName ($PackageId)" -ForegroundColor Yellow
    return
  }

  Test-Winget
  Write-Host "[install] $DisplayName via winget"
  winget install --id $PackageId --exact --accept-source-agreements --accept-package-agreements
  $script:PackagesInstalled = $true
}

function Ensure-DockerCompose {
  if (-not (Test-Command docker)) {
    Write-Host "[missing] Docker CLI" -ForegroundColor Yellow
    return
  }

  try {
    docker compose version | Out-Null
    Write-Host "[ok] Docker Compose plugin is available"
  } catch {
    Write-Host "[missing] Docker Compose plugin. Update Docker Desktop." -ForegroundColor Yellow
  }
}

function Ensure-Wsl {
  $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
  if (-not $wsl) {
    Write-Host "[missing] wsl.exe is not available on this Windows install" -ForegroundColor Yellow
    return
  }

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $status = & wsl.exe --status 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference

  if ($exitCode -eq 0) {
    Write-Host "[ok] WSL is installed"
    return
  }

  Write-Host "[missing] Windows Subsystem for Linux is not installed" -ForegroundColor Yellow

  if ($CheckOnly -or -not $InstallWsl) {
    Write-Host "        Run from an elevated PowerShell:"
    Write-Host "        npm.cmd run server:install:wsl"
    Write-Host "        or:"
    Write-Host "        wsl --install"
    return
  }

  if (-not (Test-IsAdmin)) {
    throw "Installing WSL requires an elevated PowerShell. Run as Administrator and try again."
  }

  Write-Host "[install] Installing WSL. A reboot may be required."
  & wsl.exe --install
  $script:PackagesInstalled = $true
}

function Test-WindowsFeatureState {
  param([string]$FeatureName)

  try {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName $FeatureName
    if ($feature.State -eq 'Enabled') {
      Write-Host "[ok] Windows feature enabled: $FeatureName"
    } else {
      Write-Host "[missing] Windows feature disabled: $FeatureName" -ForegroundColor Yellow
      Write-Host "        Enable from elevated PowerShell:"
      Write-Host "        Enable-WindowsOptionalFeature -Online -FeatureName $FeatureName -All"
    }
  } catch {
    Write-Host "[warning] Could not inspect Windows feature $FeatureName`: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

function Test-DockerReady {
  if (-not (Test-Command docker)) {
    Write-Host "[skip] Docker readiness check skipped because Docker CLI is missing"
    return
  }

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & docker info *> $null
  $dockerReady = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $previousPreference

  if ($dockerReady) {
    Write-Host "[ok] Docker engine is reachable"
  } else {
    Write-Host "[warning] Docker CLI is installed, but the Docker engine is not reachable. Start Docker Desktop and try again." -ForegroundColor Yellow
    return
  }

  try {
    docker compose config | Out-Null
    Write-Host "[ok] docker-compose.yml validates"
  } catch {
    Write-Host "[warning] docker compose config failed. Review docker-compose.yml and .env values." -ForegroundColor Yellow
  }
}

function Ensure-EnvFile {
  if (Test-Path ".env") {
    Write-Host "[ok] .env exists"
    return
  }

  if ($CheckOnly) {
    Write-Host "[missing] .env" -ForegroundColor Yellow
    return
  }

  Copy-Item ".env.example" ".env"
  Write-Host "[created] .env from .env.example"
}

function Show-NextSteps {
  Write-Step "Next steps"
  Write-Host "1. Edit .env and replace change-me-before-production values."
  Write-Host "2. If WSL was installed or Windows features changed, reboot."
  Write-Host "3. Run: npm install"
  Write-Host "4. Run: npm run docker:start"
  Write-Host "5. Run: npm run docker:config"
  Write-Host "6. Run: npm run docker:up"

  if ($script:PathChanged -or $script:PackagesInstalled) {
    Write-Host ""
    Write-Host "Important: restart VS Code before using newly installed command-line tools from Run/Debug tasks." -ForegroundColor Yellow
    Write-Host "Existing VS Code terminals do not automatically receive Windows PATH changes." -ForegroundColor Yellow
  }
}

Repair-KnownPaths -Persist:$PersistPath

Write-Step "Checking server prerequisites"
Ensure-WingetPackage -Command git -PackageId Git.Git -DisplayName "Git"
Ensure-WingetPackage -Command node -PackageId OpenJS.NodeJS.LTS -DisplayName "Node.js LTS"
Ensure-WingetPackage -Command docker -PackageId Docker.DockerDesktop -DisplayName "Docker Desktop"
Ensure-WingetPackage -Command bw -PackageId Bitwarden.CLI -DisplayName "Bitwarden CLI"

if ($InstallOllama) {
  Ensure-WingetPackage -Command ollama -PackageId Ollama.Ollama -DisplayName "Ollama"
} else {
  if (Test-Command ollama) {
    Write-Host "[ok] Ollama is installed"
  } else {
    Write-Host "[skip] Ollama is optional for Docker deployment. Pass -InstallOllama to install it on the host."
  }
}

Ensure-DockerCompose
Ensure-Wsl

Write-Step "Checking Windows virtualization features"
Test-WindowsFeatureState -FeatureName "Microsoft-Windows-Subsystem-Linux"
Test-WindowsFeatureState -FeatureName "VirtualMachinePlatform"
Test-WindowsFeatureState -FeatureName "HypervisorPlatform"

Write-Step "Checking project files"
Ensure-EnvFile

Write-Step "Checking virtualization support"
$virtualizationScript = Join-Path $PSScriptRoot "test-virtualization.ps1"
if (Test-Path $virtualizationScript) {
  & $virtualizationScript
}

Test-DockerReady

Show-NextSteps

if (-not $PersistPath) {
  Write-Host ""
  Write-Host "Tip: pass -PersistPath to save discovered tool paths to your User PATH. Run as Administrator to update Machine PATH." -ForegroundColor DarkGray
}
