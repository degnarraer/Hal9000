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

function Resolve-RepoPath($Path) {
  if (-not $Path) {
    return $null
  }

  if ([System.IO.Path]::IsPathRooted($Path)) {
    return $Path
  }

  return Join-Path $repoRoot $Path
}

function ModelNameFromContainerPath($Path) {
  if (-not $Path) {
    return 'vosk-model-small-en-us-0.15'
  }

  $normalized = $Path.Replace('\', '/').TrimEnd('/')
  $lastSlash = $normalized.LastIndexOf('/')
  if ($lastSlash -ge 0) {
    return $normalized.Substring($lastSlash + 1)
  }

  return $normalized
}

function Ensure-VoskModelForCompose {
  $modelDir = Resolve-RepoPath ($envValues['VOSK_MODEL_DIR'])
  if (-not $modelDir) {
    $modelDir = Join-Path $repoRoot 'stt-models'
  }

  $modelName = ModelNameFromContainerPath $envValues['VOSK_MODEL_PATH']
  $targetPath = Join-Path $modelDir $modelName
  if (Test-Path $targetPath) {
    Write-Host "[deploy] Vosk STT model present at $targetPath"
    return
  }

  $installer = Join-Path $PSScriptRoot 'install-vosk-model.ps1'
  if (-not (Test-Path $installer)) {
    throw "Missing Vosk model installer script: $installer"
  }

  Write-Host "[deploy] Installing Vosk STT model for Docker mount: $targetPath"
  & powershell -ExecutionPolicy Bypass -File $installer -ModelName $modelName -ModelDir $modelDir
  if ($LASTEXITCODE -ne 0) {
    throw "Vosk model install failed."
  }
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
  $realm = $realm.Replace('__VAULTWARDEN_SSO_CLIENT_SECRET__', $envValues['VAULTWARDEN_SSO_CLIENT_SECRET'])
  $realm = $realm.Replace('__VAULTWARDEN_REDIRECT_URI__', "$($envValues['VAULT_SITE'])/identity/connect/oidc-signin")
  $realm = $realm.Replace('__VAULT_ORIGIN__', $envValues['VAULT_SITE'])
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

$composeBaseArgs = @(
  'compose',
  '--project-name', $projectName,
  '--env-file', $envFile
)
$composeBaseArgs += $profileArgs
$composeBaseArgs += @('-f', (Join-Path $repoRoot 'docker-compose.yml'))

$isUpCommand = $ComposeArgs.Count -gt 0 -and $ComposeArgs[0] -eq 'up'

if ($isUpCommand) {
  Ensure-VoskModelForCompose
}

if ($Environment -eq 'prod' -and $isUpCommand) {
  Write-Host "[deploy] Stopping caddy before app recreate to avoid proxying a missing backend"
  & (Join-Path $PSScriptRoot 'run-docker.ps1') @composeBaseArgs stop caddy
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[deploy] caddy was not stopped cleanly or does not exist yet; continuing" -ForegroundColor Yellow
  }
}

& (Join-Path $PSScriptRoot 'run-docker.ps1') @composeBaseArgs @ComposeArgs
$composeExitCode = $LASTEXITCODE

if ($composeExitCode -ne 0) {
  exit $composeExitCode
}

if ($Environment -eq 'prod' -and $isUpCommand) {
  Write-Host "[deploy] Ensuring caddy is running after app is healthy"
  & (Join-Path $PSScriptRoot 'run-docker.ps1') @composeBaseArgs up -d caddy
  exit $LASTEXITCODE
}

exit $composeExitCode
