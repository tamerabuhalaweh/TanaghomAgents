# Phase 6 Campaign Lifecycle controlled production update

Status: prepared for review only. No deployment is authorized by this document or by merging its pull request.

This package performs exactly two Tanaghom changes: apply `0023_campaign_lifecycle` on the deployed `0022_agent_registry` database and rebuild/recreate only the Tanaghom dashboard. It enables governed campaign creation, authoritative campaign detail, brief revision, strategy/content queueing, content reconciliation, and readiness decisions. It does not import, activate, execute, or edit an n8n workflow; call Gemma, Postiz, or GHL; change credentials or automation policy; publish content; contact a lead; alter Nginx/firewall rules; or operate on SmartLabs, SmartCC, voice, Gemma, or the protected n8n stack.

## Release invariants

- Production and release-source Git checkouts are clean and match separately approved full commit SHAs.
- Remote `main` equals the approved target commit.
- The database starts exactly at migration `0022_agent_registry`.
- Postiz and GHL emergency stops remain active; Postiz and CRM modes remain manual; conversation processing remains paused.
- There are no external provider operations.
- At least 20 GiB remains available on `/`.
- Nine protected services and five protected n8n containers remain healthy and retain their identities.
- Firewall rules and `/etc/nginx/conf.d/tanaghom-public.conf` remain byte-for-byte unchanged.
- Only the Tanaghom dashboard image/container may be rebuilt or recreated.
- The four-role/seven-worker Agent Registry remains unchanged and every workflow remains inactive.
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
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-campaign-lifecycle'
```

## 4. Run read-only preflight

```sh
/opt/tanaghom-release-campaign-lifecycle/deployment/phase6-campaign-lifecycle-production-update/scripts/preflight.sh
```

Preflight refuses missing authorization, dirty or mismatched Git state, an invalid restoration proof, less than 20 GiB free, any migration other than 0022, unsafe automation policy, existing provider operations, unhealthy protected services, changed firewall/public authentication boundaries, or publicly reachable n8n. If preflight fails, stop; do not bypass a check on the server.

## 5. Execute only after explicit deployment approval

```sh
/opt/tanaghom-release-campaign-lifecycle/deployment/phase6-campaign-lifecycle-production-update/scripts/deploy-update.sh
```

The transaction:

1. Re-runs preflight.
2. Captures root-only evidence in `/var/backups/tanaghom-$TANAGHOM_RELEASE_ID`.
3. Records protected identities, firewall/Nginx state, Git commits, migration hashes, dashboard image, backup proof, and a campaign-domain fingerprint.
4. Tags the current dashboard image for rollback.
5. Checks out only the approved target commit.
6. Applies only migration `0023_campaign_lifecycle` with an exact 0022 predecessor check.
7. Builds and recreates only the Tanaghom dashboard.
8. Validates the new column/index/functions, least privilege, campaign/API authentication boundaries, zero domain/provider mutations, protected identities, and unchanged firewall/Nginx state.
9. Marks the release committed only after every validation passes.

Before commit, any failure automatically restores the previous dashboard commit/image and rolls back only migration 0023 when the campaign-domain fingerprint and content targets remain unchanged. If campaign data changed during the transaction, schema rollback refuses and preserves the data.

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
  TANAGHOM_BACKUP_PROOF TANAGHOM_PRODUCTION_ROOT TANAGHOM_RELEASE_SOURCE_ROOT
```

Release evidence and the rollback image remain until separately approved retention. This package contains no command that stops, restarts, removes, edits, or prunes SmartLabs, SmartCC, voice, Gemma, or the protected n8n stack.
