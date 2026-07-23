# Phase 6 bilingual Arabic UAT resume

## Purpose

The English Strategist job completed under the single-source v2 contract. The
Arabic job safely exhausted retries because all three responses reached the
reviewed 2,048-token ceiling (`finish_reason: length`) and were rejected as
invalid JSON. No Arabic strategy, content, or provider operation was persisted.

This forward-only package:

1. preserves the successful English strategy;
2. raises only the Strategist output ceiling to 4,096 tokens;
3. classifies `finish_reason: length` explicitly as
   `gemma_output_truncated`;
4. runs one zero-action probe using the exact Arabic synthetic job before any
   workflow write;
5. imports and republishes only the reviewed Strategist workflow;
6. restarts only the existing n8n main and worker containers without
   recreation;
7. requeues exactly one terminal Arabic strategy job; and
8. continues the original bilingual UAT to two strategies, two content jobs,
   and four pending human-review drafts.

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
