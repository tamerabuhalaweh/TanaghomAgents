# Phase 6 Agent Registry controlled production update

Status: prepared for review only. No deployment is authorized by this document or by merging its pull request.

This package performs exactly two Tanaghom changes: apply `0022_agent_registry` on the deployed `0021_quality_baseline_shadow_pipeline` database and rebuild/recreate only the Tanaghom dashboard. It makes the Agents page display the live, versioned registry of four business roles and seven specialized workflow workers. It does not import, activate, execute, or edit an n8n workflow; call Gemma, Postiz, or GHL; change credentials or policy; send a message; alter Nginx/firewall rules; or operate on SmartLabs, SmartCC, voice, Gemma, or the protected n8n stack.

## Release invariants

- Production and release-source Git checkouts are clean and match separately approved full commit SHAs.
- Remote `main` equals the approved target commit.
- The database starts exactly at migration 0021.
- Postiz and GHL emergency stops remain active; Postiz and CRM modes remain manual; conversation processing remains paused.
- No external provider operation is created.
- At least 20 GiB remains available on `/`.
- Nine protected services and five protected n8n containers remain healthy and retain their identities.
- Firewall rules and `/etc/nginx/conf.d/tanaghom-public.conf` remain byte-for-byte unchanged.
- Only the Tanaghom dashboard image/container may be rebuilt or recreated.
- The registry contains exactly four roles and seven workers, with four imported inactive, three available but not imported, and zero active.
- n8n and conversation workers have no registry table access; the dashboard API has read-only access.

## 1. Prepare and prove the off-server database backup

Run on the authorized Windows recovery workstation, outside Git and not on the GPU server:

```powershell
$env:DATABASE_URL = '<current Supabase owner connection string>'
$releaseId = 'phase6-YYYYMMDDTHHMMSSZ'
pwsh -File .\deployment\phase6-agent-registry-production-update\scripts\prepare-offserver-backup.ps1 `
  -ReleaseId $releaseId `
  -OutputRoot 'D:\Tanaghom-Recovery'
Remove-Item Env:DATABASE_URL
```

The immutable PostgreSQL 17.6 backup tooling creates and verifies an isolated restoration before emitting:

- `tanaghom-database.7z`
- `tanaghom-database.7z.sha256`
- `recovery-key.dpapi`
- secret-free `backup-proof.env`

Keep the encrypted archive and DPAPI key off-server. Copy only `backup-proof.env` to a root-owned server staging path, set mode `0600`, and verify it reports migration 0021 and `RESTORE_VERIFIED=YES`.

## 2. Prepare the reviewed release checkout

After this package PR is merged, use a separate clean checkout without changing `/opt/tanaghom-dashboard`:

```sh
git clone --no-checkout git@github.com:tamerabuhalaweh/TanaghomAgents.git /opt/tanaghom-release-agent-registry
git -C /opt/tanaghom-release-agent-registry fetch --no-tags origin main
git -C /opt/tanaghom-release-agent-registry checkout --detach <TARGET_40_CHARACTER_SHA>
git -C /opt/tanaghom-release-agent-registry status --porcelain
```

## 3. Set the reviewed transaction identity

Use an interactive root shell only after Tamer separately authorizes production deployment:

```sh
export TANAGHOM_RELEASE_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_RELEASE_ID='phase6-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_CURRENT_COMMIT='<CURRENT_PRODUCTION_40_CHARACTER_SHA>'
export TANAGHOM_TARGET_COMMIT='<TARGET_40_CHARACTER_SHA>'
export TANAGHOM_BACKUP_PROOF='/root/tanaghom-agent-registry-backup-proof.env'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-agent-registry'
```

## 4. Run read-only preflight

```sh
/opt/tanaghom-release-agent-registry/deployment/phase6-agent-registry-production-update/scripts/preflight.sh
```

Preflight refuses missing authorization, dirty or mismatched Git state, an invalid restoration proof, less than 20 GiB free, any migration other than 0021, unsafe automation policy, external provider operations, unhealthy protected services, changed firewall/public authentication boundaries, or publicly reachable n8n.

If preflight fails, stop. Do not bypass or edit a check on the server.

## 5. Execute only after explicit deployment approval

```sh
/opt/tanaghom-release-agent-registry/deployment/phase6-agent-registry-production-update/scripts/deploy-update.sh
```

The transaction:

1. Re-runs preflight.
2. Captures root-only evidence in `/var/backups/tanaghom-$TANAGHOM_RELEASE_ID`.
3. Records protected container identities, firewall state, Nginx checksum, commits, migration hashes, dashboard image, and backup proof.
4. Tags the current dashboard image for rollback.
5. Checks out only the approved target commit.
6. Applies only migration `0022_agent_registry` with an exact 0021 predecessor check.
7. Builds and recreates only the Tanaghom dashboard.
8. Validates the exact registry, least privilege, authentication boundaries, health, protected identities, firewall state, Nginx checksum, and zero provider operations.
9. Marks the release committed only after every validation passes.

Before commit, any failure automatically restores the previous dashboard commit/image and rolls back only migration 0022. If the registry no longer matches the reviewed versioned seed, automatic schema rollback refuses rather than deleting unreviewed state.

## 6. Acceptance window

Keep emergency stops active and workflows inactive. Confirm the Agents page shows four business roles and seven specialized workers with honest import/activation blockers. Confirm the evidence directory contains `COMMITTED_AT` and does not contain `ROLLBACK_FAILED=YES`.

## 7. Exact rollback

Rollback is allowed only while the Agent Registry still matches the reviewed `tanaghom.agent-registry.v1` seed. All data owned by migrations 0001–0021 is preserved.

```sh
export TANAGHOM_ROLLBACK_AUTHORIZATION='ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE'
/opt/tanaghom-release-agent-registry/deployment/phase6-agent-registry-production-update/scripts/rollback-update.sh
unset TANAGHOM_ROLLBACK_AUTHORIZATION
```

The rollback verifies release evidence, protected identities, emergency stops, zero external operations, and the exact registry contract. It restores the recorded Git commit and dashboard image, applies only the 0022 down migration, then verifies the 0021 baseline and public boundary.

If rollback refuses because registry state differs from the reviewed seed, preserve the database and keep emergency stops active. Prepare a separately reviewed data-preserving recovery migration; never delete records merely to force a downgrade.

## 8. Environment cleanup

```sh
unset TANAGHOM_RELEASE_AUTHORIZATION TANAGHOM_RELEASE_ID \
  TANAGHOM_EXPECTED_CURRENT_COMMIT TANAGHOM_TARGET_COMMIT \
  TANAGHOM_BACKUP_PROOF TANAGHOM_PRODUCTION_ROOT TANAGHOM_RELEASE_SOURCE_ROOT
```

Release evidence and the rollback image remain until separately approved retention. This package contains no command that stops, restarts, removes, edits, or prunes SmartLabs, SmartCC, voice, Gemma, or the protected n8n stack.
