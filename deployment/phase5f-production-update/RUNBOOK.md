# Phase 5F controlled production update

Status: prepared for review only. No deployment is authorized by this document or by merging its pull request.

This package updates only the Tanaghom dashboard and its Supabase schema from `0014_supervised_conversation_ownership` through `0019_notification_monitoring_destinations`. It does not activate an n8n workflow, enable a provider, send a notification, change Nginx or firewall rules, or operate on SmartLabs, voice, Gemma, or the protected n8n stack.

## Release invariants

- Production and staging Git checkouts must be clean and match separately approved full commit SHAs.
- Remote `main` must equal the approved target commit.
- The database must start exactly at migration 0014.
- Postiz and GHL platform emergency stops must remain active.
- Postiz must remain manual; CRM contact sync must remain manual; conversation processing must remain paused.
- No external provider operation may exist.
- At least 20 GiB must remain available on `/`.
- The nine protected services and five protected n8n containers must be healthy.
- Protected container IDs, firewall rules, and the Tanaghom Nginx file are captured and must remain unchanged.
- Only the dashboard image/container may be rebuilt or recreated.
- Notification delivery remains runtime-unready and emergency-stopped after the update.

## 1. Prepare and prove the off-server backup

Run this on the authorized Windows recovery workstation, not on the GPU server. Use a fresh release ID and an output directory outside the Git repository. The script uses the immutable PostgreSQL 16 image for both source dump and isolated restore verification, creates an encrypted archive, and stores its recovery key with Windows DPAPI.

```powershell
$env:DATABASE_URL = '<current Supabase owner connection string>'
$releaseId = 'phase5f-YYYYMMDDTHHMMSSZ'
pwsh -File .\deployment\phase5f-production-update\scripts\prepare-offserver-backup.ps1 `
  -ReleaseId $releaseId `
  -OutputRoot 'D:\Tanaghom-Recovery'
Remove-Item Env:DATABASE_URL
```

Expected output files:

- `tanaghom-database.7z` - encrypted database archive
- `tanaghom-database.7z.sha256` - archive integrity checksum
- `recovery-key.dpapi` - recovery key encrypted for the Windows user
- `backup-proof.env` - secret-free proof copied to the reviewed server staging directory

Retain the archive and DPAPI key off-server. Do not copy them into Git or the GPU server. The proof must be mode `0600` on the server and report source migration 0014, a valid SHA-256, and `RESTORE_VERIFIED=YES`.

## 2. Prepare the reviewed staging checkout

After the pull request is merged, record the exact current production commit and exact new `main` commit. Create a separate clean server checkout for the target. This is preparation only and must not alter `/opt/tanaghom-dashboard`.

```sh
git clone --no-checkout git@github.com:tamerabuhalaweh/TanaghomAgents.git /opt/tanaghom-release-phase5f
git -C /opt/tanaghom-release-phase5f fetch --no-tags origin main
git -C /opt/tanaghom-release-phase5f checkout --detach <TARGET_40_CHARACTER_SHA>
git -C /opt/tanaghom-release-phase5f status --porcelain
```

Copy only `backup-proof.env` to a root-owned staging location and set mode `0600`.

## 3. Set the reviewed transaction identity

Use an interactive root shell only after Tamer provides separate deployment authorization for the reviewed Compose/script diff and rollback procedure.

```sh
export TANAGHOM_RELEASE_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_RELEASE_ID='phase5f-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_CURRENT_COMMIT='<CURRENT_PRODUCTION_40_CHARACTER_SHA>'
export TANAGHOM_TARGET_COMMIT='<TARGET_40_CHARACTER_SHA>'
export TANAGHOM_BACKUP_PROOF='/root/tanaghom-phase5f-backup-proof.env'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-phase5f'
```

## 4. Run read-only preflight

```sh
/opt/tanaghom-release-phase5f/deployment/phase5f-production-update/scripts/preflight.sh
```

Preflight refuses dirty or mismatched Git state, an invalid restoration proof, insufficient disk, an unexpected migration, inactive emergency stops, non-manual automation, existing provider operations, unhealthy protected services, missing firewall boundaries, changed public authentication boundaries, or a publicly reachable n8n port.

If preflight fails, stop. Do not bypass or edit a check on the server.

## 5. Execute only after explicit deployment approval

```sh
/opt/tanaghom-release-phase5f/deployment/phase5f-production-update/scripts/deploy-update.sh
```

The transaction performs these bounded actions in order:

1. Re-runs preflight.
2. Creates root-only evidence in `/var/backups/tanaghom-$TANAGHOM_RELEASE_ID`.
3. Captures protected container IDs, firewall state, Nginx checksum, current dashboard image, commit evidence, migration checksums, and backup proof.
4. Saves the current dashboard image under a release-specific rollback tag.
5. Checks out only the approved target commit in the production Tanaghom repository.
6. Applies migrations 0015, 0016, 0017, 0018, and 0019 one at a time with predecessor checks and an applied ledger.
7. Builds and recreates only the Tanaghom dashboard.
8. Validates schema locks, least privilege, public authentication boundaries, dashboard health, protected services, protected container identities, firewall state, and Nginx checksum.
9. Marks the transaction committed only after validation succeeds.

Before commit, any failure triggers automatic restoration of the previous dashboard and only the migrations recorded in the transaction ledger. It never uses a fixed rollback count.

## 6. Acceptance window

Keep all emergency stops active. Do not add a notification destination, change CRM/GHL automation or capacity policy, activate n8n, or make provider calls during the rollback acceptance window. Confirm the evidence directory includes `COMMITTED_AT` and does not include `ROLLBACK_FAILED=YES`.

## 7. Exact rollback

Rollback is permitted only while every Phase 5F customer/action table is empty and no external operation exists. This is intentional: migrations 0015-0019 include human approvals, immutable outcomes, cooldown state, and encrypted notification destinations that must never be silently deleted.

```sh
export TANAGHOM_ROLLBACK_AUTHORIZATION='ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE'
/opt/tanaghom-release-phase5f/deployment/phase5f-production-update/scripts/rollback-update.sh
unset TANAGHOM_ROLLBACK_AUTHORIZATION
```

The rollback verifies the exact release evidence, protected service identities, active emergency stops, zero external operations, and empty release tables. It restores the recorded Git commit and dashboard image, then runs only the recorded migrations in reverse order and verifies migration 0014 plus the public boundary.

If rollback refuses because Phase 5F data exists, preserve the database and keep emergency stops active. Do not delete records to force the downgrade. Prepare and review a separate data-preserving incident migration and recovery plan.

## 8. Environment cleanup

```sh
unset TANAGHOM_RELEASE_AUTHORIZATION TANAGHOM_RELEASE_ID \
  TANAGHOM_EXPECTED_CURRENT_COMMIT TANAGHOM_TARGET_COMMIT \
  TANAGHOM_BACKUP_PROOF TANAGHOM_PRODUCTION_ROOT TANAGHOM_RELEASE_SOURCE_ROOT
```

The release evidence and rollback image remain until a separately approved retention action. This package contains no command that stops, restarts, removes, edits, or prunes SmartLabs, voice, Gemma, or the protected n8n stack.
