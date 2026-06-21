param(
  [string]$Environment = 'prod',
  [switch]$SkipRclone,
  [switch]$AllowUnencrypted
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$envFile = Join-Path $repoRoot "env/$Environment.env"
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
  throw "Missing $envFile. Copy env/$Environment.env.example to env/$Environment.env and customize it first."
}

$envValues = Read-EnvFile $envFile
$backupRoot = $envValues['BACKUP_DIR']
if (-not $backupRoot) {
  $backupRoot = 'backups'
}
if (-not [System.IO.Path]::IsPathRooted($backupRoot)) {
  $backupRoot = Join-Path $repoRoot $backupRoot
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$workDir = Join-Path $backupRoot "hal9000-$Environment-$stamp"
$archiveBase = Join-Path $backupRoot "hal9000-$Environment-$stamp.zip"
$archivePath = $archiveBase

New-Item -ItemType Directory -Path $workDir -Force | Out-Null

try {
  docker compose --project-name $projectName --env-file $envFile -f (Join-Path $repoRoot 'docker-compose.yml') exec -T keycloak-db pg_dump -U keycloak -d keycloak -Fc -f /tmp/keycloak.dump
  docker compose --project-name $projectName --env-file $envFile -f (Join-Path $repoRoot 'docker-compose.yml') cp keycloak-db:/tmp/keycloak.dump (Join-Path $workDir 'keycloak.dump')
  docker compose --project-name $projectName --env-file $envFile -f (Join-Path $repoRoot 'docker-compose.yml') exec -T keycloak-db rm -f /tmp/keycloak.dump

  docker compose --project-name $projectName --env-file $envFile -f (Join-Path $repoRoot 'docker-compose.yml') exec -T memory-db pg_dump -U memory -d memory -Fc -f /tmp/memory.dump
  docker compose --project-name $projectName --env-file $envFile -f (Join-Path $repoRoot 'docker-compose.yml') cp memory-db:/tmp/memory.dump (Join-Path $workDir 'memory.dump')
  docker compose --project-name $projectName --env-file $envFile -f (Join-Path $repoRoot 'docker-compose.yml') exec -T memory-db rm -f /tmp/memory.dump

  docker run --rm -v "${projectName}_vaultwarden_data:/data:ro" -v "${workDir}:/backup" alpine sh -c "cd /data && tar czf /backup/vaultwarden-data.tgz ."
  Copy-Item -Path $envFile -Destination (Join-Path $workDir "$Environment.env")

  Compress-Archive -Path (Join-Path $workDir '*') -DestinationPath $archiveBase -Force

  if ($envValues['BACKUP_AGE_RECIPIENT']) {
    $agePath = Get-Command age -ErrorAction SilentlyContinue
    if (-not $agePath) {
      throw "BACKUP_AGE_RECIPIENT is set, but age was not found on PATH."
    }

    $encryptedPath = "$archiveBase.age"
    age -r $envValues['BACKUP_AGE_RECIPIENT'] -o $encryptedPath $archiveBase
    Remove-Item -LiteralPath $archiveBase -Force
    $archivePath = $encryptedPath
  } elseif ($envValues['BACKUP_RCLONE_REMOTE'] -and -not $SkipRclone -and -not $AllowUnencrypted) {
    throw "BACKUP_AGE_RECIPIENT is required before uploading backups. Set it, use -SkipRclone, or pass -AllowUnencrypted."
  } else {
    Write-Warning "BACKUP_AGE_RECIPIENT is empty. Backup archive is not encrypted."
  }

  if (-not $SkipRclone -and $envValues['BACKUP_RCLONE_REMOTE']) {
    $rclonePath = Get-Command rclone -ErrorAction SilentlyContinue
    if (-not $rclonePath) {
      throw "BACKUP_RCLONE_REMOTE is set, but rclone was not found on PATH."
    }

    rclone copy $archivePath $envValues['BACKUP_RCLONE_REMOTE']
  }

  Write-Host "Created backup: $archivePath"
} finally {
  if (Test-Path $workDir) {
    Remove-Item -LiteralPath $workDir -Recurse -Force
  }
}
