param(
  [switch]$ShowCache
)

$ErrorActionPreference = 'Stop'

Write-Host "Flushing Windows DNS resolver cache..." -ForegroundColor Cyan
ipconfig /flushdns

if ($LASTEXITCODE -ne 0) {
  throw "ipconfig /flushdns failed with exit code $LASTEXITCODE."
}

Write-Host ""
Write-Host "DNS resolver cache flushed." -ForegroundColor Green

if ($ShowCache) {
  Write-Host ""
  Write-Host "Current DNS resolver cache:" -ForegroundColor Cyan
  ipconfig /displaydns
}
