# Independent P5 database/governance review

## Verdict: BLOCKED

Reviewed frozen staged patch SHA-256 (both initial and final verification):
`7c265e589fb3e6dea39cc01643d695aa66b3279903cbc6f6f7807b0885170f7e`

Repository: `C:/Users/tamer/AppData/Local/hermes/cache/scratch/tanaghom-p5-decision`
Baseline: `04eb35a4bf14ff98efd0023a182f0e1c9f578d60`
Scope: migration 0046 up/down, canonical governance, presenter API, generic enqueue exclusion, JSON capability contracts, controlled worker SQL calls and acceptance oracles. Runtime/media/UI has a separate reviewer. No repository changes, staging, commits, publication, live environment/provider calls or credentials used.

## P1 / HIGH — blocker: P5 APIs do not work with the established least-privilege API role

**Paths/lines:**
- `packages/database/migrations/0046_creative_talking_head.up.sql:265-269`: grants only the three new worker functions; no grants to `tanaghom_api` for the four new tables or the two new API authorization/validation functions.
- `apps/dashboard/lib/server/creative/presenters.ts:35-37,51-54`: generate calls those functions and catalog directly selects the new tables.
- `apps/dashboard/lib/server/creative/avatar-governance.ts:29,32-43,48`: management directly inserts/selects/updates the new tables.
- Test blind spot: `scripts/creative-talking-head-acceptance.mjs:19-20,23` provisions/connects as postgres; `scripts/creative-talking-head-integration.mjs:49,74` passes that superuser URL to Next and sets the restricted role only on the worker connection.

**Mechanism:** Full-chain migration 0004 establishes `tanaghom_api` and revokes default PUBLIC table/function access. Existing creative migrations explicitly grant API reads/execution. Migration 0046 never admits the API to its new objects. In a fresh database, `has_table_privilege` returns false for API avatar SELECT/INSERT and control SELECT; `has_function_privilege` returns false for API presenter authorize/validate execution. This is not missing data or a feature-OFF denial: PostgreSQL refuses access before the function body executes. The handlers do not classify 42501 as an intentional API denial, so these calls are expected to surface as server errors. SQL failure was directly reproduced; HTTP under that role was not separately launched.

**Reproduction (executed):** Apply all 43 current up migrations in a uniquely owned, empty loopback PostgreSQL 16 fixture, then:

```sql
SET ROLE tanaghom_api;
SELECT id FROM tanaghom.creative_avatars LIMIT 1;
-- 42501: permission denied for table creative_avatars
SELECT tanaghom.authorize_creative_presenter(
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000003', 'talking_head');
-- 42501: permission denied for function authorize_creative_presenter
RESET ROLE;
```

The existing green API receipts prove behavior with a superuser database URL, not functioning least-privilege API admission. Source Complete is blocked on this reproducible issue.

## P2 / MEDIUM — additional controlled-SQL metadata/allowlist gap

**Path/lines:** `packages/database/migrations/0046_creative_talking_head.up.sql:168-195`, especially 187-194.

**Mechanism:** Presenter begin validates the job's operation and calls `get_creative_presenter_input`, but discards its authorized provider/model result. `p_provider`, `p_model` and `p_model_version` need only meet generic length constraints; the resulting ledger can name a provider/model inconsistent with the immutable approved binding. The normal presenter worker separately checks its adapter provider/model at `packages/creative-runtime/render/presenter-worker.mjs:46`; consequently this is a controlled SQL/provenance integrity gap, not a demonstrated HTTP exploit or unauthorized external request.

**Reproduction (executed):** Create an active approved stock binding `heygen/avatar_iv`, enqueue a valid talking_head job, claim as `review-worker`, and use the actual EXECUTE-only worker role:

```sql
SELECT tanaghom.begin_creative_provider_call(
 :claimed_job, 'review-worker', 'synthesia', 'unapproved-model', NULL,
 'talking_head', '{}', NULL, 'review');
```

