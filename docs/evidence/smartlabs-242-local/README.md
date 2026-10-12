# Issue #242 — local source gates ready for independent review

This evidence supersedes the **gate disposition**, not the retained failures/bytes, in the original scratch `smartlabs-adapters-handoff.md`. Base/HEAD remains `b81e01e5c9d3b5486632569014008aabf11a01f1`; branch `feature/smartlabs-server-adapters`. No commit, push, PR, merge or deployment by this worker. The parent must independently review the exact indexed freeze identified in the new external `smartlabs-242-final-handoff.md` before publication. #243 remains PAUSED.

## Current native gates

| Gate | Native result | Current receipt |
|---|---|---|
| Targeted actual SmartLabs adapter/factory/file config tests | 81 tests, 81 pass, 0 fail, 0 skip; exit 0 | `targeted-final.log` |
| Normal `npm test` | 424 tests, 424 pass, 0 fail, 0 skip; exit 0 | `full-final.log` |
| Normal `npm run typecheck:dashboard` | exit 0 | `typecheck.log` |
| Normal `npm run build:dashboard` | exit 0; actual Next production output | `build.log`, `build-isolation.json` |
| `npm run check` | exit 0, 1710 files checked | `check-final.log` |
| Online `npm audit --audit-level=moderate` | exit 0, 0 vulnerabilities, same CI severity | `audit-online-final.log` |
| Fresh PostgreSQL 17.6 full historical migration chain through 0047 | 44 actual ledger rows; latest 0047 | `migration-final.log`, `foundation-fresh.log` |
| 0047 rollback/refusal | unused down/up and populated prior-format row/job/version/provenance preservation; repeated/wrong-baseline refusal; used Ogg down refuses without changing rows; escalated role/broadened API/worker permissions refuse | `migration-final.log` |
| Restricted API/worker actual login SQL | direct Creative INSERT/UPDATE/DELETE and role escalation denied; existing controlled functions work | `combined-final.log`, `restricted-current-grants.log` |
| Registered Creative foundation integration | full migration/SQL, normal Next API auth/tenant, private uploads, decisions and EN/AR desktop/mobile browser journeys; exit 0 | `foundation-fresh.log` |
| Combined native source/stub integration | actual Next authenticated enqueue/approval + compiled trusted factory/auth seam + actual restricted PostgreSQL/private filesystem + G→T→A same approved asset; exit 0 | `combined-final.log` |
| Native unreadable regular `_FILE` | Windows exclusive file lock denies both key loaders, constant error without path/key, exact success after release; exit 0 | `unreadable-native.log` |
| Owned fixture cleanup | both exact IDs/labels verified before removal including anonymous volumes; exact IDs absent and owner-label census empty | `cleanup-issue242-*.json` |

No NODE_OPTIONS resolver, borrowed dependency layout or replacement compiler is used. The optional decoder test uses only the already-installed **versioned** FFmpeg executable pinned in `decoder-pin.json`, identical SHA-256 before/after. Normal dependencies came from the parent's separately authorized successful pinned `npm ci`; `package-lock.json` stays SHA-256 `e28945f1e087cf707c5948e5595252476ec9b48e0d95f56e54479a2dbe389dcf`. No install/update/global/version changes by this worker.

## Secret isolation and `_FILE`

Application config and explicit CLI load backend-only `_FILE` alternatives through the same bounded loader. Direct-plus-file (including empty direct) is rejected. Only a single terminal LF/CRLF file-writing convention is removed; credentials are never trimmed. Invalid whitespace/non-ASCII/NUL, missing/nonregular/unreadable/empty/oversized files and missing enabled keys deny safely. All flags default OFF. Blank examples include no file paths.

The normal actual production build receives fake direct keys and fake `_FILE` inputs with all flags OFF; four exact fake values and paths are scanned in emitted `.next/static`, browser JS/maps, public files and server-rendered HTML/RSC/maps. All 735 scanned files have zero fake-value/path or SmartLabs environment-name hits. File-only configured auth factory health stays non-spending with zero requests. The actual built Next server renders `/login`, cookie-authenticated `/workspace` and `/creative`, and `/api/health`; exact marker/name scans pass and redirected login cannot masquerade as authenticated-page success. Server-only env names are not forbidden from backend source. Only `.env.example` exists in the searched root/dashboard env filenames; no real dotenv/key files were read. `next-env.d.ts` generated hash and restoration to verified baseline policy are recorded in `build-isolation.json`.

