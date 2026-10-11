# P5 #240 — correction cycle 1, recovered final source evidence (2026-10-11)

**SOURCE VERIFICATION GREEN; BOTH INDEPENDENT RE-REVIEWS REQUIRED. LEDGER ONLY / EXTERNAL ACCEPTANCE PENDING.** This replaces the interrupted repair handoff, not the authoritative historical runtime FAIL/database BLOCKED. Unit and integration successes are not independent approval, provider acceptance, custom identity acceptance or production certification.

Branch `feature/creative-p5-talking-head`; unchanged baseline HEAD `04eb35a4bf14ff98efd0023a182f0e1c9f578d60`. No commit, push, PR, merge, deployment, real-provider request, upload, spend, enrollment, TTS/voice cloning, music, billing, publishing or production activation. All feature defaults remain OFF; enabled settings exist only inside disposable synthetic fixtures.

## Authoritative current artifact

Current evidence is `evaluation/creative-talking-head-v1/corrections/review-ready/` (abbreviated **R** below). `R/manifest.json`, `R/gate-receipts.json`, `R/self-review-20-gates.json`, `R/native-receipts.json` and `R/review-handoff.md` supersede root-level and intermediate correction summaries. Original root-level 80-case/264-test evidence is historical, not current certification. The final staged binary patch hash is recorded **outside the repository** in the immutable recovery freeze receipt, avoiding a self-hash cycle.

Native logs are retained locally and copied to staged sanitized `.log.txt` files under `R/native/`; each raw and sanitized byte digest is recorded in `R/native-log-digests.json`. Earlier native outputs and original FAIL/BLOCKED reports are preserved under `corrections/history-native/` and `corrections/historical-review/`, including REDs. Sanitization removes credentials/JWTs and normalizes CRLF/trailing whitespace, not assertions, outcomes or stack traces. These are native receipts, not reconstructed test output.

## Latest current-byte commands

| Command | Exit | Current native receipt / result |
|---|---:|---|
| `npm run check` | 0 | `R/native/check.log.txt`; repository verification (no separate lint script) |
| `npm test` | 0 | `R/native/unit.log.txt`: **279 tests, 279 passed, 0 failed/skipped/cancelled** |
| targeted presenter/talking-head/motion/video `node --test` | 0 | `R/native/targeted.log.txt`: **58/58** |
| `npm run typecheck:dashboard` | 0 | `R/native/typecheck.log.txt` and `typecheck-restored.log.txt`; generated `next-env.d.ts` import restored and rechecked |
| `npm run build:dashboard` | 0 | `R/native/build.log.txt` |
| `npm audit --audit-level=moderate --json` | 0 | `R/audit-moderate.json`: **0 vulnerabilities**, actual repository CI threshold **moderate**, not the old high-threshold claim |
| `node scripts/creative-talking-head-acceptance.mjs --browser` | 0 | `R/native/acceptance.log.txt`: **82 unique PASS API/SQL/worker/browser cases**, **39 creates / 42 queries**, all loopback fixture traffic |
| regression `contracts database foundation image` | 0 | `R/native/regression-a.log.txt`; suite exits all 0 |
| regression `design motion` | 0 | `R/native/regression-b.log.txt`; suite exits all 0 |
| regression `video segmentation` | 0 | `R/native/regression-c.log.txt`; suite exits all 0 |

The eight fresh regression suites separately report contracts 52 PASS labels, database 1 final PASS label, foundation 18, image 15, design 18, motion 17, video 21, segmentation 14. These are suite-native label counts, not one additive independent-test total. Contracts' 52 labels include 43 migrations. Each final batch has an observed exit 0; the earlier monolithic recovery wrapper timed out and is **not** promoted to a successful exit.

Final acceptance run: `R/runs/5498be00-09d1-43c7-93a4-261e892987df/runner.json`, **51 successful wrapper gates**, including all **43 up migrations through 0046**, unused down/up, review SQL, API/worker/browser subprocesses and used-state down/up. Review-specific SQL has **43 PASS labels**, including 16 actual API table CRUD denials and 16 actual worker table CRUD denials across all four new tables. Counts overlap and are not added to 82 cases or 279 units.

## Corrections and root-cause classifications

