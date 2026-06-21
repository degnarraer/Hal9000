param(
  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$envFile = Join-Path $repoRoot 'env/prod.env'
$composeFile = Join-Path $repoRoot 'docker-compose.yml'
$composeArgs = @('prod', 'up', '-d')

if (-not $NoBuild) {
  $composeArgs += '--build'
}

$composeArgs += @('app', 'caddy')

Push-Location $repoRoot
try {
  if (-not (Test-Path $envFile)) {
    throw "Missing $envFile. Copy env/prod.env.example to env/prod.env and customize it first."
  }

  if (-not (Test-Path $composeFile)) {
    throw "Missing $composeFile."
  }

  & (Join-Path $PSScriptRoot 'docker-env.ps1') @composeArgs
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
