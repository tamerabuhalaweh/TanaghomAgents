[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^phase5d-\d{8}T\d{6}Z$')]
  [string]$ReleaseId,

  [Parameter(Mandatory = $true)]
  [string]$OutputRoot,

  [string]$ExpectedMigration = '0009_postiz_automation_controls'
)

$ErrorActionPreference = 'Stop'
$postgresImage = 'postgres:16.14-alpine3.24@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777'
$databaseUrl = $env:DATABASE_URL
if ([string]::IsNullOrWhiteSpace($databaseUrl)) { throw 'DATABASE_URL must be supplied through the process environment.' }

foreach ($command in 'pg_dump', 'psql', '7z', 'docker') {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Required command is unavailable: $command" }
}

$destination = Join-Path ([System.IO.Path]::GetFullPath($OutputRoot)) $ReleaseId
if (Test-Path -LiteralPath $destination) { throw "Backup destination already exists: $destination" }
New-Item -ItemType Directory -Path $destination | Out-Null
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) "tanaghom-$ReleaseId-$PID"
New-Item -ItemType Directory -Path $temporary | Out-Null
$dump = Join-Path $temporary 'tanaghom.dump'
$archive = Join-Path $destination 'tanaghom-database.7z'
$recoveryKey = Join-Path $destination 'recovery-key.dpapi'
$checksum = Join-Path $destination 'tanaghom-database.7z.sha256'
$proof = Join-Path $destination 'backup-proof.env'
$container = "tanaghom-restore-$($ReleaseId.ToLowerInvariant())-$PID"
$containerStarted = $false

try {
  $liveMigration = (& psql $databaseUrl -X -v ON_ERROR_STOP=1 -At -c 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;').Trim()
  if ($LASTEXITCODE -ne 0 -or $liveMigration -ne $ExpectedMigration) { throw "Unexpected source migration: $liveMigration" }

  & pg_dump $databaseUrl --format=custom --no-owner --no-acl --schema=public --schema=tanaghom --file=$dump
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $dump)) { throw 'pg_dump failed.' }

  $passwordBytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
  $archivePassword = [Convert]::ToBase64String($passwordBytes)
  & 7z a -t7z -mhe=on "-p$archivePassword" $archive $dump | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Encrypted archive creation failed.' }
  & 7z t "-p$archivePassword" $archive | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Encrypted archive verification failed.' }

  $archivePassword | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $recoveryKey -Encoding utf8NoBOM
  $archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  "$archiveHash  tanaghom-database.7z" | Set-Content -LiteralPath $checksum -Encoding ascii

  & docker pull $postgresImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Pinned PostgreSQL restore image pull failed.' }
  & docker run -d --network none --name $container -e POSTGRES_PASSWORD=restore-only -e POSTGRES_DB=restore_test $postgresImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL restore container failed to start.' }
  $containerStarted = $true

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec $container pg_isready -U postgres -d restore_test | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw 'Disposable PostgreSQL restore container was not ready.' }

  & docker cp $dump "${container}:/tmp/tanaghom.dump" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy the archive into the disposable restore container.' }
  & docker exec $container pg_restore -U postgres -d restore_test --no-owner --no-acl --clean --if-exists --exit-on-error /tmp/tanaghom.dump
  if ($LASTEXITCODE -ne 0) { throw 'Actual disposable database restoration failed.' }
  $restoredMigration = (& docker exec $container psql -U postgres -d restore_test -X -v ON_ERROR_STOP=1 -At -c 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;').Trim()
  if ($LASTEXITCODE -ne 0 -or $restoredMigration -ne $ExpectedMigration) { throw "Restored migration mismatch: $restoredMigration" }
  & docker exec $container psql -U postgres -d restore_test -X -v ON_ERROR_STOP=1 -At -c "SELECT count(*) FROM tanaghom.organizations;" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Restored Tanaghom schema verification failed.' }

  @(
    "RELEASE_ID=$ReleaseId",
    "SOURCE_MIGRATION=$ExpectedMigration",
    "ARCHIVE_SHA256=$archiveHash",
    'RESTORE_VERIFIED=YES',
    "CREATED_AT=$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))"
  ) | Set-Content -LiteralPath $proof -Encoding ascii

  Write-Output "PASS: encrypted off-server backup and actual disposable restore completed: $destination"
  Write-Output "Copy only backup-proof.env to the reviewed server staging directory; retain the encrypted archive and DPAPI key off-server."
}
finally {
  if ($containerStarted) { & docker rm -f $container | Out-Null }
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
  $databaseUrl = $null
  $archivePassword = $null
}
