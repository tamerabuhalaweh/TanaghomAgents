# Phase 7D locked runtime controlled production update

Status: prepared for review only. **No deployment is authorized by this package
or by merging its implementation.**

## Outcome and scope

This package advances the deployed database from
`0029_organization_agent_studio` through exactly:

1. `0030_policy_resolved_agent_runtime`; and
2. `0031_policy_runtime_executors_certification`.

It provisions four generated PostgreSQL login identities with mutually
exclusive capability-role membership:

- shared planner/runtime;
- read executor;
- proposal executor; and
- action executor.

The passwords exist only in root-owned temporary files long enough to
authenticate each role and import four encrypted n8n PostgreSQL credentials.
Plaintext is deleted before commit. The package reuses the existing reviewed
Gemma and private integration-gateway credentials, eliminating duplicate
credential names and IDs.

It imports these six workflows:

1. Policy-Resolved Agent Runner;
2. Agent Simulation Dispatcher;
3. Fixed Read Skill Executor;
4. Fixed Proposal Skill Executor;
5. Fixed Action Skill Executor; and
6. Policy Runtime Finalizer.

All six workflows remain inactive, all schedule triggers remain disabled, and
all six must have zero executions. The package builds and recreates only the
Tanaghom dashboard, with
`AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED=false`.

Adapters, schedules, provider execution and runtime claims remain disabled.
The runtime, Postiz and GHL emergency stops remain active. No Gemma, Postiz,
GHL, notification or customer job is called.

The package does not restart or recreate n8n; change Nginx, firewall, networks
or credentials outside its four new database credentials; or touch SmartLabs,
SmartCC, voice, Gemma or any other protected service.

## Mandatory reviewed baseline

- The deployed checkout is the explicitly supplied current commit.
- The approved target is a descendant and the current remote `main`.
- Production is exactly at migration `0029`.
- Phase 7D tables, capability roles, login roles, workflows and credentials are
  absent.
- The existing Gemma credential
  `62000000-0000-4000-8000-000000000002` and gateway credential
  `62000000-0000-4000-8000-000000000004` exist with exact reviewed metadata.
- Provider, CRM, conversation and runtime safety controls are fail-closed.
- No external provider operation exists.
- Dashboard and all protected units/containers are healthy.
- n8n is exactly `2.26.8`.
- At least 15 GiB is free on `/`.

Any mismatch is a stop condition.

## Review and disposable validation

```sh
deployment/phase7d-runtime-production-update/scripts/validate-package.sh
deployment/phase7d-runtime-production-update/scripts/test-disposable-lifecycle.sh \
  "$DATABASE_TEST_URL"
deployment/phase7d-runtime-production-update/scripts/test-disposable-n8n-lifecycle.sh
npm test
npm run check
```

The disposable database proof applies 0030 and 0031 only after 0029, creates
the four least-privilege logins, verifies role isolation and exact disabled
adapter hashes, drops the logins, rolls back exactly to 0029 and reapplies
cleanly. The pinned disposable n8n proof imports four encrypted credentials and
all six workflows, confirms inactive/disabled/zero-execution state, runs
`n8n audit`, then removes only package-owned records.

## Authorized read-only preflight

Only after a separate production GO:

```sh
export TANAGHOM_PHASE7D_RELEASE_AUTHORIZATION='GO-INSTALL-LOCKED-PHASE7D-RUNTIME'
export TANAGHOM_PHASE7D_RELEASE_ID='phase7d-runtime-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_CURRENT_COMMIT='<40_CHARACTER_DEPLOYED_SHA>'
export TANAGHOM_TARGET_COMMIT='<40_CHARACTER_APPROVED_MAIN_SHA>'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-phase7d'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'

sudo -E \
  /opt/tanaghom-release-phase7d/deployment/phase7d-runtime-production-update/scripts/preflight.sh
```

Preflight is read-only. Do not bypass a failed check.

## Controlled update

```sh
sudo -E \
  /opt/tanaghom-release-phase7d/deployment/phase7d-runtime-production-update/scripts/deploy-update.sh
```

The transaction records root-only commit, migration, workflow, dashboard-image,
Nginx, Squid, firewall, n8n container, workflow-inventory, credential-inventory
and audit evidence. It then:

1. checks out the exact approved target;
2. builds the new dashboard image without recreating a container;
3. applies only migrations 0030 and 0031 in order;
4. creates and authenticates the four generated database logins;
5. encrypts and imports their four n8n credentials;
6. imports all six workflows inactive;
7. recreates only the Tanaghom dashboard;
8. proves the authenticated private gateway still returns fail-closed `503`;
9. proves all adapters, triggers and emergency stops remain locked;
10. proves protected containers, services, Nginx and firewall are unchanged;
11. runs post-install `n8n audit`; and
12. commits only after all validation succeeds.

Failure before commit automatically restores the previous dashboard
image/checkout, deletes only partially created package workflows and
credentials, drops only package login roles, and rolls migrations back in
reverse order. An incomplete rollback records `ROLLBACK_FAILED=YES` and
requires forward recovery.

## Exact unused-runtime rollback

Rollback deliberately refuses after any runtime job, run, invocation,
approval, dependency block, non-seed adapter event, certification or workflow
execution exists. Never delete evidence to force a downgrade.

```sh
export TANAGHOM_PHASE7D_ROLLBACK_AUTHORIZATION='ROLLBACK-LOCKED-PHASE7D-RUNTIME'
sudo -E \
  /opt/tanaghom-release-phase7d/deployment/phase7d-runtime-production-update/scripts/rollback-update.sh
unset TANAGHOM_PHASE7D_ROLLBACK_AUTHORIZATION
```

The rollback restores the previous dashboard, deletes only the six inactive
zero-execution workflows and four package credentials, drops only the four
package logins, applies 0031/0030 down migrations in reverse, and requires
migration `0029` plus the exact prior n8n inventories afterward.

## Cleanup

```sh
unset TANAGHOM_PHASE7D_RELEASE_AUTHORIZATION \
  TANAGHOM_PHASE7D_RELEASE_ID \
  TANAGHOM_EXPECTED_CURRENT_COMMIT \
  TANAGHOM_TARGET_COMMIT \
  TANAGHOM_RELEASE_SOURCE_ROOT \
  TANAGHOM_PRODUCTION_ROOT
```

Retain the root-only evidence directory and rollback dashboard image until a
separate retention decision.
