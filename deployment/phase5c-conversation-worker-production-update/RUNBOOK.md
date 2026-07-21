# Phase 5C Conversation Intelligence controlled production update

Status: prepared for review. Merging this package does **not** authorize production execution.

This package performs one additive Tanaghom release:

1. Apply `0024_conversation_intelligence_worker_registry`.
2. Create the login-only `tanaghom_conversation_runtime` role as a member of the no-login `tanaghom_conversation_worker` capability role.
3. Generate a one-time random database password, import it into n8n as encrypted credential `62000000-0000-4000-8000-000000000005`, and remove every plaintext staging file.
4. Import `Tanaghom — Conversation Intelligence v1` inactive with its schedule disabled.
5. Record the worker as `imported_inactive/disabled` and prove zero executions and zero provider operations.

It does not activate a workflow, accept a webhook, call Gemma/GHL/Postiz, import customer data, rebuild or recreate a container, alter the dashboard image, change Nginx/firewall rules, or operate on SmartLabs, SmartCC, voice, or Gemma services.

Supavisor can take time to recognize a newly created custom login. The release waits five seconds before each authentication attempt and retries at most 24 times. Every failure is captured without a password; exhaustion still triggers the exact automatic rollback before any n8n import.

The current production checkout contains one pre-existing operational Squid diff for `cc.thesmartlabs.net`. This package does not edit, stage, revert, deploy, or interpret that SmartCC change. Preflight accepts only its exact reviewed path and SHA-256 fingerprint (or a clean checkout), captures the complete status/diff, and requires byte-identical state after deployment and rollback. Any other worktree change is a hard stop.

## Why this additive release does not require another full backup

Migration 0024 adds one registry row only. The package snapshots the relevant Tanaghom ledger, n8n workflow inventory, credential metadata, protected container identities, Nginx hash, and firewall rules before changing anything. Its automatic rollback deletes only the new inactive zero-execution workflow and encrypted credential, drops only the new login role, restores the registry state, and runs the guarded 0024 down migration. It never deletes customer or campaign data.

If any precondition is not exact, the package stops before mutation. If the workflow has an execution, becomes active, or the registry no longer has the reviewed state, automatic rollback refuses destructive cleanup and preserves evidence for a separate recovery decision.

## Prepare the reviewed source

After this PR is merged, stage a detached clean checkout without modifying `/opt/tanaghom-dashboard`:

```sh
git clone --no-checkout git@github.com:tamerabuhalaweh/TanaghomAgents.git /opt/tanaghom-release-phase5c-worker
git -C /opt/tanaghom-release-phase5c-worker fetch --no-tags origin main
git -C /opt/tanaghom-release-phase5c-worker checkout --detach <TARGET_40_CHARACTER_SHA>
git -C /opt/tanaghom-release-phase5c-worker status --porcelain
```

## Read-only preflight

Only after Tamer approves the final diff and rollback procedure:

```sh
export TANAGHOM_WORKER_RELEASE_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_WORKER_RELEASE_ID='phase5c-worker-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_CURRENT_COMMIT='<CURRENT_PRODUCTION_40_CHARACTER_SHA>'
export TANAGHOM_TARGET_COMMIT='<TARGET_40_CHARACTER_SHA>'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-phase5c-worker'
/opt/tanaghom-release-phase5c-worker/deployment/phase5c-conversation-worker-production-update/scripts/preflight.sh
```

## Execute after separate production approval

```sh
/opt/tanaghom-release-phase5c-worker/deployment/phase5c-conversation-worker-production-update/scripts/deploy-update.sh
```

Acceptance requires migration 0024, the least-privilege login, exactly one encrypted credential, exactly one inactive workflow, zero workflow executions, an unchanged inventory for all existing workflows/credentials, an n8n audit, unchanged protected container IDs, unchanged Nginx/firewall state, and healthy public Tanaghom boundaries.

## Exact rollback

Rollback is available only while the workflow remains inactive with zero executions and the runtime registry remains at the package-owned state:

```sh
export TANAGHOM_WORKER_ROLLBACK_AUTHORIZATION='ROLLBACK-THE-AUTHORIZED-CONVERSATION-WORKER-RELEASE'
/opt/tanaghom-release-phase5c-worker/deployment/phase5c-conversation-worker-production-update/scripts/rollback-update.sh
unset TANAGHOM_WORKER_ROLLBACK_AUTHORIZATION
```

Rollback removes exactly the new workflow and credential, drops exactly `tanaghom_conversation_runtime`, returns the new registry row to `available_not_imported/disabled`, and applies only the guarded 0024 down migration. The Tanaghom dashboard checkout and image remain unchanged throughout deployment and rollback.

## Cleanup

```sh
unset TANAGHOM_WORKER_RELEASE_AUTHORIZATION TANAGHOM_WORKER_RELEASE_ID \
  TANAGHOM_EXPECTED_CURRENT_COMMIT TANAGHOM_TARGET_COMMIT \
  TANAGHOM_PRODUCTION_ROOT TANAGHOM_RELEASE_SOURCE_ROOT
```

Keep the root-only evidence directory. Never reuse a failed release ID.