## Combined proof and limits

The native fixture mounts fresh TypeScript compilation of the **actual** factory/auth/authorization/storage/key/control modules behind an owned loopback harness; only server-only import handling, API pool wiring and explicit owned-loopback adapter transport seam are injected. Authentication verifies real locally signed JWTs through an owned JWKS server and actual tenant/user DB lookups. The actual production-built Next server runs existing enqueue, approval and rendered routes. This is not a new application public endpoint and not a claim that the factory was invoked through a public production route.

An actual restricted worker claims/runs an existing Creative voice job with a 600-second lease. Unauthorized and foreign tenant attempts send zero provider requests. Gemma-shaped stub returns Arabic; that exact text goes to OmniVoice-shaped stub; valid native encoded PCM16/mono/24 kHz WAV (4844 bytes, 0.1 seconds, SHA-256 `8c8a8b3f48179dc4fc9abb5e6afad9df40f28d48e53c9269bfde32eb500f4a4a`) is validated and privately stored/read back, registered and completed via controlled functions. Existing Next approval changes the version to approved. ASR stub receives the same file and only `language=ar`; transcript/source lineage and hash-only audit match the original tenant/job/correlation/checksum. Native counts are exactly Gemma=1, TTS=1, ASR=1, models=0. All are stubs; **zero real provider calls**. The pinned exact counter is an immutable synthetic-fixture attestation, NOT an installed/verified production tokenizer/chat template.

## Retained failures and classifications

* Original 419/420 pg-child failure: **test environment defect / incomplete worktree dependencies**, not product/workspace metadata. Parent's normal pinned npm ci and exact retest passed without source/test changes. Old evidence/manifest `62b4...` remains historical.
* `_FILE` missing behavior, enabled missing-key early denial and CLI file-only refusal have genuine native RED then GREEN receipts. No real secrets are involved.
* 0047 initially accepted an escalated worker role and a wrong-baseline down; genuine native REDs are retained. Targeted migration guards now refuse safely without grants or baseline weakening, followed by actual GREEN full cycle.
* `combined-attempt1.log`: harness omitted the standard `URL` global, causing real auth denial. It was repaired by providing that built-in (not by replacing auth); `combined-attempt2.log` and final current harness pass. Rendered-page oracle was strengthened to cookie auth plus exact non-redirected pathname; the first run's redirected-page byte scans are historical only.
* `foundation.log`: trying another database in the same already-used PostgreSQL cluster correctly failed historical role-uniqueness migration 0012. **Harness setup defect**, not migration product defect. A separate fresh uniquely labelled cluster runs the unchanged migration baseline and full registered integration successfully in `foundation-fresh.log`. No old/foreign cluster/role was touched.
* `targeted.log` / `full.log`: intermediate successes had one explicit decoder skip; they are not the final zero-skip receipts.

## Remaining external gates / STOP

Independent parent/senior review of the same final indexed bytes and hosted CI remain PENDING. No worker publication. Real G1/T1/A1 remains **NOT RUN**, POST-MERGE ONLY after Astra safely imports keys and separate operator authorization. Real credits, latency, Arabic quality and backend acceptance remain UNKNOWN. Production exact tokenizer/template/model-context and thinking-OFF contract are not installed/proved; source dispatch fails closed without trusted capabilities, and no undocumented parameter/tokenize API is invented. Single admission-owning process is an operator requirement; process-global capacity is not distributed proof. Compressed decoder deployment digest/OS containment and private ACL/storage deployment remain operator gates. Flags stay OFF outside explicitly synthetic local fixtures. No #243 continuation, GPU/server access, paid/P5/provider acceptance, cloning/model/weight install or production activation.

Commands, exits, raw-output hashes and receipt hashes are indexed separately in `native-receipts.json`; final patch hash is outside the indexed artifact to avoid a self-hash cycle. Scoped evidence attributes preserve captured native bytes: logs are binary diff artifacts (native diagnostics can contain whitespace); JSON metadata permits conventional Windows CRLF, not other trailing whitespace. An inherited extra EOF blank line in the adapter test was removed for the indexed diff check; targeted/full zero-skip suites were rerun on those final bytes. No test oracle or baseline was weakened.
