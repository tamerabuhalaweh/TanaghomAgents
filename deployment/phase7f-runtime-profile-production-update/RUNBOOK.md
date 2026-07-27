# Phase 7F immutable Gemma served-model profile update

Status: prepared for review only. Merging this package does not authorize
deployment.

## Purpose

The first controlled Agent Studio canary proved that the historical immutable
runtime profile requests `gemma4-vllm`, while the reviewed running vLLM service
serves `gemma4-26b-a4b-canary`. vLLM returned HTTP 404 without crashing. This
package preserves the historical row and adds one immutable validated
replacement profile through migration `0032_gemma_served_model_profile`.

The same canary also exposed an ambiguous PostgreSQL parameter in failure
cleanup. The companion Phase 7F package now casts the canary ID explicitly and
proves cleanup against a real claimed disposable job.

## Scope and non-scope

This update:

- requires exact migration `0031`;
- requires the shared runtime stop active and all executor adapters disabled;
- requires no queued, running or approval-waiting shared-runtime jobs;
- applies only migration `0032`;
- records root-only before/after evidence; and
- automatically rolls back if post-migration validation fails.

It does not check out or rebuild the dashboard, import or activate a workflow,
change a credential, call Gemma or a provider, recreate a container, restart a
service, or change Nginx, firewall, network, SmartLabs, SmartCC, voice or any
other protected project.

## Required recovery before preflight

The failed canary `phase7f-canary-20260727T090404Z` must first be reconciled
with the corrected, idempotent restoration command:

```sh
export TANAGHOM_PHASE7F_CANARY_ID='phase7f-canary-20260727T090404Z'
# Export the other exact Phase 7F identifiers documented in the canary runbook.
sudo -E deployment/phase7f-agent-studio-canary/scripts/restore-locks.sh \
  /var/backups/tanaghom-phase7f-canary-20260727T090404Z
```

This terminally quarantines only those two unfinished jobs, retains one
immutable failure audit per job, and leaves the runtime stop active.

## Review and disposable proof

```sh
deployment/phase7f-runtime-profile-production-update/scripts/validate-package.sh
deployment/phase7f-runtime-profile-production-update/scripts/test-disposable-lifecycle.sh \
  "$DATABASE_TEST_URL"
deployment/phase7f-agent-studio-canary/scripts/validate-package.sh
deployment/phase7f-agent-studio-canary/scripts/test-disposable-lifecycle.sh \
  "$DATABASE_TEST_URL"
npm test
npm run check
```

## Read-only production preflight

```sh
export TANAGHOM_PROFILE_RELEASE_AUTHORIZATION='GO-INSTALL-IMMUTABLE-GEMMA-PROFILE'
export TANAGHOM_PROFILE_RELEASE_ID='phase7f-profile-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_CURRENT_COMMIT='<40-character deployed dashboard SHA>'
export TANAGHOM_TARGET_COMMIT='<40-character approved current main SHA>'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-phase7f'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'

sudo -E \
  deployment/phase7f-runtime-profile-production-update/scripts/preflight.sh
```

Preflight is read-only and must pass before deployment.

## Controlled database-only update

```sh
sudo -E \
  deployment/phase7f-runtime-profile-production-update/scripts/deploy-update.sh
```

The command applies only migration `0032`, verifies the exact profile contract,
and proves the production worktree, n8n container identities, protected
services, firewall, Nginx, Squid, public authentication boundary and all
safety locks are unchanged.

## Exact rollback before use

Rollback is allowed only while no job, run or certification references the new
profile:

```sh
export TANAGHOM_PROFILE_ROLLBACK_AUTHORIZATION='ROLLBACK-UNUSED-GEMMA-PROFILE'
sudo -E \
  deployment/phase7f-runtime-profile-production-update/scripts/rollback-update.sh
unset TANAGHOM_PROFILE_ROLLBACK_AUTHORIZATION
```

Once a canary uses the profile, its durable evidence is authoritative and
rollback deliberately refuses. Forward correction is then required.

## Canary continuation

After migration `0032` passes, use a new canary ID and set:

```sh
export TANAGHOM_CANARY_RUNTIME_PROFILE_ID='7d000000-0000-4000-8000-000000000002'
```

Then repeat the read-only Phase 7F preflight and controlled English/Arabic
simulation canary. All provider adapters remain disabled and external action
budget remains zero.