- **R1 product defect:** runner supplied exact HTTPS origins to a hostname-only downloader. The existing downloader now has an opt-in exact-origin boundary; image hostname behavior is retained. No second downloader. Production runner passes exact origins into that boundary. Exact host/scheme/port/credentials, empty approvals, subdomain, unsafe redirect, mixed A/AAAA/public-private, loopback/private/link-local/metadata and byte limits have current offline tests; public IP pinning and Host/TLS-SNI transport remain the original implementation. DNS/transport doubles are explicit offline test seams, not claims of live vendor HTTPS execution.
- **R2 product defect:** metadata-only MP4 without `mdat` was admitted. The bounded validator now requires nonempty media payload and video/audio chunk/sample extents inside it, with bounded sample-table parsing. Real encoded H.264/AAC positive fixture passes; removed/empty/dummy payload, malformed/truncated data, missing tables, corrupt chunk maps/offsets/sample sizes and out-of-bounds audio fail. This is structural admission, not full codec decoding or support for fragmented layouts.
- **D1 product defect and latest authority correction:** missing least-privilege admission was initially repaired with direct table/column grants. That approach is explicitly superseded. All four P5 tables remain inaccessible for direct API and worker CRUD. Narrow `read_creative_presenter_catalog(actor)` and `manage_creative_presenter(actor, action, body, customEnabled)` SECURITY DEFINER functions enforce current active tenant/actor roles, owner-only mutations, canonical provider configuration and tenant evidence. API catalog and management use these functions, not direct P5 table queries. Existing controlled enqueue/authorization functions are reused. No new schema-wide or table grants. The direct-grant RED is retained, and cross-tenant HTTP status expectations were preserved through a specific P0002-to-404 mapping, not weakened.
- **D2 product defect:** provider ledger begin accepted a provider/model/version different from the authorized immutable binding. It now reauthorizes full input, rejects mismatched tuple and unapproved HeyGen `avatar_iv/v3` or Sync `lipsync-2/v2` products, derives the persisted canonical tuple and adds canonical avatar/binding/provider-avatar/consent identity to ledger units. HeyGen and Sync positive readbacks and provider/model/version mismatch denials are current; existing forged-param, inactive and foreign-binding zero-create cases still execute.
- **Harness-only regression:** the historical video E2E fixture was metadata-only. Strengthened R2 correctly rejected it with `mp4_missing_media_payload`. Its synthetic structural fixture now has bounded sample tables and one `mdat` sample; all historical behavioral assertions remain unchanged. Both native regression failure and scratch fixture RED are retained. It is explicitly not decodable vendor media; P5 browser uses the real encoded fixture.
- **Runner interruption, not product success:** the first recovered eight-suite wrapper exceeded the tool deadline after seven native suite exits, leaving one labeled container/sibling. Exact ID/owner verification preceded removal; the interrupted receipt remains historical. Final regressions were rerun in the established three bounded batches, all exit 0.

Original runtime/database FAIL reports and all prior SQL/API/runtime REDs remain historical. Their setup failures, product defects and fixture issues are described in those original reports/transcript; none is overwritten or relabeled PASS. The broad-grant intermediate green checkpoint is not final acceptance under the latest authority.

## Required current path proof

- Actual restricted login transport: Next receives `P5_API_DATABASE_URL` whose user is exactly `tanaghom_api`; worker/crash/race connections use `tanaghom_creative_worker`. Both fixture logins are asserted non-superuser/non-create-role/non-create-db. Admin connection is used only for bootstrap, fault scheduling and durable assertions; there is no API superuser fallback.
- Both lanes traverse authenticated API → durable job → filtered SQL claim → EXECUTE-only worker → provider-shaped create → immediate durable remote anchor → same-task truth → private validated MP4 version → actual human review endpoints. Both approval and rejection execute for both lanes.
- Owner/operator generation, owner-only governance, viewer/reviewer generation denial, private read-only preview and reviewer decisions execute over the restricted API. Consent insertion/revocation, latest scoped consent, expiry and post-queue revocation retain history and prove zero additional provider creates. Five foreign references (avatar/binding/consent/visual/audio), catalog isolation and five queue decoys remain covered.
- Actual child SIGKILL followed by a different worker identity and controlled fixture requeue preserves the **exact call ID, remote task ID, succeeded status and synthetic actual cost 0.125**, with one create. This is not production lease-reaper certification.
- Poll timeout resumes the same anchored row/task. Ambiguous create never blindly retries. Remote success and fixture-settled actual cost precede forced local download failure; local retry retains one call/create. Unknown charge blocks artifact processing. Local cancellation remains separate from provider terminal truth; no invented cancel endpoint.
- Browser exercises Arabic/English/mixed, punctuation/numerals, portrait, desktop/mobile, owner/operator, reviewer/viewer and OFF controls. Current private talking-head and lip-sync previews each decode **7 frames**, report 360×640/five seconds and execute approve/reject decisions. Synthetic pixels/tone audio do not establish spoken language, realism or lip-sync quality.
- Used-state snapshots of all seven identity/consent/job/asset/version/provider-call tables are preserved as `used-state-before.json`, `used-state-after-down.json`, `used-state-after-up.json` under the final run directory; all three are byte-identical. `flags-after-up.json` contains all three false values. Unused down removes the new schema; both unused and used re-up succeed.

## Regression and resource boundaries

Full-0046 Creative SQL plus foundation/image API/browser regressions use current bytes. Historical database/P2/P3/P4/segmentation harnesses retain their exact-baseline assertions in owned migration-target-only siblings. The single video structural fixture correction is disclosed above. No unrelated production behavior or assertion was relaxed.

Every final acceptance/regression container is fresh, uniquely labeled, loopback-bound, removed by its exact ID after owner-label validation, with absence asserted. Foreign TaxPilot containers are untouched. Historical source container `67b85f4f1d492cabd52afc955eb7edf79aaf5d9b08d6bdb6ff668fd835eaa721` (`tanaghom-p5-source-pg`, port 45446) remains: it has **no ownership label**, so the recovery did not bypass the ID-plus-label cleanup rule or claim all historical resources cleaned. The parent has independently identified its task provenance; its disposition remains with the parent.

## Frozen-review handoff / external hold

The final freeze has no unstaged tracked diff or untracked implementation. Explicit task/evidence staging and `git diff --cached --check` are verified in the outside-repository freeze receipt; source/evidence manifests bind current bytes. The old frozen hash is historical and must not be reused for approval.

The parent must obtain **both** read-only independent re-reviews against the same new frozen hash: runtime **PASS/FAIL**, database **PASS/BLOCKED**. This self-review cannot supply those verdicts. No PR is authorized yet; no commit/push/publication occurred. Provider/legal/privacy/training/biometric/custom identity/spoken quality/authoritative real charge/production gates remain pending. Real execution and production activation remain unauthorized.
