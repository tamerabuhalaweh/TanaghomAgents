# Phase 5G baseline-shadow controlled production update

Status: prepared for review only. **No deployment is authorized by this document or by merging its pull request.**

This successor package starts from the already deployed `0020_quality_rollout_control` baseline and performs exactly three Tanaghom changes: apply `0021_quality_baseline_shadow_pipeline`, rebuild/recreate only the Tanaghom dashboard, and import exactly one reviewed Quality Shadow Evaluator workflow into the existing n8n database with `active=false` and its schedule node disabled. It does not execute the workflow, change credentials, publish an n8n version, restart/recreate an n8n container, call Gemma, import customer evidence, promote the quality stage, send a message, alter Nginx/firewall rules, or operate on SmartLabs, SmartCC, voice, or Gemma services.

## Release invariants

- Both Git checkouts are clean and match separately approved full SHAs; remote `main` equals the target.
- The Tanaghom database starts exactly at migration 0020, quality stage `baseline`, with zero snapshots, decisions, or external operations.
- A PostgreSQL 17.6 encrypted off-server backup is restored and verified before preflight.
- All provider emergency stops remain active; Postiz/GHL modes remain manual/paused/disabled.
- Root disk has at least 20 GiB free.
- Nine protected services and all five existing n8n containers remain healthy with unchanged container IDs.
- The workflow ID `phase5gQualityShadowEvaluatorV1` and its execution history are absent before import.
- The reviewed export is inactive, has one disabled schedule, uses only the restricted PostgreSQL/Gemma credentials, and excludes command/file/SSH nodes.
- Existing n8n workflows are exported before and after; after removing the new ID, the exports must be byte-equivalent when normalized.
- The new workflow must remain inactive with zero executions. `n8n audit` evidence is mandatory.
- Nginx and firewall state remain unchanged.

## 1. Prepare the verified off-server backup

Run on the authorized Windows recovery workstation, outside Git:

```powershell
$env:DATABASE_URL = '<current Supabase owner connection string>'
$releaseId = 'phase5g-YYYYMMDDTHHMMSSZ'
pwsh -File .\deployment\phase5g-shadow-production-update\scripts\prepare-offserver-backup.ps1 `
  -ReleaseId $releaseId `
  -OutputRoot 'D:\Tanaghom-Recovery'
Remove-Item Env:DATABASE_URL
```

Retain the encrypted archive and DPAPI recovery key off-server. Copy only `backup-proof.env` to the reviewed server staging path with root ownership and mode `0600`. It must report `SOURCE_MIGRATION=0020_quality_rollout_control` and `RESTORE_VERIFIED=YES`.

## 2. Prepare the reviewed checkout

After this package PR is merged, create or refresh a separate clean checkout without altering `/opt/tanaghom-dashboard`:

```sh
git clone --no-checkout git@github.com:tamerabuhalaweh/TanaghomAgents.git /opt/tanaghom-release-phase5g-shadow
git -C /opt/tanaghom-release-phase5g-shadow fetch --no-tags origin main
git -C /opt/tanaghom-release-phase5g-shadow checkout --detach <TARGET_40_CHARACTER_SHA>
git -C /opt/tanaghom-release-phase5g-shadow status --porcelain
```

## 3. Set transaction identity and run read-only preflight

Only after Tamer separately approves the final package diff and rollback procedure:

```sh
export TANAGHOM_RELEASE_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_RELEASE_ID='phase5g-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_CURRENT_COMMIT='<CURRENT_PRODUCTION_40_CHARACTER_SHA>'
export TANAGHOM_TARGET_COMMIT='<TARGET_40_CHARACTER_SHA>'
export TANAGHOM_BACKUP_PROOF='/root/tanaghom-phase5g-shadow-backup-proof.env'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-phase5g-shadow'
/opt/tanaghom-release-phase5g-shadow/deployment/phase5g-shadow-production-update/scripts/preflight.sh
```

Preflight is read-only except for temporary n8n CLI/database reads. Any mismatch is a hard stop; do not bypass it on the server.

## 4. Execute only after separate deployment approval

```sh
/opt/tanaghom-release-phase5g-shadow/deployment/phase5g-shadow-production-update/scripts/deploy-update.sh
```

The transaction captures protected identities, firewall/Nginx state, full n8n workflow exports, migration/workflow hashes, the previous dashboard image, and backup proof. It applies only 0021, rebuilds only the dashboard, imports the one workflow explicitly inactive, proves existing workflows unchanged, runs `n8n audit`, and validates zero executions/provider operations. Before commit, any failure attempts to delete only the new inactive workflow, restore the previous dashboard commit/image, and roll back only 0021.

Workflow exports are written first to a uniquely named file under the n8n container user's persistent home, verified non-empty, copied to the root-only release evidence directory, and deleted from the container. The reviewed workflow upload uses the same persistent home boundary: the file is copied in, verified non-empty and non-root-readable, imported explicitly inactive, and removed on both success and automatic rollback. The disposable lifecycle test exercises both host-to-container import and container-to-host export `docker cp` boundaries.

Because Docker creates the uploaded file as container root while the home directory is owned by `node`, temporary-file unlinking runs as the directory owner. Temporary cleanup has a separate `ROLLBACK_CLEANUP_FAILED` evidence flag and can never suppress workflow deletion, dashboard restoration, or migration rollback.

If any attempt fails, preserve its evidence directory unchanged. Do not delete, rename, or reuse it to force a retry. Prepare a new release ID, a newly restore-verified backup proof with that release ID, and a new detached release checkout at the newly approved target commit.

## 5. Acceptance window

Keep all emergency stops active. Do not approve metric rules, import customer conversations, promote to shadow, activate/publish the n8n workflow, execute it, or call any provider. Confirm `COMMITTED_AT` exists and `ROLLBACK_FAILED=YES` does not.

## 6. Exact rollback

Rollback is allowed only while the new tables contain no metric/dataset evidence, the quality stage is still `baseline`, the workflow remains inactive, and it has zero executions:

```sh
export TANAGHOM_ROLLBACK_AUTHORIZATION='ROLLBACK-THE-AUTHORIZED-TANAGHOM-SHADOW-RELEASE'
/opt/tanaghom-release-phase5g-shadow/deployment/phase5g-shadow-production-update/scripts/rollback-update.sh
unset TANAGHOM_ROLLBACK_AUTHORIZATION
```

Rollback deletes exactly `phase5gQualityShadowEvaluatorV1` through the pinned n8n PostgreSQL schema, re-exports and compares all pre-existing workflows, restores the recorded dashboard commit/image, applies only the 0021 down migration, and verifies the 0020 baseline. It never deletes customer quality evidence to force a downgrade; if evidence or an execution exists, rollback refuses and requires a separately reviewed data-preserving recovery plan.

## 7. Cleanup

```sh
unset TANAGHOM_RELEASE_AUTHORIZATION TANAGHOM_RELEASE_ID \
  TANAGHOM_EXPECTED_CURRENT_COMMIT TANAGHOM_TARGET_COMMIT \
  TANAGHOM_BACKUP_PROOF TANAGHOM_PRODUCTION_ROOT TANAGHOM_RELEASE_SOURCE_ROOT
```

Evidence and rollback image retention is a separate approved operation. This package contains no command that stops, restarts, removes, edits, or prunes SmartLabs, SmartCC, voice, Gemma, or existing n8n containers.
