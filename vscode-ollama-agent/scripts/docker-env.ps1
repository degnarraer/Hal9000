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

function Read-EnvFile($Path) {
  $values = @{}
  Get-Content -Path $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }

    $index = $line.IndexOf('=')
    if ($index -lt 1) { return }

    $key = $line.Substring(0, $index).Trim()
    $value = $line.Substring($index + 1).Trim().Trim('"').Trim("'")
    $values[$key] = $value
  }
  return $values
}

if (-not (Test-Path $envFile)) {
  if (Test-Path $exampleFile) {
    throw "Missing $envFile. Copy $exampleFile to $envFile and customize it first."
  }

  throw "Missing $envFile."
}

$envValues = Read-EnvFile $envFile

if ($Environment -eq 'prod') {
  $required = @('APP_HOST', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI')
  foreach ($key in $required) {
    if (-not $envValues[$key]) {
      throw "Missing $key in $envFile."
    }
  }

  $generatedDir = Join-Path $repoRoot 'deploy/keycloak/generated'
  New-Item -ItemType Directory -Path $generatedDir -Force | Out-Null

  $templatePath = Join-Path $repoRoot 'deploy/keycloak/ollama-agent-realm.template.json'
  $generatedRealm = Join-Path $generatedDir "$Environment-ollama-agent-realm.json"
  $appOrigin = "https://$($envValues['APP_HOST'])"

  $realm = Get-Content -Path $templatePath -Raw
  $realm = $realm.Replace('__OIDC_CLIENT_SECRET__', $envValues['OIDC_CLIENT_SECRET'])
  $realm = $realm.Replace('__OIDC_REDIRECT_URI__', $envValues['OIDC_REDIRECT_URI'])
  $realm = $realm.Replace('__APP_ORIGIN__', $appOrigin)
  Set-Content -Path $generatedRealm -Value $realm -Encoding UTF8

  $env:KEYCLOAK_REALM_IMPORT = $generatedRealm
}

if (-not $ComposeArgs -or $ComposeArgs.Count -eq 0) {
  $ComposeArgs = @('up', '--build', '-d')
}

$profileArgs = @()
if ($envValues['DUCKDNS_TOKEN'] -and $envValues['DUCKDNS_DOMAINS']) {
  $profileArgs = @('--profile', 'duckdns')
}

& (Join-Path $PSScriptRoot 'run-docker.ps1') compose `
  --project-name $projectName `
  --env-file $envFile `
  @profileArgs `
  -f (Join-Path $repoRoot 'docker-compose.yml') `
  @ComposeArgs

exit $LASTEXITCODE
