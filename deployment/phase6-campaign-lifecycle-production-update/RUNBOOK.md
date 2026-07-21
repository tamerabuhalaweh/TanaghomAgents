# Phase 6 Campaign Lifecycle controlled production update

Status: prepared for review only. No deployment is authorized by this document or by merging its pull request.

This package performs exactly two Tanaghom changes: apply `0023_campaign_lifecycle` on the deployed `0022_agent_registry` database and rebuild/recreate only the Tanaghom dashboard. It enables governed campaign creation, authoritative campaign detail, brief revision, strategy/content queueing, content reconciliation, and readiness decisions. It does not import, activate, execute, or edit an n8n workflow; call Gemma, Postiz, or GHL; change credentials or automation policy; publish content; contact a lead; alter Nginx/firewall rules; or operate on SmartLabs, SmartCC, voice, Gemma, or the protected n8n stack.

## Interrupted release recovery

The first authorized production attempt, `phase6-20260721T100731Z`, applied migration `0023_campaign_lifecycle` and built the reviewed dashboard, then refused final validation because two Agent Registry rows had legitimate historical `updated_at` values from July 19. The validator incorrectly assumed every registry row must have `updated_at=created_at`. Its automatic path restored the previous Tanaghom source commit and dashboard image but deliberately left the additive migration in place when the over-strict registry guard refused schema downgrade. Public health remained ready, provider operations remained zero, workflows remained inactive, emergency stops remained active, and the preserved Squid file retained its reviewed checksum.

The corrected design captures a complete Agent Registry fingerprint immediately before each transaction and compares that fingerprint afterward. Historical reviewed changes are accepted; any change during the release is refused. It also runs rollback assertions in isolated subshells so a refusal cannot abort rollback evidence recording. For the observed migration-0023/previous-dashboard state, `resume-preflight.sh` and `resume-update.sh` provide a dashboard-only completion path that applies no SQL and cannot downgrade the database. No deployment or resume is authorized by merging this correction.

## Release invariants

- The release-source checkout is clean and both checkouts match separately approved full commit SHAs.
- The production checkout contains exactly one reviewed local change: `deployment/phase4-postiz-activation/egress/squid.conf` at the explicitly supplied SHA-256 checksum. The file is identical in Git at the current and target commits, is preserved across checkout, and is never edited, reloaded, or restarted by this package.
- Remote `main` equals the approved target commit.
- The database starts exactly at migration `0022_agent_registry`.
- Postiz and GHL emergency stops remain active; Postiz and CRM modes remain manual; conversation processing remains paused.
- There are no external provider operations.
- At least 20 GiB remains available on `/`.
- Nine protected services and five protected n8n containers remain healthy and retain their identities.
- Firewall rules and `/etc/nginx/conf.d/tanaghom-public.conf` remain byte-for-byte unchanged.
- Only the Tanaghom dashboard image/container may be rebuilt or recreated.
- The four-role/seven-worker Agent Registry is fingerprinted at transaction start, remains byte-for-byte unchanged during the release, and every workflow remains inactive. Historical reviewed timestamps are preserved.
- Only `tanaghom_api` may execute the new campaign-control functions; n8n, readonly, and PUBLIC cannot.
- The deployment itself creates no campaign, job, draft, approval, outbox event, provider operation, or audit action.

## 1. Prepare and prove the off-server database backup

Run on the authorized Windows recovery workstation, outside Git and not on the GPU server:

```powershell
$env:DATABASE_URL = '<current Supabase owner connection string>'
$releaseId = 'phase6-YYYYMMDDTHHMMSSZ'
pwsh -File .\deployment\phase6-campaign-lifecycle-production-update\scripts\prepare-offserver-backup.ps1 `
  -ReleaseId $releaseId `
  -OutputRoot 'D:\Tanaghom-Recovery'
Remove-Item Env:DATABASE_URL
```

The immutable PostgreSQL 17.6 tooling encrypts the archive and verifies a real isolated restoration. Keep the archive and DPAPI key off-server. Copy only the secret-free `backup-proof.env` to a root-owned server path, set mode `0600`, and verify that it reports migration 0022 and `RESTORE_VERIFIED=YES`.

