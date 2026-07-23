# Phase 6 bilingual Arabic UAT resume

## Purpose

The English Strategist job completed under the single-source v2 contract. The
Arabic job safely exhausted retries because all three responses reached the
reviewed 2,048-token ceiling (`finish_reason: length`) and were rejected as
invalid JSON. A subsequent zero-action 4,096-token probe exposed the precise
cause: the model incorrectly looked for `campaign.raw_offer_brief` and
`campaign.age_range`, although the versioned job supplies the offer at
`campaign.brief` and a complete audience description at
`campaign.target_audience.audience`. The model then emitted an incomplete
`blocked_missing_info` object followed by whitespace. No Arabic strategy,
content, or provider operation was persisted.

This forward-only package:

1. preserves the successful English strategy;
2. aligns the Strategist prompt with the exact versioned input paths and makes
   the required blocked response explicit;
3. retains the reviewed Strategist output ceiling of 4,096 tokens;
4. classifies `finish_reason: length` explicitly as
   `gemma_output_truncated`;
5. runs one zero-action probe using the exact Arabic synthetic job before any
   workflow write;
6. imports and republishes only the reviewed Strategist workflow;
7. restarts only the existing n8n main and worker containers without
   recreation;
8. requeues exactly one terminal Arabic strategy job; and
9. continues the original bilingual UAT to two strategies, two content jobs,
   and four pending human-review drafts.

The continuation is forward-safe when the active Strategist completes the
Arabic job between requeue and the runner's next precondition. It requires the
single immutable requeue audit, both valid strategies, and zero content work,
then skips duplicate requeueing and records the exact continuation release
commit before proceeding.

It does not start, stop, restart, edit, or delete Gemma, SmartLabs, SmartCC,
voice, Nginx, firewall, Compose, credentials, providers, or unrelated
workflows. Postiz and GHL remain locked with zero operations.

## Required environment

```sh
export TANAGHOM_BILINGUAL_RESUME_AUTHORIZATION='RESUME-REVIEWED-TANAGHOM-BILINGUAL-UAT'
export TANAGHOM_BILINGUAL_RESUME_ID='bilingualresume-YYYYMMDDTHHMMSSZ'
export TANAGHOM_EXPECTED_RELEASE_COMMIT='<approved 40-character commit>'
export TANAGHOM_RELEASE_SOURCE_ROOT='/opt/tanaghom-release-bilingual-resume'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
```

## Controlled correction and resume

```sh
sudo -E deployment/phase6-bilingual-uat-resume/scripts/preflight.sh
sudo -E deployment/phase6-bilingual-uat-resume/scripts/deploy-token-correction.sh
sudo -E deployment/phase6-bilingual-uat-resume/scripts/resume-bilingual-uat.sh
```

The probe runs before the workflow import. Any pre-commit failure restores the
prior Strategist export. Once the Arabic job is requeued, rollback refuses and
future repairs must be forward-only.

## Provider continuation

Provider workers remain technically active but business-gated. Staging
provider acceptance still requires:

- an active mapped Postiz business channel; and
- a connected GHL staging account, test contact/webhook, and allowlist.

These customer inputs must not be bypassed.
