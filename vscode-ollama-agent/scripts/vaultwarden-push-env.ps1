param(
  [string]$Environment = 'prod',
  [string]$VaultUrl = '',
  [string]$FolderName = 'Hal9000',
  [string]$ItemPrefix = '',
  [string]$Session = $env:BW_SESSION
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$envFile = Join-Path $repoRoot "env/$Environment.env"

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

function Invoke-BwJson($Arguments) {
  $output = & bw @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "bw $($Arguments -join ' ') failed."
  }
  if (-not $output) { return $null }
  return $output | ConvertFrom-Json
}

function Invoke-BwEncoded($Object) {
  $json = $Object | ConvertTo-Json -Depth 20
  $encoded = $json | bw encode
  if ($LASTEXITCODE -ne 0) {
    throw 'bw encode failed.'
  }
  return $encoded
}

function Repair-BwPath {
  if (Get-Command bw -ErrorAction SilentlyContinue) { return }

  $knownDirs = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Bitwarden.CLI_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "$env:LOCALAPPDATA\Microsoft\WindowsApps"
  )

  foreach ($dir in $knownDirs) {
    if (-not (Test-Path $dir)) { continue }
    if (($env:Path -split ';') -notcontains $dir) {
      $env:Path = "$dir;$env:Path"
    }
    if (Get-Command bw -ErrorAction SilentlyContinue) { return }
  }
}

function Get-BwStatus {
  $statusText = & bw status 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $statusText) {
    return $null
  }

  try {
    return $statusText | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Set-BwServerIfLoggedOut($VaultUrl) {
  $status = Get-BwStatus
  if ($status -and $status.status -ne 'unauthenticated') {
    return
  }

  & bw config server $VaultUrl | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not configure bw server as $VaultUrl."
  }
}

Repair-BwPath

if (-not (Get-Command bw -ErrorAction SilentlyContinue)) {
  throw 'Bitwarden CLI (bw) was not found on PATH. Install it, run `bw config server <vault-url>`, log in, then unlock.'
}

if (-not (Test-Path $envFile)) {
  throw "Missing $envFile."
}

if (-not $Session) {
  throw 'Missing Bitwarden session. Run `bw unlock --raw` and set BW_SESSION, or pass -Session.'
}

$envValues = Read-EnvFile $envFile
if (-not $VaultUrl) {
  $VaultUrl = $envValues['VAULT_SITE']
}
if (-not $VaultUrl) {
  throw 'Vault URL is required. Set VAULT_SITE in the env file or pass -VaultUrl.'
}
if (-not $ItemPrefix) {
  $ItemPrefix = "Hal9000 $Environment.env"
}

Set-BwServerIfLoggedOut $VaultUrl

$folderId = $null
if ($FolderName) {
  $folders = @(Invoke-BwJson @('list', 'folders', '--session', $Session))
  $folder = $folders | Where-Object { $_.name -eq $FolderName } | Select-Object -First 1
  if (-not $folder) {
    $folderPayload = Invoke-BwEncoded @{ name = $FolderName }
    $folder = Invoke-BwJson @('create', 'folder', $folderPayload, '--session', $Session)
  }
  $folderId = $folder.id
}

$envText = Get-Content -Path $envFile -Raw
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$itemName = "$ItemPrefix $stamp"

$newItem = @{
  type = 2
  name = $itemName
  notes = $envText
  secureNote = @{ type = 0 }
  folderId = $folderId
}

$payload = Invoke-BwEncoded $newItem
$createdItem = Invoke-BwJson @('create', 'item', $payload, '--session', $Session)
if (-not $createdItem -or $createdItem.name -ne $itemName) {
  throw "Vaultwarden item create did not return the expected item: $itemName"
}

& bw sync --session $Session | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'Vaultwarden item was created, but bw sync failed. Refresh the web vault manually.'
}

Write-Host "Created Vaultwarden item: $itemName"
Write-Host "Folder: $FolderName"
Write-Host 'Older Vaultwarden secret versions were not modified.'
