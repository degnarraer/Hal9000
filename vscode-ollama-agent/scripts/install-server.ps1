param(
  [switch]$CheckOnly,
  [switch]$Full,
  [switch]$InstallOllama,
  [switch]$InstallWsl,
  [switch]$PersistPath,
  [switch]$SkipFasterWhisper,
  [switch]$SkipVosk
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

function Ensure-NpmDependencies {
  Write-Step "Checking Node dependencies"

  if ($CheckOnly) {
    if (Test-Path "node_modules") {
      Write-Host "[ok] node_modules exists"
    } else {
      Write-Host "[missing] node_modules" -ForegroundColor Yellow
    }
    Test-VoskNodePackage
    return
  }

  if (-not (Test-Command npm.cmd)) {
    throw "npm.cmd is required to install project dependencies."
  }

  Write-Host "[install] npm.cmd install"
  & npm.cmd install
  Test-VoskNodePackage
}

function Test-VoskNodePackage {
  Write-Step "Checking Vosk Node package"

  if (-not (Test-Command node)) {
    Write-Host "[missing] node is required to verify Vosk package loading" -ForegroundColor Yellow
    return
  }

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & node -e "require('vosk'); console.log('vosk module loaded')" 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference

  if ($exitCode -eq 0) {
    Write-Host "[ok] Vosk Node package loads"
    return
  }

  Write-Host "[missing] Vosk Node package is not loadable" -ForegroundColor Yellow
  Write-Host "        $output" -ForegroundColor Yellow

  if ($CheckOnly) {
    Write-Host "        Run: npm.cmd install" -ForegroundColor Yellow
    return
  }

  if (-not (Test-Command npm.cmd)) {
    Write-Host "        npm.cmd is unavailable; cannot install Vosk dependency." -ForegroundColor Yellow
    return
  }

  Write-Host "[install] npm.cmd install"
  & npm.cmd install

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & node -e "require('vosk'); console.log('vosk module loaded')" 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference

  if ($exitCode -eq 0) {
    Write-Host "[ok] Vosk Node package loads"
  } else {
    Write-Host "[warning] Vosk Node package still does not load locally." -ForegroundColor Yellow
    Write-Host "          $output" -ForegroundColor Yellow
    Write-Host "          Docker deployment will verify Vosk during image build." -ForegroundColor Yellow
  }
}

function Ensure-EnvFile {
  if (Test-Path ".env") {
    Write-Host "[ok] .env exists"
  } elseif ($CheckOnly) {
    Write-Host "[missing] .env" -ForegroundColor Yellow
  } else {
    Copy-Item ".env.example" ".env"
    Write-Host "[created] .env from .env.example"
  }
  Sync-EnvFileDefaults -Path ".env" -ExamplePath ".env.example"

  $prodEnv = Join-Path "env" "prod.env"
  $prodExample = Join-Path "env" "prod.env.example"
  if (Test-Path $prodEnv) {
    Write-Host "[ok] env/prod.env exists"
  } elseif ($CheckOnly) {
    Write-Host "[missing] env/prod.env" -ForegroundColor Yellow
    return
  } elseif (Test-Path $prodExample) {
    Copy-Item $prodExample $prodEnv
    Write-Host "[created] env/prod.env from env/prod.env.example"
  }

  Sync-EnvFileDefaults -Path $prodEnv -ExamplePath $prodExample
}

function Read-EnvAssignments {
  param([string]$Path)

  $assignments = [ordered]@{}
  if (-not (Test-Path $Path)) { return $assignments }

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*#') { continue }
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
    $key = $Matches[1]
    $value = $Matches[2]
    if (-not $assignments.Contains($key)) {
      $assignments[$key] = $value
    }
  }

  return $assignments
}

function Sync-EnvFileDefaults {
  param(
    [string]$Path,
    [string]$ExamplePath
  )

  if (-not (Test-Path $Path) -or -not (Test-Path $ExamplePath)) { return }

  $current = Read-EnvAssignments -Path $Path
  $defaults = Read-EnvAssignments -Path $ExamplePath
  $missing = @($defaults.Keys | Where-Object { -not $current.Contains($_) })

  if ($missing.Count -eq 0) {
    Write-Host "[ok] $Path includes all example env keys"
    return
  }

  if ($CheckOnly) {
    Write-Host "[missing] $Path env keys: $($missing -join ', ')" -ForegroundColor Yellow
    return
  }

  $lines = @('', "# Added from $ExamplePath by install-server.ps1.")
  foreach ($key in $missing) {
    $lines += "$key=$($defaults[$key])"
  }
  Add-Content -LiteralPath $Path -Value ($lines -join [Environment]::NewLine)
  Write-Host "[updated] $Path added env keys: $($missing -join ', ')"
}

