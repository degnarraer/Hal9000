param(
  [string]$Environment = 'prod'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$envFile = Join-Path $repoRoot "env/$Environment.env"
$projectName = "hal9000-$Environment"
$realmName = 'ollama-agent'
$clientId = 'vaultwarden'

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
  throw "Missing $envFile."
}

$envValues = Read-EnvFile $envFile
$required = @('KEYCLOAK_ADMIN', 'KEYCLOAK_ADMIN_PASSWORD', 'VAULT_SITE', 'VAULTWARDEN_SSO_CLIENT_SECRET')
foreach ($key in $required) {
  if (-not $envValues[$key]) {
    throw "Missing $key in $envFile."
  }
}

$payload = @{
  clientId = $clientId
  name = 'Vaultwarden'
  enabled = $true
  protocol = 'openid-connect'
  publicClient = $false
  clientAuthenticatorType = 'client-secret'
  secret = $envValues['VAULTWARDEN_SSO_CLIENT_SECRET']
  redirectUris = @("$($envValues['VAULT_SITE'])/identity/connect/oidc-signin")
  webOrigins = @($envValues['VAULT_SITE'])
  standardFlowEnabled = $true
  directAccessGrantsEnabled = $false
  serviceAccountsEnabled = $false
  attributes = @{
    'post.logout.redirect.uris' = "$($envValues['VAULT_SITE'])/*"
  }
}

$payloadPath = Join-Path $repoRoot "deploy/keycloak/generated/$Environment-vaultwarden-client.json"
New-Item -ItemType Directory -Path (Split-Path -Parent $payloadPath) -Force | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($payloadPath, ($payload | ConvertTo-Json -Depth 10), $utf8NoBom)

$composeBase = @(
  'compose',
  '--project-name', $projectName,
  '--env-file', $envFile,
  '-f', (Join-Path $repoRoot 'docker-compose.yml')
)

& docker @composeBase cp $payloadPath 'keycloak:/tmp/vaultwarden-client.json'
if ($LASTEXITCODE -ne 0) {
  throw 'Could not copy Vaultwarden client payload into the Keycloak container.'
}

& docker @composeBase exec -T keycloak /opt/keycloak/bin/kcadm.sh config credentials `
  --server http://localhost:8080 `
  --realm master `
  --user $envValues['KEYCLOAK_ADMIN'] `
  --password $envValues['KEYCLOAK_ADMIN_PASSWORD'] | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Could not authenticate to Keycloak admin CLI.'
}

$existingId = & docker @composeBase exec -T keycloak /opt/keycloak/bin/kcadm.sh get clients `
  -r $realmName `
  -q "clientId=$clientId" `
  --fields id `
  --format csv `
  --noquotes
if ($LASTEXITCODE -ne 0) {
  throw 'Could not query Keycloak clients.'
}

$existingId = $existingId | Select-Object -First 1
if ($existingId) {
  $existingId = $existingId.Trim()
}
if ($existingId) {
  & docker @composeBase exec -T keycloak /opt/keycloak/bin/kcadm.sh update "clients/$existingId" -r $realmName -f /tmp/vaultwarden-client.json
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not update the existing Vaultwarden Keycloak client.'
  }
  Write-Host "Updated Keycloak client: $clientId"
} else {
  & docker @composeBase exec -T keycloak /opt/keycloak/bin/kcadm.sh create clients -r $realmName -f /tmp/vaultwarden-client.json
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not create the Vaultwarden Keycloak client.'
  }
  Write-Host "Created Keycloak client: $clientId"
}

Write-Host "Redirect URI: $($envValues['VAULT_SITE'])/identity/connect/oidc-signin"
