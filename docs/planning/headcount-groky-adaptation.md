# Headcount → Groky adaptation (planning reference, review-only)

Reference-only record for the Groky legacy headcount port submitted as
`archive/legacy-v0/HEADCOUNT_DELTA_20261003.md`. No live Tanaghom code,
schema, workflow, or deployment is touched by the accompanying PR.

## Authorized scope
- Sync secret-free Groky A+B+C (8 headcount skill adaptations, Agent 1/2/4 prompt v2,
  006 template extension, 007 department stubs, 3 inactive stub workflows,
  dashboard read-only endpoint) into `archive/legacy-v0` + this planning note.
- Review by senior dev (Codex delegation per `docs/PROJECT_CONTEXT.md`). **Do not merge
  without that review; do not deploy or activate anything from this material.**

## Non-goals
- No change to `apps`, `packages` (incl. `tanaghom` schema / migrations 0033+),
  live `n8n/workflows` (agency/agency-pilot/phase*), `services`, `deployment`,
  credentials, firewall, model/provider execution, or customer data.
- No live-model quality claim, no production percentage, no STATUS change in this PR.
- SmartLabs / SmartCC / voice / Hybrid out of scope (PROJECT_CONTEXT boundary).

## Acceptance gate for the PR itself
1. `npm run check` + `npm test` pass (or pre-existing failures explicitly labeled, untouched by this delta).
2. Secret scan clean (no keys/passwords/private keys in delta — verified by `verify-repository.mjs`).
3. Review confirms: archive-only diff, guards preserved (approved-only, no-freelance,
   staging dry-run, audit), stubs inactive, SQL marked non-runnable as Tanaghom migrations.
4. No merge, no migration run, no n8n import, no deployment from this PR.

## Attribution
Source https://github.com/cbrock84/headcount, MIT © Chris Brock. Distilled methodology
+ Groky mapping; regulator source lists not copied. Full table in
`archive/legacy-v0/n8n/prompts/reference/headcount/` headers + Groky `docs/HEADCOUNT_ATTRIBUTION.md`.

## Next best move (after review, separate authorization required)
- If senior dev approves the reference: file a *separate* supervised reimplementation
  proposal to port selected prompt patterns into `prompts` + generated workflows per
  `docs/reconciliation/GROKY_V0_AUDIT.md`, with tests and staging gates.
- Blockers unchanged: live-provider credentials, channel/contact setup, real-model
  quality certification, customer acceptance (see `docs/STATUS.md`).