function Ensure-PiperVoiceDirectory {
  $voiceDir = Join-Path (Get-Location) "voices"
  if (-not (Test-Path $voiceDir)) {
    if ($CheckOnly) {
      Write-Host "[missing] voices directory for Piper model mount" -ForegroundColor Yellow
      return
    }

    New-Item -ItemType Directory -Path $voiceDir | Out-Null
    Write-Host "[created] voices directory for Piper model mount"
  } else {
    Write-Host "[ok] voices directory exists"
  }

  $expectedFiles = @(
    "en_US-lessac-medium.onnx",
    "en_US-lessac-medium.onnx.json"
  )

  $missing = @()
  foreach ($file in $expectedFiles) {
    $path = Join-Path $voiceDir $file
    if (Test-Path $path) {
      Write-Host "[ok] voices/$file"
    } else {
      Write-Host "[missing] voices/$file" -ForegroundColor Yellow
      $missing += $file
    }
  }

  if ($missing.Count -eq 0 -or $CheckOnly) {
    return
  }

  $installer = Join-Path $PSScriptRoot "install-piper-voice.ps1"
  if (-not (Test-Path $installer)) {
    throw "Missing Piper voice installer script: $installer"
  }

  Write-Host "[install] Piper voice files"
  & powershell -ExecutionPolicy Bypass -File $installer -VoiceDir "voices"
}

function Ensure-VoskModelDirectory {
  if ($SkipVosk) {
    Write-Host "[skip] Vosk model install skipped by -SkipVosk"
    return
  }

  $modelDir = Join-Path (Get-Location) "stt-models"
  if (-not (Test-Path $modelDir)) {
    if ($CheckOnly) {
      Write-Host "[missing] stt-models directory for Vosk model mount" -ForegroundColor Yellow
    } else {
      New-Item -ItemType Directory -Path $modelDir | Out-Null
      Write-Host "[created] stt-models directory for Vosk model mount"
    }
  } else {
    Write-Host "[ok] stt-models directory exists"
  }

  $installer = Join-Path $PSScriptRoot "install-vosk-model.ps1"
  if (-not (Test-Path $installer)) {
    throw "Missing Vosk model installer script: $installer"
  }

  if ($CheckOnly) {
    & powershell -ExecutionPolicy Bypass -File $installer -CheckOnly
    return
  }

  Write-Host "[install] Vosk speech recognition model"
  & powershell -ExecutionPolicy Bypass -File $installer
}

function Ensure-FasterWhisperPackage {
  if ($SkipFasterWhisper) {
    Write-Host "[skip] Faster-Whisper install skipped by -SkipFasterWhisper"
    return
  }

  $installer = Join-Path $PSScriptRoot "install-faster-whisper.ps1"
  if (-not (Test-Path $installer)) {
    throw "Missing Faster-Whisper installer script: $installer"
  }

  if ($CheckOnly) {
    & powershell -ExecutionPolicy Bypass -File $installer -CheckOnly
    return
  }

  & powershell -ExecutionPolicy Bypass -File $installer
}

function Show-NextSteps {
  Write-Step "Next steps"
  Write-Host "1. Edit .env and replace change-me-before-production values."
  Write-Host "2. Edit env/prod.env and replace replace-with-generated-secret values."
  Write-Host "3. Confirm Piper voice model files exist under ./voices."
  Write-Host "4. Confirm Faster-Whisper is installed, or use Docker where it is installed in the app image."
  Write-Host "5. Confirm Vosk STT model files exist under ./stt-models if VOICE_PIPELINE_STT_PROVIDER=vosk."
  Write-Host "6. If WSL was installed or Windows features changed, reboot."
  Write-Host "7. Run: npm run docker:start"
  Write-Host "8. Run: npm run docker:config"
  Write-Host "9. Run: npm run docker:up"

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
Ensure-PiperVoiceDirectory
Ensure-FasterWhisperPackage
Ensure-VoskModelDirectory
Ensure-NpmDependencies

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
