# Phase 7B governed Skill Library controlled update

Status: prepared for review only. No deployment is authorized by this document
or by merging this package.

This package applies only `0027_governed_skill_library` after
`0026_skill_registry`, then rebuilds and recreates only the Tanaghom dashboard.
It does not import, edit, activate, or execute n8n workflows; call Gemma,
Postiz, GHL, or any notification provider; change credentials, policy, firewall,
Nginx, or networks; or touch SmartLabs, SmartCC, voice, Gemma, or the protected
n8n containers.

## Preconditions

- The reviewed target commit is already checked out in `/opt/tanaghom-dashboard`.
- The production database latest migration is exactly `0026_skill_registry`.
- Both provider emergency stops are active; organization Postiz and CRM modes
  remain manual; conversation processing remains paused.
- The four Phase 7B organization tables do not already exist.
- The dashboard and all protected services/containers are healthy.
- At least 20 GiB remains on `/`.
- No external provider operation exists.

## Review-only validation

```sh
deployment/phase7b-skill-library/scripts/validate-package.sh
deployment/phase7b-skill-library/scripts/test-disposable-lifecycle.sh "$DATABASE_TEST_URL"
```

## Authorized preflight

Set these only in an interactive root shell after a separate deployment GO:

```sh
export TANAGHOM_RELEASE_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_RELEASE_ID='phase7b-YYYYMMDDTHHMMSSZ'
export TANAGHOM_TARGET_COMMIT='<APPROVED_40_CHARACTER_MAIN_SHA>'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'

/opt/tanaghom-dashboard/deployment/phase7b-skill-library/scripts/preflight.sh
```

Preflight is read-only. If it fails, stop; do not bypass a check.

## Controlled update

```sh
/opt/tanaghom-dashboard/deployment/phase7b-skill-library/scripts/apply-update.sh
```

The script records root-only evidence, pins the current dashboard image for
rollback, applies one transaction-scoped migration, rebuilds/recreates only the
dashboard, and validates authentication, least privilege, zero organization
skills, zero agent-binding changes, protected container identities, firewall,
Nginx, health, and zero provider operations.

Any failure before commit attempts an automatic dashboard-image and empty-schema
rollback. Migration rollback refuses if organization Skill Library data exists.

## Exact rollback

Rollback is safe only while the Skill Library is empty. It deliberately refuses
to delete customer skills, references, versions, or audits.

```sh
export TANAGHOM_ROLLBACK_AUTHORIZATION='ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE'
/opt/tanaghom-dashboard/deployment/phase7b-skill-library/scripts/rollback-update.sh
unset TANAGHOM_ROLLBACK_AUTHORIZATION
```

If data exists, keep the dashboard available and prepare a separately reviewed
forward recovery migration. Never truncate or delete customer records to force
a downgrade.

## Cleanup

```sh
unset TANAGHOM_RELEASE_AUTHORIZATION TANAGHOM_RELEASE_ID \
  TANAGHOM_TARGET_COMMIT TANAGHOM_PRODUCTION_ROOT
```

Keep the evidence directory and rollback image until retention is separately
approved.
