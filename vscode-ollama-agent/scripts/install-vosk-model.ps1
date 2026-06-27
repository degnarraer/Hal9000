param(
  [string]$ModelName = "vosk-model-small-en-us-0.15",
  [string]$ModelDir = "stt-models",
  [switch]$CheckOnly,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$modelUrl = "https://alphacephei.com/vosk/models/$ModelName.zip"
if ([System.IO.Path]::IsPathRooted($ModelDir)) {
  $targetRoot = $ModelDir
} else {
  $targetRoot = Join-Path (Get-Location) $ModelDir
}
$targetPath = Join-Path $targetRoot $ModelName
$zipPath = Join-Path $targetRoot "$ModelName.zip"

if (Test-Path $targetPath) {
  Write-Host "[ok] Vosk model installed at $targetPath"
  return
}

if ($CheckOnly) {
  Write-Host "[missing] Vosk model $ModelName under $targetRoot" -ForegroundColor Yellow
  return
}

if (-not (Test-Path $targetRoot)) {
  New-Item -ItemType Directory -Path $targetRoot | Out-Null
  Write-Host "[created] $targetRoot"
}

if ($Force -and (Test-Path $zipPath)) {
  Remove-Item -LiteralPath $zipPath -Force
}

if (-not (Test-Path $zipPath)) {
  Write-Host "[download] $modelUrl"
  Invoke-WebRequest -Uri $modelUrl -OutFile $zipPath
} else {
  Write-Host "[ok] Reusing downloaded archive $zipPath"
}

Write-Host "[extract] $zipPath"
Expand-Archive -LiteralPath $zipPath -DestinationPath $targetRoot -Force

if (-not (Test-Path $targetPath)) {
  throw "Vosk model extraction did not create expected path: $targetPath"
}

Write-Host "[ok] Vosk model installed at $targetPath"
Write-Host "[info] Local VOSK_MODEL_PATH=$($targetPath.Replace('\', '/'))"
Write-Host "[info] Docker VOSK_MODEL_PATH=/stt-models/$ModelName"
