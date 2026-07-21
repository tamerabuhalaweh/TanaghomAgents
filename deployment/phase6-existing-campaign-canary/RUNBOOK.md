# Controlled existing-campaign canary runbook

## Scope and fixed production target

This package is designed for the verified UAT campaign:

- campaign ID: `2826cef0-58e1-44cf-84c6-92ae12c18ab8`
- strategy job ID: `33900f7a-5c07-441e-9908-af1410afe14a`
- campaign: `Tanaghom Campaign Lifecycle UAT.test`
- zero budget and zero revenue target
- requested draft count: 3

The values remain execution-time inputs so every command is auditable. Substitution with a different ID requires a new review and authorization.

## Safety boundary

- Only Campaign Strategist and Content Producer may be temporarily published, one at a time.
- Both schedules are disabled in the temporary definitions.
- The generic worker claim is safe only because the operator proves the exact authorized job is the sole claimable core job immediately before publication.
- The content job is created only by the governed API function; n8n cannot create it.
- Both workflows are restored inactive on success, interruption, or failure.
- Failure never deletes, retries, or marks the customer campaign/job failed. Partial evidence remains for human investigation.
- Postiz, GHL, publishing, CRM, messaging, proactive outreach, provider actions, and budget are outside scope.
- No container, firewall, Nginx, SmartLabs, SmartCC, voice, or Gemma configuration may be changed.

## Required variables

```sh
export TANAGHOM_CANARY_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_CANARY_ID='uatcanary-YYYYMMDDTHHMMSSZ'
export TANAGHOM_CANARY_CAMPAIGN_ID='2826cef0-58e1-44cf-84c6-92ae12c18ab8'
export TANAGHOM_CANARY_STRATEGY_JOB_ID='33900f7a-5c07-441e-9908-af1410afe14a'
export TANAGHOM_CANARY_CAMPAIGN='Tanaghom Campaign Lifecycle UAT.test'
export TANAGHOM_EXPECTED_CONTENT_ITEMS='3'
export TANAGHOM_EXPECTED_PRODUCTION_COMMIT='<reviewed-current-production-commit>'
export TANAGHOM_CANARY_SOURCE_COMMIT='<approved-merge-commit>'
export TANAGHOM_RELEASE_SOURCE_ROOT='<clean-checkout-at-approved-merge-commit>'
```

Do not print or store the database URL. The package reads the existing root-only dashboard secret and enforces the reviewed CA with TLS `verify-full`.

## Gate 1 — read-only preflight

After a separate preflight authorization, run as root:

```sh
deployment/phase6-existing-campaign-canary/scripts/preflight.sh
```

This changes no state. A failure is NO-GO.

## Gate 2 — controlled execution

Only after Tamer reviews the preflight evidence and explicitly authorizes the run:

```sh
deployment/phase6-existing-campaign-canary/scripts/run-canary.sh
```

Evidence is written to `/var/backups/tanaghom-$TANAGHOM_CANARY_ID` with mode 0700 and checksums. Success ends at pending human approval; it does not authorize publishing.

## Exact workflow rollback

Rollback is safe at any time after workflow preparation and may be repeated:

```sh
deployment/phase6-existing-campaign-canary/scripts/restore-workflows.sh \
  "/var/backups/tanaghom-$TANAGHOM_CANARY_ID"
```

This unpublishes the two core workflows, imports their captured reviewed originals inactive, restores Agent Registry state to `imported_inactive/workflow_inactive_only`, and verifies hashes. It does not roll back or erase database evidence.

## Gate 3 — authenticated human approval verification

After a human approves or rejects every generated draft in Tanaghom, verification requires separate authorization:

```sh
export TANAGHOM_HUMAN_APPROVAL_VERIFICATION='YES-VERIFY-AUTHENTICATED-HUMAN-APPROVAL'
deployment/phase6-existing-campaign-canary/scripts/verify-human-approval.sh \
  "/var/backups/tanaghom-$TANAGHOM_CANARY_ID"
```

The success gate requires every generated draft to be approved by an active human in the same organization and proves no provider job or external action was created. Issue #100 remains open until this final evidence is attached.
