# Phase 7C Agent Studio controlled update

Status: prepared for review only. **No deployment is authorized by this document
or by merging the implementation.**

This package applies only `0029_organization_agent_studio` after
`0028_strategy_cadence_integrity`, then rebuilds and recreates only the
Tanaghom dashboard. It does not import, edit, activate, or execute n8n
workflows; call Gemma, Postiz, GHL, or any notification provider; change
credentials, policy, firewall, Nginx, or networks; or touch SmartLabs, SmartCC,
voice, Gemma, or the protected n8n containers.

The package deliberately reuses the shared Phase 7B protected-service
primitives for dashboard Compose access, safety-lock verification, and
protected service/container identity checks. Phase 7C overrides every
release-specific migration and release-identifier boundary in its own
`common.sh`.

## Preconditions

- The reviewed target commit is checked out in `/opt/tanaghom-dashboard`.
- The production database latest migration is exactly
  `0028_strategy_cadence_integrity`.
- Both provider emergency stops are active; Postiz and CRM modes remain manual;
  conversation processing remains paused.
- Agent Studio tables do not already exist.
- The dashboard and every protected service/container are healthy.
- At least 20 GiB remains on `/`.
- No external provider operation exists.

## Review-only validation

```sh
deployment/phase7c-agent-studio/scripts/validate-package.sh
deployment/phase7c-agent-studio/scripts/test-disposable-lifecycle.sh "$DATABASE_TEST_URL"
```

The lifecycle test proves exact baseline/target ordering, three template seeds,
n8n denial, refusal to delete customer agent data, empty rollback, and clean
reapplication.

## Authorized preflight

Set these only in an interactive root shell after a separate deployment GO:

```sh
export TANAGHOM_RELEASE_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_RELEASE_ID='phase7c-YYYYMMDDTHHMMSSZ'
export TANAGHOM_TARGET_COMMIT='<APPROVED_40_CHARACTER_MAIN_SHA>'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'

/opt/tanaghom-dashboard/deployment/phase7c-agent-studio/scripts/preflight.sh
```

Preflight is read-only. If any check fails, stop and do not bypass it.

## Controlled update

```sh
/opt/tanaghom-dashboard/deployment/phase7c-agent-studio/scripts/deploy-update.sh
```

The script records root-only checksums and protected n8n identities, pins the
current dashboard image for rollback, applies exactly one transaction-scoped
migration, rebuilds/recreates only the dashboard, and validates:

- migration `0029` and all eight Agent Studio tables;
- exactly three reviewed templates and zero organization-agent records;
- dashboard API read/function access with no direct table DML;
- no n8n Agent Studio read or mutation privilege;
- provider safety locks and zero external operations;
- unchanged n8n container identities, Nginx configuration, and firewall state;
- dashboard health plus closed page/API authentication boundaries.

Any failure before commit attempts automatic dashboard-image and empty-schema
rollback. Migration rollback refuses if organization Agent Studio data exists.

## Exact rollback

Rollback is safe only while all organization-agent definitions, versions,
bindings, policies, scenarios, and audits remain empty. It deliberately refuses
to delete customer configuration or evidence.

```sh
export TANAGHOM_ROLLBACK_AUTHORIZATION='ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE'
/opt/tanaghom-dashboard/deployment/phase7c-agent-studio/scripts/rollback-update.sh
unset TANAGHOM_ROLLBACK_AUTHORIZATION
```

If customer data exists, keep the current schema and prepare a separately
reviewed forward recovery. Never truncate customer records to force downgrade.

## Cleanup

```sh
unset TANAGHOM_RELEASE_AUTHORIZATION TANAGHOM_RELEASE_ID \
  TANAGHOM_TARGET_COMMIT TANAGHOM_PRODUCTION_ROOT
```

Keep the evidence directory and rollback dashboard image until retention is
separately approved.