Actual result: accepted, persisted call UUID `fbd3406f-1787-464e-b437-00d314634ae1` in the final disposable probe. No provider was contacted. The immutable governance authorization does not constrain the supplied ledger identity at this SQL boundary. This does not imply a Synthesia adapter exists.

## Verified positives and boundaries

Independent final clean-disposable execution: `node C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-db-review-probe.mjs`, native exit **0**, **52 labeled observations** (not 52 product PASS cases). Native stdout/stderr preserved at `C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-db-review-final.log`, structured observations at `p5-db-review-probe.json`. The observation collector deliberately records both product defects and expected security denials; exit 0 means completed reproduction/cleanup, not product acceptance.

Additional final-run results: all **24 actual CRUD attempts across six worker tables** fail 42501; existing foreign organization + foreign avatar/binding/consent combinations fail the composite tenant FK constraints; both filtered claims refuse all five queued decoys; a valid worker begin/attach/indeterminate finish/P4 reconciliation retains the same attempt/call/task and records synthetic actual cost 0.125; attempted succeeded-to-failed rewrite is denied; EXECUTE-only worker registers a draft output with canonical avatar/binding/task/cost provenance and completes it. The SQL output fixture is intentionally synthetic metadata, not media-validator proof.

Independent real execution (final exit 0):
- All 43 up migrations applied to an empty, uniquely named/owned PostgreSQL 16 fixture; unused 0046 down removes governance tables, re-up succeeds.
- All three controls default OFF, and used-state re-up resets them OFF.
- Actual restricted worker SELECT on canonical avatars fails 42501.
- All five new controlled presenter functions are SECURITY DEFINER with `search_path=pg_catalog, pg_temp`; table/function references inspected are qualified.
- Wrong consent scope, newest scoped revocation despite an older verified consent, queued revoke before provider-call begin, expired latest consent and foreign tenant avatar each fail P0001.
- Attempted restoration of a revoked consent fails `revocation is final`.
- Exact JSON snapshots of avatars, bindings, consents, jobs, assets, versions and provider calls survive used-state down/up unchanged, including retained consent and provider-call history.
- Every reviewer-created container was removed by exact ID after owner-label verification, with subsequent inspect confirming absence.
- Existing unchanged `node --test tests/creative-talking-head.test.mjs`: 11 tests passed, 0 failed.

Static review of actual oracles confirms composite tenant FK coverage, foreign evidence/visual/audio rejection, consent snapshot matching, active avatar/binding checks repeated at execution, operation+capability filtered claims, five queue decoys and two-worker claim contention. I did not independently rerun the complete API/browser acceptance, crash probe or all historical regressions. Concurrent revocation precisely between the last committed authorization and external dispatch has no demonstrated atomic cutover oracle here; the shipped concurrency case tests competing claims, not that revocation boundary. No unsupported race blocker is asserted.

## Evidence accessibility / claims

Programmatic inspection of staged JSON: native receipt contains 80 PASS entries, 38 creates and 40 queries; the cited runner contains 50 zero-exit wrapper receipts. These counts overlap and are not additional independent tests.

Referenced native `.log` files are present/readable locally but not staged. Inspected local native test tail reports 264/264, and acceptance tail records used-state rollback/re-up/cleanup; those native logs will not be available from the frozen patch alone. Staged JSON receipts remain available but are self-reported evidence, not a substitute for a least-privilege API test. `audit-final.json` reports zero vulnerabilities; the documented `--audit-level=high` versus repository moderate-threshold discrepancy was already assigned to the parent and is not counted as a new blocker here.

## Scratch artifacts / probe issues

Created outside the repository:
- `C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-review-database.md`
- `C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-db-review-probe.mjs`
- `C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-db-review-probe.json`

Initial reviewer probe attempts hit fixture-only readiness/auth-subject/object-key setup errors. They were corrected only in the scratch probe, each failed fixture was cleaned up, and the final unchanged-source probe completed with exit 0. Fixture asset metadata is an explicit synthetic SQL governance fixture, not evidence of media validation/storage. No source assertions were weakened. Final staged hash is unchanged and `git diff --name-only` is empty.
