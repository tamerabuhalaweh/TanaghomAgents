# Phase 5F database-only bridge: migration 0009 to 0014

Status: prepared for review only. Merging this package does not authorize a production connection or execution.

This bridge exists because live production is at `0009_postiz_automation_controls`, while the Phase 5F dashboard transaction requires `0014_supervised_conversation_ownership`. It applies migrations 0010-0014 without checking out production source, building an image, recreating a container, changing Nginx/firewall, or activating a workflow/provider.

## Non-negotiable boundaries

- No dashboard image is built and no dashboard container is recreated.
- `/opt/tanaghom-dashboard` remains at the exact authorized current commit.
- The nine protected services and five protected n8n containers remain healthy and keep the same IDs.
- Postiz and GHL emergency stops remain active; Postiz remains manual; CRM sync remains manual; conversation processing remains paused.
- No external operation, GHL event, knowledge record, conversation, draft, lease, metric, or attribution record may enter the bridge tables.
- Firewall and Nginx checksums remain unchanged.
- Public login/root/API behavior remains 200/307/401, while monitoring/notification endpoints remain 404 because the old dashboard intentionally keeps running.
- At least 20 GiB must remain free on `/`.

## 1. Create the pre-bridge encrypted backup

Run on the authorized Windows recovery workstation. Use a new release ID and a destination outside Git. The shared backup uses immutable PostgreSQL 17.6, encrypts the archive, verifies its checksum, restores it into a uniquely named `--network none` PostgreSQL container, and checks migration/schema content.

```powershell
$env:DATABASE_URL = '<current Supabase owner connection string>'
$releaseId = 'phase5f-YYYYMMDDTHHMMSSZ'
pwsh -File .\deployment\phase5f-database-bridge\scripts\prepare-offserver-backup.ps1 `
  -ReleaseId $releaseId `
  -OutputRoot 'D:\Tanaghom-Recovery'
Remove-Item Env:DATABASE_URL
```

The proof must report:

- the same release ID;
- source migration `0009_postiz_automation_controls`;
- `RESTORE_VERIFIED=YES`;
- the approved immutable PostgreSQL 17.6 client identity;
- a valid archive SHA-256.

Keep the encrypted archive and DPAPI key off-server. Copy only `backup-proof.env` to a root-owned server staging location with mode `0600`.

## 2. Prepare the reviewed release checkout

After this corrective PR is merged, create a separate clean checkout at the exact merged target. Do not modify the production checkout.

```sh
git clone --no-checkout git@github.com:tamerabuhalaweh/TanaghomAgents.git /opt/tanaghom-release-phase5f-bridge
git -C /opt/tanaghom-release-phase5f-bridge fetch --no-tags origin main
git -C /opt/tanaghom-release-phase5f-bridge checkout --detach <TARGET_40_CHARACTER_SHA>
git -C /opt/tanaghom-release-phase5f-bridge status --porcelain
```

## 3. Set the exact reviewed identity

Only after a separate owner authorization:

```sh
export TANAGHOM_RELEASE_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_RELEASE_ID='phase5f-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_CURRENT_COMMIT='68edbc0bde370ba07e756ee4e5203d9a35661623'
export TANAGHOM_TARGET_COMMIT='<TARGET_40_CHARACTER_SHA>'
export TANAGHOM_BACKUP_PROOF='/root/tanaghom-bridge-backup-proof.env'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-phase5f-bridge'
```

The expected current commit is evidence from the July 15, 2026 read-only preflight. Reconfirm it; never bypass a mismatch.

## 4. Read-only preflight

```sh
/opt/tanaghom-release-phase5f-bridge/deployment/phase5f-database-bridge/scripts/preflight.sh
```

Stop on any refusal. Do not edit a production check to make it pass.

## 5. Execute the database-only bridge

This remains unauthorized until Tamer approves the merged target, fresh 0009 backup proof, preflight evidence, and rollback commands.

```sh
/opt/tanaghom-release-phase5f-bridge/deployment/phase5f-database-bridge/scripts/deploy-bridge.sh
```

The transaction:

1. Re-runs preflight.
2. Captures root-only Git, dashboard identity, protected-container IDs, firewall, Nginx, migration checksums, and backup evidence.
3. Applies exactly 0010, 0011, 0012, 0013, and 0014 with predecessor checks and an applied ledger.
4. Validates locked policies, empty bridge tables, least privilege, public health, and unchanged dashboard/protected identities.
5. Automatically reverses only ledger-recorded migrations if validation fails before commit.

There is no Git checkout, Docker build/pull/up/down/restart/remove, systemd action, firewall action, or Nginx action in the bridge scripts.

## 6. Acceptance window and exact rollback

Do not configure GHL, activate a provider, import/activate a workflow, add knowledge, or use the new conversation APIs before the fresh 0014 backup is complete.

Rollback is allowed only while every bridge table is empty and organization policies remain at generated defaults:

```sh
export TANAGHOM_ROLLBACK_AUTHORIZATION='ROLLBACK-THE-AUTHORIZED-TANAGHOM-BRIDGE'
/opt/tanaghom-release-phase5f-bridge/deployment/phase5f-database-bridge/scripts/rollback-bridge.sh
unset TANAGHOM_ROLLBACK_AUTHORIZATION
```

If rollback refuses, preserve the data and keep emergency stops active. Never delete records to force a downgrade.

## 7. Mandatory post-bridge 0014 backup

After bridge validation and before Phase 5F dashboard deployment, use a **new** Phase 5F release ID:

```powershell
$env:DATABASE_URL = '<current Supabase owner connection string>'
$phase5fReleaseId = 'phase5f-YYYYMMDDTHHMMSSZ'
pwsh -File .\deployment\phase5f-production-update\scripts\prepare-offserver-backup.ps1 `
  -ReleaseId $phase5fReleaseId `
  -OutputRoot 'D:\Tanaghom-Recovery'
Remove-Item Env:DATABASE_URL
```

The resulting proof must report source migration `0014_supervised_conversation_ownership`, PostgreSQL 17.6, and a verified restore. Only that fresh proof may authorize the later 0015-0019 dashboard transaction.

## 8. Cleanup environment variables

```sh
unset TANAGHOM_RELEASE_AUTHORIZATION TANAGHOM_RELEASE_ID \
  TANAGHOM_EXPECTED_CURRENT_COMMIT TANAGHOM_TARGET_COMMIT \
  TANAGHOM_BACKUP_PROOF TANAGHOM_PRODUCTION_ROOT TANAGHOM_RELEASE_SOURCE_ROOT
```

Evidence and encrypted backups remain until a separately approved retention action. This runbook never authorizes any SmartLabs, voice, Gemma, n8n, firewall, or dashboard mutation.
