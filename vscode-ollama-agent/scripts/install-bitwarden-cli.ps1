param(
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

$existing = Get-Command bw -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Bitwarden CLI found: $($existing.Source)"
  & bw --version
  exit 0
}

if ($CheckOnly) {
  throw 'Bitwarden CLI (bw) was not found on PATH.'
}

$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) {
  throw 'winget was not found. Install Bitwarden CLI manually from https://bitwarden.com/help/cli/ or install winget first.'
}

Write-Host 'Installing Bitwarden CLI with winget...'
winget install --id Bitwarden.CLI --exact --accept-package-agreements --accept-source-agreements

$pathsToCheck = @(
  "$env:LOCALAPPDATA\Microsoft\WinGet\Packages",
  "$env:ProgramFiles\Bitwarden CLI",
  "$env:ProgramFiles\nodejs"
)

$found = Get-Command bw -ErrorAction SilentlyContinue
if (-not $found) {
  foreach ($path in $pathsToCheck) {
    if (-not (Test-Path $path)) { continue }
    $candidate = Get-ChildItem -Path $path -Recurse -Filter bw.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) {
      Write-Host "Bitwarden CLI installed at: $($candidate.FullName)"
      Write-Host 'Restart VS Code, or add that directory to PATH for the current terminal.'
      exit 0
    }
  }
}

$found = Get-Command bw -ErrorAction SilentlyContinue
if ($found) {
  Write-Host "Bitwarden CLI installed: $($found.Source)"
  & bw --version
  exit 0
}

throw 'Bitwarden CLI install finished, but bw was not found on PATH. Restart VS Code or add the install directory to PATH.'
