[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^phase6-\d{8}T\d{6}Z$')]
  [string]$ReleaseId,

  [Parameter(Mandatory = $true)]
  [string]$OutputRoot,

  [string]$ExpectedMigration = '0022_agent_registry'
)

& "$PSScriptRoot\..\..\production-database-backup\prepare-offserver-backup.ps1" `
  -ReleaseId $ReleaseId `
  -OutputRoot $OutputRoot `
  -ExpectedMigration $ExpectedMigration
