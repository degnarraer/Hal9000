$ErrorActionPreference = 'Stop'

$knownPaths = @(
  "$env:ProgramFiles\Docker\Docker\resources\bin",
  "$env:LOCALAPPDATA\Microsoft\WindowsApps"
)

foreach ($entry in $knownPaths) {
  if ((Test-Path $entry) -and (($env:Path -split ';') -notcontains $entry)) {
    $env:Path = "$entry;$env:Path"
  }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker CLI was not found. Run npm run server:install:persist-path, then restart VS Code."
}

& docker @args
exit $LASTEXITCODE