## 2. Prepare the reviewed release checkout

After this package PR is merged, use a separate clean checkout without changing `/opt/tanaghom-dashboard`:

```sh
git clone --no-checkout git@github.com:tamerabuhalaweh/TanaghomAgents.git /opt/tanaghom-release-campaign-lifecycle
git -C /opt/tanaghom-release-campaign-lifecycle fetch --no-tags origin main
git -C /opt/tanaghom-release-campaign-lifecycle checkout --detach <TARGET_40_CHARACTER_SHA>
git -C /opt/tanaghom-release-campaign-lifecycle status --porcelain
```

## 3. Set the reviewed transaction identity

Use an interactive root shell only after Tamer separately authorizes production deployment:

```sh
export TANAGHOM_RELEASE_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_RELEASE_ID='phase6-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_CURRENT_COMMIT='<CURRENT_PRODUCTION_40_CHARACTER_SHA>'
export TANAGHOM_TARGET_COMMIT='<TARGET_40_CHARACTER_SHA>'
export TANAGHOM_BACKUP_PROOF='/root/tanaghom-campaign-lifecycle-backup-proof.env'
export TANAGHOM_PRESERVED_FILE_SHA256='<REVIEWED_64_CHARACTER_LOWERCASE_SHA256>'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-campaign-lifecycle'
```

## 4. Run read-only preflight

```sh
/opt/tanaghom-release-campaign-lifecycle/deployment/phase6-campaign-lifecycle-production-update/scripts/preflight.sh
```

Preflight refuses missing authorization, any unreviewed working-tree change, a changed or commit-conflicting preserved Squid file, mismatched Git state, an invalid restoration proof, less than 20 GiB free, any migration other than 0022, unsafe automation policy, existing provider operations, unhealthy protected services, changed firewall/public authentication boundaries, or publicly reachable n8n. If preflight fails, stop; do not bypass a check on the server.

## 5. Execute only after explicit deployment approval

```sh
/opt/tanaghom-release-campaign-lifecycle/deployment/phase6-campaign-lifecycle-production-update/scripts/deploy-update.sh
```

The transaction:

1. Re-runs preflight.
2. Captures root-only evidence in `/var/backups/tanaghom-$TANAGHOM_RELEASE_ID`.
3. Records protected identities, firewall/Nginx state, the preserved Squid checksum, Git commits, migration hashes, dashboard image, backup proof, and a campaign-domain fingerprint.
4. Tags the current dashboard image for rollback.
5. Checks out only the approved target commit.
6. Applies only migration `0023_campaign_lifecycle` with an exact 0022 predecessor check.
7. Builds and recreates only the Tanaghom dashboard.
8. Validates the new column/index/functions, least privilege, campaign/API authentication boundaries, zero domain/provider mutations, protected identities, and unchanged Squid/firewall/Nginx state.
9. Marks the release committed only after every validation passes.

Before commit, any failure automatically restores the previous dashboard commit/image and rolls back only migration 0023 when the campaign-domain fingerprint and content targets remain unchanged. If campaign data changed during the transaction, schema rollback refuses and preserves the data.

## 5A. Complete the observed interrupted release

Use this path only when the database is already at `0023_campaign_lifecycle`, production Git and the running dashboard have been restored to the recorded pre-release state, and the interrupted release evidence remains at `/var/backups/tanaghom-phase6-20260721T100731Z`. It does not execute an up or down migration.

Prepare a new clean release checkout at the merged corrective commit and a new unique release ID. Reuse the already verified off-server backup proof by explicitly binding it to the interrupted release:

