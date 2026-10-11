# Creative talking-head v1 — source acceptance only

Start with `corrections/review-ready/manifest.json`, `gate-receipts.json`, `native-receipts.json` and `self-review-20-gates.json` in that same directory. Human handoff: `../../docs/evidence/2026-10-11-creative-talking-head.md`. Root-level summaries and intermediate correction receipts are preserved **historical checkpoints**, not current approval.

**LEDGER ONLY / EXTERNAL ACCEPTANCE PENDING.** Synthetic media and loopback providers are not provider quality, privacy/legal, custom-enrollment or production acceptance. Real execution stays unauthorized; all flags default OFF.

## Reproduce

Use the repository's existing pinned installation, a local `postgres:16-alpine` Docker image, local `psql`, and existing FFmpeg/Chromium. Do not load live environment files or credentials. Set `P5_SCRATCH_DIR` to an explicitly owned scratch directory.

```bash
npm run build:dashboard
npm run typecheck:dashboard
npm run check
npm test
npm audit --audit-level=moderate --json
P5_SCRATCH_DIR='<owned scratch>' node scripts/creative-talking-head-acceptance.mjs --browser
P5_SCRATCH_DIR='<owned scratch>' node scripts/creative-talking-head-regression.mjs contracts database foundation image
P5_SCRATCH_DIR='<owned scratch>' node scripts/creative-talking-head-regression.mjs design motion
P5_SCRATCH_DIR='<owned scratch>' node scripts/creative-talking-head-regression.mjs video segmentation
```

Acceptance uses PostgreSQL port 45447; regression uses 45448. Provider/auth/application doubles bind loopback. Each suite gets a fresh uniquely labeled database, never an existing fixture. The wrappers delete only their exact owned container. Run regression batches sequentially: their fixed port and historical fixture server ports intentionally preclude concurrent regression suites. Acceptance and regression use distinct fixture ports and can run independently.

Do not delete another container to free a port. An occupied port is a blocker. On interrupted runs, inspect the exact owner label/run receipt before removing only the interrupted task's container or `.tmp-p5-regression-<owner>.mjs` sibling. Normal runs verify owned-container absence and remove their sibling automatically.

The acceptance wrapper applies the entire migration chain without loading rows from a prior DB, tests flags OFF and worker permissions, runs API/worker/browser scenarios, then exercises rollback/re-up over real used P5 state. Historical exact-baseline regressions retain their original assertions; the wrapper changes only their migration target in a disposable sibling. Full current-head SQL contracts run separately on 0046.

Native logs preserve failures as well as successes. Sanitized staged `.log.txt` copies and raw/sanitized digests are in `corrections/review-ready/native/` and its `native-log-digests.json`; historical outputs and original FAIL/BLOCKED reports remain under `corrections/history-native/` and `corrections/historical-review/`. Current final totals: **279/279 units, 58/58 targeted units, 82 unique acceptance cases, eight fresh regression suites and 20 source self-review gates**. Counts overlap; never add them into an invented global test total. The API has no direct CRUD rights to the four P5 tables; controlled actor-scoped functions provide catalog/governance. Both independent reviews of the new freeze remain mandatory; no PR yet.
