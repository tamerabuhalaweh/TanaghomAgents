# Phase 6 bilingual core-agent UAT completion

## Purpose

The corrected PR #138 structured-output schema was accepted by the protected
Gemma canary without an engine restart, but the first live probe exposed a
second fail-closed correctness gap: `channels` and `posting_cadence` could
contain different channel sets while both remained structurally valid.

This package:

1. requires the live Strategist request to match the reviewed PR #138
   baseline before change;
2. sends one corrected zero-action probe with temperature zero and a stronger
   exact-key prompt, bounded to 2,048 output tokens;
3. adds migration `0028_strategy_cadence_integrity`, enforcing the same
   channel/cadence equality at PostgreSQL;
4. imports and republishes only the reviewed Strategist workflow;
5. restarts only the existing n8n main and worker containers, without
   recreation;
6. requeues only the two preserved English/Arabic strategy jobs after the
   correction commits; and
7. waits for exactly two valid strategies and four pending human-review
   drafts.

It never starts, stops, restarts, edits, or deletes Gemma, SmartLabs, SmartCC,
voice, Nginx, firewall, Compose, credentials, provider mappings, or unrelated
workflows. Provider platform stops and customer manual/paused policies stay
locked. No Postiz/GHL operation is authorized.

## Required reviewed environment

```sh
export TANAGHOM_BILINGUAL_UAT_AUTHORIZATION='COMPLETE-REVIEWED-TANAGHOM-BILINGUAL-UAT'
export TANAGHOM_BILINGUAL_UAT_ID='bilingualuat-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_RELEASE_COMMIT='<approved 40-character commit>'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-bilingual-uat'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
```

## Validation

```sh
deployment/phase6-bilingual-uat-completion/scripts/validate-package.sh
npm test
npm run check
npm run test:database
```

The database suite proves the new constraint accepts exact equality, rejects
missing/extra/duplicate channel mappings and invalid cadence values, rolls
back only 0028, and reapplies cleanly.

## Controlled correction

```sh
sudo -E deployment/phase6-bilingual-uat-completion/scripts/preflight.sh
sudo -E deployment/phase6-bilingual-uat-completion/scripts/deploy-correction.sh
```

The correction stage performs the live probe before any migration or workflow
write. A failed probe leaves the database, jobs, and workflow unchanged.
Failure after a write automatically restores the prior Strategist workflow and
rolls migration 0028 back while both UAT jobs remain terminal.

## Bilingual UAT

Run only after the correction has a `COMMITTED_AT` marker:

```sh
sudo -E deployment/phase6-bilingual-uat-completion/scripts/run-bilingual-uat.sh
```

The UAT script transactionally resets only the two exact terminal jobs,
preserves their job/campaign identities, waits for exactly-once strategies,
queues content through `queue_campaign_content` as the accepted owner, and
requires:

- two succeeded strategy jobs;
- two database-validated strategies;
- two content jobs at `waiting_approval`;
- exactly two English and two Arabic pending drafts;
- all eight workflows still active with enabled schedules;
- Gemma still active;
- every provider safety lock unchanged; and
- zero external provider operations.

No automatic retry occurs after a terminal UAT failure. Preserve evidence and
investigate.

## Rollback

Rollback is allowed only before the UAT creates any strategy or content:

```sh
export TANAGHOM_BILINGUAL_UAT_ROLLBACK_AUTHORIZATION='ROLLBACK-UNUSED-BILINGUAL-UAT-CORRECTION'
sudo -E deployment/phase6-bilingual-uat-completion/scripts/rollback-correction.sh
unset TANAGHOM_BILINGUAL_UAT_ROLLBACK_AUTHORIZATION
```

After UAT output exists, rollback refuses rather than delete evidence. Keep the
cadence guard and corrected workflow, and use a forward correction.

## Provider continuation

Workflow-level activation is already live for all eight workers. Business
provider activation remains separately gated:

- Postiz needs an active mapped business staging channel; and
- GHL needs a connected staging credential, webhook/test contact, and explicit
  allowlist.

Missing customer inputs must not be bypassed.
