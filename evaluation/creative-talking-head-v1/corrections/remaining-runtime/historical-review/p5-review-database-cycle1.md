# Independent corrected P5 #240 database review — cycle 1

## Verdict: PASS (database/source-only scope)

Frozen staged patch SHA-256, verified before execution and after execution:
`b2f09838bb5ffabcc62696c4d05622a71084553c1fa3e1ff4bc1f827b4037e06`.

Repository: `C:/Users/tamer/AppData/Local/hermes/cache/scratch/tanaghom-p5-decision`.
Base/HEAD: `04eb35a4bf14ff98efd0023a182f0e1c9f578d60`.
No unresolved database product blockers found. Original D1 and D2 are resolved under the corrected authority: do NOT grant direct P5 table CRUD to API/worker. This verdict does not certify providers, real legal consent, commercial spend, production, media quality or the separate runtime/UI review.

## Independently executed native evidence

All output is outside the repository, under `C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-database-cycle1/`.

1. Scratch redirect of the frozen acceptance runner: **exit 0**. Applied all **43** actual up migrations, from 0001 through 0046 (0041–0043 reserved), to a fresh uniquely named/labeled empty PostgreSQL 16 fixture. Exercised unused down/re-up, then the unchanged `creative-presenter-review-sql.mjs`, `creative-talking-head-sql.mjs`, and `creative-talking-head-integration.mjs`, all exit 0. Next used the restricted API LOGIN URL; workers used the restricted worker LOGIN URL, not postgres. Both roles were checked non-superuser/non-CREATEROLE/non-CREATEDB.
   - Native log: `acceptance-native.log`.
   - Runner: `acceptance/runs/631a22c9-80f2-42fa-ba39-7b863ec20945/runner.json`.
   - Native HTTP/worker receipts: `acceptance/native-receipts.json`.
   - Exact used-state snapshots and flags: same runner directory, `used-state-before.json`, `used-state-after-down.json`, `used-state-after-up.json`, `flags-after-up.json`.
   - This non-browser run has 75 labeled integration receipts and 51 wrapper receipts; they overlap and are NOT additive independent tests. The seven browser-only receipts from the staged 82-label run were not rerun here.
2. Independent augmented reviewer SQL probe, fresh empty uniquely owned PostgreSQL, all 43 migrations, actual `SET ROLE` calls: **exit 0**. Final `independent-native-v4.log`, `independent-probe-v4.mjs`, `independent-probe-v4.json` contain 93 labeled native observations (including expected security denials and lifecycle evidence, not 93 distinct PASS test cases).

## D1 — corrected controlled API admission and isolation

Source inspected:
- `0046_creative_talking_head.up.sql:78–140`: actor-scoped catalog and owner governance; tenant derived from active accepted human actor joined to active organization, not request organization_id.
- Same migration `332–342`: no direct P5 CRUD; exact API/worker function grants and PUBLIC execution revocation.
- `avatar-governance.ts:15–20,37–40`: authenticated owner, field whitelist, controlled management function supplied with authenticated `user.id`.
- `presenters.ts:17,23–25,35–39,49–53`: authenticated actor; request identity/provider/model/consent overrides rejected; organization comes from authenticated user; canonical authorization/validation and controlled job creation; catalog calls actor-scoped reader.

Native observations:
- ALL four P5 tables reject SELECT/INSERT/UPDATE/DELETE under API and worker with PostgreSQL **42501**. Existing jobs/versions/provider ledger worker CRUD also remains denied. No broad schema CREATE right was added to either role.
- All seven new controlled functions are SECURITY DEFINER with exact `search_path=pg_catalog, pg_temp`, no PUBLIC EXECUTE, and the intended four API / three worker split; opposite-role execution absent.
- Catalog, avatar creation, binding creation/status, custom consent creation/revocation/readback work under restricted API. Random/inactive actors, unauthorized management roles, foreign binding mutation, and injected organization_id are rejected; other-tenant catalog discloses no identities.
- Actual authenticated restricted-API HTTP submissions/status/preview/review work for both lanes. Tenant/RBAC rejection cases also execute through that API, not a superuser API URL.
- The old API direct table query still fails 42501, correctly. The old authorizer reproduction now reaches the function and fails **P0001 presenter execution disabled** with flags OFF, rather than 42501. Valid enabled calls succeed.

## D2 — approved canonical provider/model/product and ledger identity

Source: migration `141–177,232–266`, especially allowlist `150` and canonical comparison/identity overwrite `253–256`.

Native observations:
- Approved HeyGen `avatar_iv/v3` and Sync `lipsync-2/v2` tuples succeed; caller Synthesia, wrong model, wrong/missing version, unapproved products are denied **P0001**, with zero provider ledger append in unchanged review/integration SQL oracles.
- Canonical avatar_id, binding_id, provider_avatar_id and consent_id overwrite malicious caller ledger-unit identities in the independent positive probe.
- Inactive/blocked/revoked binding or avatar, cross-tenant/tampered queued params and foreign visual/audio/consent references are rejected before fixture provider create.
- Composite tenant avatar FKs are validated; actual cross-tenant binding/consent INSERTs fail **23503**. Approved evidence and authorship are additionally checked by the governance trigger.
- Consent is a retained scoped record, not a boolean: wrong scope, expired latest consent, newest scoped revocation despite an older verified record, mismatched snapshot and queued-before-revoke execution are denied. Restore-revoked update fails `revocation is final`. Queued revoke produces zero fixture provider creates. No stronger atomic external-dispatch revocation claim is made.