```sh
export TANAGHOM_RELEASE_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_RESUME_AUTHORIZATION='RESUME-THE-REVIEWED-TANAGHOM-RELEASE'
export TANAGHOM_RESUME_SOURCE_RELEASE_ID='phase6-20260721T100731Z'
export TANAGHOM_BACKUP_RELEASE_ID='phase6-20260721T100731Z'
export TANAGHOM_RELEASE_ID='phase6-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_CURRENT_COMMIT='<RESTORED_PREVIOUS_40_CHARACTER_SHA>'
export TANAGHOM_TARGET_COMMIT='<MERGED_CORRECTIVE_40_CHARACTER_SHA>'
export TANAGHOM_BACKUP_PROOF='/root/tanaghom-campaign-lifecycle-backup-proof.env'
export TANAGHOM_PRESERVED_FILE_SHA256='<REVIEWED_64_CHARACTER_LOWERCASE_SHA256>'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-campaign-lifecycle-correction'

/opt/tanaghom-release-campaign-lifecycle-correction/deployment/phase6-campaign-lifecycle-production-update/scripts/resume-preflight.sh
```

The resume preflight proves the prior release never committed, the exact migration file already applied is unchanged, migration 0023 is structurally present, no governed campaign data changed, the restored dashboard image matches the prior evidence, workflows remain inactive, provider operations remain zero, and all protected boundaries remain healthy.

Only after separate owner authorization, execute:

```sh
/opt/tanaghom-release-campaign-lifecycle-correction/deployment/phase6-campaign-lifecycle-production-update/scripts/resume-update.sh
```

The resume transaction snapshots the current campaign and Agent Registry data, checks out the approved corrective commit, builds/recreates only the Tanaghom dashboard, and runs full release validation. It never calls `db_file`, never applies or reverses SQL, and on failure restores only the previous Tanaghom source/image. After a committed resume, use the dashboard-only rollback in section 8; do not run the schema rollback in section 7 against resume evidence.

## 6. Acceptance window

Keep emergency stops active and workflows inactive. First confirm:

- `/campaigns` opens for an authenticated owner/operator.
- Create campaign displays the real form and creates a zero-budget `.test` draft.
- The campaign detail page shows its brief, current state, timeline, jobs, strategy, drafts, approvals, audit evidence, and exact next action.
- Queueing strategy creates one internal job only; it does not publish, contact a lead, or spend budget.

Creating or changing a campaign intentionally makes schema downgrade unsafe. From that point, use the dashboard-only rollback below if the UI must be reverted.

## 7. Exact rollback before campaign data changes

This rollback restores the previous dashboard and removes only migration 0023. It refuses if the campaign-domain fingerprint or any content target changed, preserving customer data instead of forcing a downgrade.

```sh
export TANAGHOM_ROLLBACK_AUTHORIZATION='ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE'
/opt/tanaghom-release-campaign-lifecycle/deployment/phase6-campaign-lifecycle-production-update/scripts/rollback-update.sh
unset TANAGHOM_ROLLBACK_AUTHORIZATION
```

## 8. Exact dashboard-only rollback after UAT/data changes

This restores the recorded previous dashboard commit/image while preserving migration 0023 and all campaign data:

```sh
export TANAGHOM_ROLLBACK_AUTHORIZATION='ROLLBACK-THE-AUTHORIZED-TANAGHOM-DASHBOARD'
/opt/tanaghom-release-campaign-lifecycle/deployment/phase6-campaign-lifecycle-production-update/scripts/rollback-dashboard-only.sh
unset TANAGHOM_ROLLBACK_AUTHORIZATION
```

The additive 0023 schema is compatible with the previous dashboard. A later schema downgrade, if ever required after customer use, must be a separately reviewed data-preserving migration.

## 9. Environment cleanup

```sh
unset TANAGHOM_RELEASE_AUTHORIZATION TANAGHOM_RELEASE_ID \
  TANAGHOM_EXPECTED_CURRENT_COMMIT TANAGHOM_TARGET_COMMIT \
  TANAGHOM_BACKUP_PROOF TANAGHOM_PRESERVED_FILE_SHA256 \
  TANAGHOM_PRODUCTION_ROOT TANAGHOM_RELEASE_SOURCE_ROOT \
  TANAGHOM_RESUME_AUTHORIZATION TANAGHOM_RESUME_SOURCE_RELEASE_ID \
  TANAGHOM_BACKUP_RELEASE_ID
```

Release evidence and the rollback image remain until separately approved retention. This package contains no command that stops, restarts, removes, edits, reloads, or prunes Squid, SmartLabs, SmartCC, voice, Gemma, or the protected n8n stack.
