[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^phase5f-\d{8}T\d{6}Z$')]
  [string]$ReleaseId,

  [Parameter(Mandatory = $true)]
  [string]$OutputRoot,

  [string]$ExpectedMigration = '0014_supervised_conversation_ownership'
)

& "$PSScriptRoot\..\..\production-database-backup\prepare-offserver-backup.ps1" @PSBoundParameters