## Queue, P4 compatibility, output and rollback

- Both filtered presenter claims leave five unrelated video/motion/segmentation/image/product jobs untouched; concurrent native claims admit one winner.
- Shared P4 begin/attach/finish/reconcile functions work for a non-presenter `text_to_video` fixture as well as P5: same call/task/attempt is settled succeeded with fixture actual cost, and conflicting terminal rewrites fail P0001. P4 controlled reader remains byte/field-equivalent across used down/up.
- Fixture remote success survives local download failure and retry without creating a replacement task; actual process kill after durable attachment recovers under a different worker with the same anchor. UNKNOWN actual cost prevents artifact download. These are loopback fixture observations, not real provider billing.
- Restricted worker registers a private draft version with canonical provenance. The unchanged integration uses actual encoded fixture MP4 bytes, authenticated private/range preview and review; the extra SQL-only output is explicitly synthetic metadata, not media-validation proof.
- Unused down removes governance tables; used down preserves exact avatars, bindings, consents, jobs, assets, versions and provider-call rows/provenance. Re-up is identical for these snapshots, retained operation vocabulary permits historical rows, and all three feature flags return OFF. Down removes P5 executable helpers while preserving historical baseline semantics; no claim that every older generic talking_head vocabulary entry disappears.

## Native RED classifications — preserved, not hidden

| Evidence / exit | Classification and resolved cause |
|---|---|
| `old-oracle-red.log`, exit 1 | **Stale fixture setup/expectation.** Original oracle creates HeyGen bindings without newly required immutable model_version. Native P0001 `presenter provider model denied` at create_job is correct. Scratch fixture now explicitly uses approved v3; original source/probe/log remain untouched. |
| `independent-native-v2.log`, exit 1 | **Harness defect.** Consent fixture supplied instantaneous client time; the no-future check can reject host/container clock skew. All other consent inputs/gates were valid. Scratch fixture uses PostgreSQL clock minus one minute; production validation unchanged. |
| `independent-native-v3.log`, exit 1 | **Stale reviewer expectation.** Post-rollback reader expected error_class null. Existing unchanged P4 migration `0044:222–225` deliberately coalesces/retains prior indeterminate diagnostic even after succeeded status. Corrected oracle asserts that retained diagnostic and exact complete pre/post controlled-reader snapshot, rather than weakening status/task/cost/identity assertions. |

`independent-native.log` (v1) and `independent-native-v4.log` both exit 0. Final v4 includes the additional P4 compatibility/owned-ID observations; earlier runs are retained separately. No unresolved product or migration-chain setup defect remained.

## Commands and integrity/cleanup

Working directory for all executions: repository above.

```bash
P5_SCRATCH_DIR='C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-database-cycle1' P5_EVIDENCE_DIR='C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-database-cycle1/acceptance' node 'C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-database-cycle1/acceptance-runner.mjs'
# exit 0; stdout/stderr redirected to acceptance-native.log
node 'C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-database-cycle1/old-oracle-red.mjs'
# exit 1; retained old-oracle-red.log
node 'C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-database-cycle1/independent-probe.mjs'
# exit 0; retained independent-native.log
node 'C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-database-cycle1/independent-probe-v2.mjs'
# exit 1; retained independent-native-v2.log
node 'C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-database-cycle1/independent-probe-v3.mjs'
# exit 1; retained independent-native-v3.log
node 'C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-database-cycle1/independent-probe-v4.mjs'
# exit 0; retained independent-native-v4.log
```

The scratch acceptance copy changes only dependency resolution to absolute pg and explicit disposable fixture connection, plus evidence environment redirects; assertions and child source scripts are unchanged. Existing Next production build was used without rebuilding or editing generated artifacts; source wrappers were independently read.

Every run removes only its own immutable container ID after matching its owner label, then checks inspect exit 1. Final independent owned ID: `c8dcc15d773578ac8c66da1ee1fc2728e43b8f42317385b9042a50ee76409183`, owner `9e47256e-8dd1-40da-a925-e5b26bb282fc`. Extra read-only post-run inspection of acceptance/v2/v3/v4 exact IDs confirms absence: `owned-cleanup-verification.json`. Earlier oracle/v1 cleanup is preserved in native logs. Foreign Docker resources and historical unlabeled `67b85f4f1d49...` were not touched.

Before/after `git diff --cached --binary --full-index | sha256sum` matched the frozen hash. `git diff --name-only`, `git ls-files --others --exclude-standard` were empty; `git diff --check --cached` exit 0. Original `p5-review-database.md`, `p5-db-review-probe.mjs/json`, and `p5-db-review-final.log` remain preserved. No repository/index/evidence edits, source fix, commit, push, PR, publication, real provider connection, real credentials, media upload, spend or production activation.

Native SHA-256:
- `acceptance-native.log`: `8cdc3cd8638e86b46ad405dae0a5a5de16164976ae458deb741c59560d580405`
- `independent-native-v4.log`: `4106484cf6f0a88a634648fb869a002ac6187f7718f59c083b7cec9032f4e3e3`
