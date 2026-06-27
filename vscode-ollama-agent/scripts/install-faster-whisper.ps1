param(
  [switch]$CheckOnly,
  [string]$Python = $env:FASTER_WHISPER_PYTHON
)

$ErrorActionPreference = 'Stop'

if (-not $Python) {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCommand) {
    $Python = $pythonCommand.Source
  } else {
    $pythonCommand = Get-Command python3 -ErrorAction SilentlyContinue
    if ($pythonCommand) { $Python = $pythonCommand.Source }
  }
}

if (-not $Python) {
  throw "Python is required for Faster-Whisper. Install Python or set FASTER_WHISPER_PYTHON."
}

Write-Host "[check] Python: $Python"

$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$check = & $Python -c "import faster_whisper; print('faster-whisper module loaded')" 2>&1
$exitCode = $LASTEXITCODE
$ErrorActionPreference = $previousPreference

if ($exitCode -eq 0) {
  Write-Host "[ok] Faster-Whisper is installed"
  return
}

Write-Host "[missing] Faster-Whisper is not installed for this Python." -ForegroundColor Yellow
Write-Host "          $check" -ForegroundColor Yellow

if ($CheckOnly) {
  Write-Host "        Run: npm.cmd run server:install:faster-whisper" -ForegroundColor Yellow
  return
}

Write-Host "[install] python -m pip install faster-whisper"
& $Python -m pip install faster-whisper

$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$check = & $Python -c "import faster_whisper; print('faster-whisper module loaded')" 2>&1
$exitCode = $LASTEXITCODE
$ErrorActionPreference = $previousPreference

if ($exitCode -ne 0) {
  throw "Faster-Whisper install completed but the package is still not loadable: $check"
}

Write-Host "[ok] Faster-Whisper is installed"
