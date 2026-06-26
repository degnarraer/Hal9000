param(
  [string]$VoiceDir = "voices",
  [string]$VoiceName = "en_US-lessac-medium"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$targetDir = Join-Path $repoRoot $VoiceDir

New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

$voiceBaseUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium"

foreach ($extension in @("onnx", "onnx.json")) {
  $fileName = "$VoiceName.$extension"
  $url = "$voiceBaseUrl/$fileName"
  $out = Join-Path $targetDir $fileName
  Write-Host "[download] $url"
  Invoke-WebRequest -Uri $url -OutFile $out
}

Write-Host "[ok] Piper voice files installed under $targetDir"
Write-Host "     Docker will mount this folder as /voices. The Piper runtime is baked into the app image."
