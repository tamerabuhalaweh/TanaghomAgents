[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^phase5f-\d{8}T\d{6}Z$')]
  [string]$ReleaseId,

  [Parameter(Mandatory = $true)]
  [string]$OutputRoot,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d{4}_[a-z0-9_]+$')]
  [string]$ExpectedMigration
)

$ErrorActionPreference = 'Stop'
$postgresImage = 'postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'
$databaseUrl = $env:DATABASE_URL
if ([string]::IsNullOrWhiteSpace($databaseUrl)) { throw 'DATABASE_URL must be supplied through the process environment.' }

foreach ($command in '7z', 'docker') {
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
$sourceContainer = "tanaghom-dump-$($ReleaseId.ToLowerInvariant())-$PID"
$restoreContainer = "tanaghom-restore-$($ReleaseId.ToLowerInvariant())-$PID"
$restoreStarted = $false
$bindMount = "type=bind,source=$temporary,target=/backup"

try {
  & docker pull $postgresImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Pinned PostgreSQL image pull failed.' }

  $sourceQueryCommand = 'exec psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c ''SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;'''
  $liveMigrationOutput = & docker run --rm --name $sourceContainer -e DATABASE_URL $postgresImage `
    sh -ec $sourceQueryCommand
  $sourceStatus = $LASTEXITCODE
  $liveMigration = if ($null -eq $liveMigrationOutput) { '' } else { ($liveMigrationOutput -join "`n").Trim() }
  if ($sourceStatus -ne 0 -or $liveMigration -ne $ExpectedMigration) { throw "Unexpected source migration (exit $sourceStatus): $liveMigration" }

  $sourceDumpCommand = 'exec pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --schema=public --schema=tanaghom --file=/backup/tanaghom.dump'
  & docker run --rm --name $sourceContainer -e DATABASE_URL --mount $bindMount $postgresImage `
    sh -ec $sourceDumpCommand
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $dump)) { throw 'Pinned PostgreSQL pg_dump failed.' }

  $passwordBytes = New-Object byte[] 48
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($passwordBytes) } finally { $random.Dispose() }
  $archivePassword = [Convert]::ToBase64String($passwordBytes)
  & 7z a -t7z -mhe=on "-p$archivePassword" $archive $dump | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Encrypted archive creation failed.' }
  & 7z t "-p$archivePassword" $archive | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Encrypted archive verification failed.' }

  $archivePassword | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $recoveryKey -Encoding UTF8
  $archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  "$archiveHash  tanaghom-database.7z" | Set-Content -LiteralPath $checksum -Encoding ascii

  & docker run -d --network none --name $restoreContainer --mount "$bindMount,readonly" `
    -e POSTGRES_PASSWORD=restore-only -e POSTGRES_DB=restore_test $postgresImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL restore container failed to start.' }
  $restoreStarted = $true

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec $restoreContainer pg_isready -U postgres -d restore_test | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw 'Disposable PostgreSQL restore container was not ready.' }

  & docker exec $restoreContainer pg_restore -U postgres -d restore_test --no-owner --no-acl --clean --if-exists --exit-on-error /backup/tanaghom.dump
  if ($LASTEXITCODE -ne 0) { throw 'Actual disposable database restoration failed.' }
  $restoredMigrationOutput = & docker exec $restoreContainer psql -U postgres -d restore_test -X -v ON_ERROR_STOP=1 -At -c 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;'
  $restoreStatus = $LASTEXITCODE
  $restoredMigration = if ($null -eq $restoredMigrationOutput) { '' } else { ($restoredMigrationOutput -join "`n").Trim() }
  if ($restoreStatus -ne 0 -or $restoredMigration -ne $ExpectedMigration) { throw "Restored migration mismatch: $restoredMigration" }
  & docker exec $restoreContainer psql -U postgres -d restore_test -X -v ON_ERROR_STOP=1 -At -c 'SELECT count(*) FROM tanaghom.organizations;' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Restored Tanaghom schema verification failed.' }

  @(
    "RELEASE_ID=$ReleaseId",
    "SOURCE_MIGRATION=$ExpectedMigration",
    "ARCHIVE_SHA256=$archiveHash",
    'RESTORE_VERIFIED=YES',
    'POSTGRES_CLIENT=17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94',
    "CREATED_AT=$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))"
  ) | Set-Content -LiteralPath $proof -Encoding ascii

  Write-Output "PASS: encrypted off-server backup and actual disposable restore completed: $destination"
  Write-Output 'Copy only backup-proof.env to the reviewed server staging directory; retain the encrypted archive and DPAPI key off-server.'
}
finally {
  if ($restoreStarted) { & docker rm -f $restoreContainer | Out-Null }
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
  $databaseUrl = $null
  $archivePassword = $null
}
