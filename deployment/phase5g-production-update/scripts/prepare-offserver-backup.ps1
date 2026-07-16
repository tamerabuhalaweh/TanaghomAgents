[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^phase5g-\d{8}T\d{6}Z$')]
  [string]$ReleaseId,

  [Parameter(Mandatory = $true)]
  [string]$OutputRoot,

  [string]$ExpectedMigration = '0019_notification_monitoring_destinations'
)

& "$PSScriptRoot\..\..\production-database-backup\prepare-offserver-backup.ps1" `
  -ReleaseId $ReleaseId `
  -OutputRoot $OutputRoot `
  -ExpectedMigration $ExpectedMigration
