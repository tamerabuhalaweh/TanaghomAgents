# Controlled UAT runtime correction runbook

## Purpose

Activation `uatactivation-20260723T041842Z` published all eight reviewed
Tanaghom workflows. The first live Strategist request then exposed an invalid
structured-output schema: `posting_cadence` required a non-empty object but
defined no allowed properties. vLLM/xgrammar rejected the grammar and the
Gemma canary exited. The same activation also proved that n8n rejects published
workflows whose only trigger is disabled.

This correction:

- defines the seven allowed cadence channel keys;
- requires each selected cadence value to contain a bounded
  `posts_per_week` integer;
- sends strict vLLM JSON Schema response formats;
- validates every Gemma response schema against the reviewed xgrammar
  restrictions;
- imports runtime copies of all eight reviewed exports with one enabled
  schedule each;
- keeps provider platform stops, Postiz manual mode, GHL paused/manual modes,
  proactive-message disablement, missing credential/channel gates, quality
  baseline stage, and human approvals unchanged; and
- preserves the two failed bilingual jobs for a later exact reconciliation
  after a SmartLabs owner restores Gemma.

## Preflight

The package refuses unless:

- an explicit correction authorization, unique correction ID, and exact
  40-character release commit are supplied;
- the isolated release checkout, production dashboard commit, and reviewed
  Squid-only worktree diff are unchanged;
- migration `0025_runtime_agent_reconciliation`, n8n `2.26.8`, all five n8n
  containers, and the public dashboard boundary are healthy;
- activation `uatactivation-20260723T041842Z` is committed and not rolled back;
- all eight workflows are currently published, the two core schedules are
  enabled, and the six provider/quality schedules are disabled;
- every provider stop and business-policy lock remains active;
- no live/customer provider operation or open provider job exists;
- the English and Arabic UAT strategy jobs are both terminal after exactly
  three safe HTTP-error attempts, with no strategy or content persisted; and
- all four encrypted n8n credentials still exist by exact ID.

The Gemma service is intentionally not inspected, started, stopped, or
restarted by this package.

## Validation before deployment

```sh
deployment/phase6-uat-runtime-correction/scripts/validate-package.sh
deployment/phase6-uat-runtime-correction/scripts/test-disposable-n8n-runtime.sh
```

The disposable test uses immutable n8n `2.26.8` and PostgreSQL `17.6` images.
It prepares the eight policy-gated runtime definitions, publishes them, starts
a real n8n process, rejects any Tanaghom trigger-activation error, and returns
the disposable workflow inventory to all inactive.

## Controlled deployment

Run only from the clean isolated release checkout:

```sh
export TANAGHOM_UAT_CORRECTION_AUTHORIZATION=CORRECT-REVIEWED-TANAGHOM-UAT-RUNTIME
export TANAGHOM_UAT_CORRECTION_ID=uatcorrection-YYYYMMDDTHHMMSSZ
export TANAGHOM_EXPECTED_RELEASE_COMMIT=<approved-40-character-commit>
sudo -E deployment/phase6-uat-runtime-correction/scripts/deploy-correction.sh
```

The deployment:

1. repeats the full preflight;
2. creates a root-only evidence directory;
3. exports the eight current workflows and records container/worktree state;
4. prepares policy-gated runtime definitions from the reviewed exports;
5. imports and publishes all eight exact IDs;
6. restarts only the existing n8n main and worker containers, without
   recreation;
7. proves all eight schedules are enabled and no Tanaghom activation error
   appears after the restart marker;
8. records all eight Agent Registry workflows as `active/enabled`;
9. runs `n8n audit`; and
10. validates locks, zero provider activity, bilingual job preservation,
    container identity, and public boundaries.

No schedule can create provider authority. Database claim functions still
refuse work until the appropriate owner policy, platform stop, credential,
channel, and rollout gate are deliberately changed.

## Validation

```sh
export TANAGHOM_UAT_CORRECTION_AUTHORIZATION=CORRECT-REVIEWED-TANAGHOM-UAT-RUNTIME
export TANAGHOM_UAT_CORRECTION_ID=uatcorrection-YYYYMMDDTHHMMSSZ
export TANAGHOM_EXPECTED_RELEASE_COMMIT=<approved-40-character-commit>
sudo -E deployment/phase6-uat-runtime-correction/scripts/validate-release.sh
```

## Safe rollback

The invalid prior live state must not be restored. Rollback therefore
unpublishes all eight workflows, restores their pre-correction definitions
inactive, preserves every database/job/audit record, and marks all Agent
Registry workflows inactive.

```sh
export TANAGHOM_UAT_CORRECTION_AUTHORIZATION=CORRECT-REVIEWED-TANAGHOM-UAT-RUNTIME
export TANAGHOM_UAT_CORRECTION_ID=uatcorrection-YYYYMMDDTHHMMSSZ
export TANAGHOM_EXPECTED_RELEASE_COMMIT=<approved-40-character-commit>
export TANAGHOM_UAT_CORRECTION_ROLLBACK_AUTHORIZATION=SAFE-ROLLBACK-TANAGHOM-UAT-RUNTIME-CORRECTION
sudo -E deployment/phase6-uat-runtime-correction/scripts/rollback-correction.sh
```

## Continuation

After this correction is deployed:

1. a SmartLabs owner must restore the existing Gemma canary;
2. Tanaghom must run a minimal authenticated structured-output probe;
3. only then may the two exact failed bilingual jobs be transactionally
   requeued without creating duplicate campaigns;
4. Strategist and Content Producer must reach four pending human-review
   drafts; and
5. Postiz/GHL/quality live-provider UAT remains blocked on the customer's
   staging channel, GHL connection, webhook/test allowlist, and reviewed
   English/Arabic baseline.
