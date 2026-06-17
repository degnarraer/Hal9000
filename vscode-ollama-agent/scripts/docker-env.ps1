param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('dev', 'prod')]
  [string]$Environment,

  [Parameter(ValueFromRemainingArguments = $true, Position = 1)]
  [string[]]$ComposeArgs
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$envDir = Join-Path $repoRoot 'env'
$envFile = Join-Path $envDir "$Environment.env"
$exampleFile = Join-Path $envDir "$Environment.env.example"
$projectName = "hal9000-$Environment"

if (-not (Test-Path $envFile)) {
  if (Test-Path $exampleFile) {
    throw "Missing $envFile. Copy $exampleFile to $envFile and customize it first."
  }

  throw "Missing $envFile."
}

if (-not $ComposeArgs -or $ComposeArgs.Count -eq 0) {
  $ComposeArgs = @('up', '--build', '-d')
}

& (Join-Path $PSScriptRoot 'run-docker.ps1') compose `
  --project-name $projectName `
  --env-file $envFile `
  -f (Join-Path $repoRoot 'docker-compose.yml') `
  @ComposeArgs

exit $LASTEXITCODE
