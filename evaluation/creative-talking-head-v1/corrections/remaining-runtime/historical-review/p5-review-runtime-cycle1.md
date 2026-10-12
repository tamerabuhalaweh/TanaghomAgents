# Independent READ-ONLY P5 #240 corrected-freeze runtime/security review

## Verdict: FAIL

Exact frozen staged patch SHA-256 (beginning and ending `git diff --cached --binary --full-index`):
`b2f09838bb5ffabcc62696c4d05622a71084553c1fa3e1ff4bc1f827b4037e06`.
Baseline/HEAD: `04eb35a4bf14ff98efd0023a182f0e1c9f578d60`.
Reviewed repository: `C:/Users/tamer/AppData/Local/hermes/cache/scratch/tanaghom-p5-decision`.

R1's original origin/hostname incompatibility is corrected. R2's original no-`mdat` reproduction is rejected. D1/D2 current restricted-function/canonical-ledger oracles pass on actual disposable PostgreSQL and authenticated HTTP. Nevertheless two independently reproduced product defects prevent runtime/security approval. No fixes or publication were performed.

## Blocking findings

### RC1 — P1: reused downloader's IPv6 gate permits non-public destinations

- File/function: `packages/creative-runtime/adapters/http-image.mjs`, `classifyIp`, lines 171–203, especially 174–175 and 193–201; enforcement `resolveAndPin`, 209–225; actual connection `pinnedRequest`, 241–255; P5 boundary `scripts/creative-presenter-worker.mjs:26` and `presenter-worker.mjs:75`.
- Mechanism: IPv6 classification is textual-prefix matching followed by unconditional `public`. `fc01::1` and `fe90::1` are admitted, as are hex-form IPv4-mapped loopback/private addresses `::ffff:7f00:1` and `::ffff:a00:1`. The mapped-address branch does not decode the embedded IPv4 bits. Reserved probes `2001:2::1` and `100::1` also pass. Public + hex-mapped-loopback mixed answers pass the all-answer gate.
- Native reproduction: `node --test C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-runtime-cycle1-review/security-probes.mjs` exits **1**, **17 tests / 9 PASS / 8 FAIL**. Each of six extra non-public answers reaches the transport double once instead of being rejected. A public-first mixed answer set also reaches transport.
- Stronger real transport proof: an owned ephemeral TCP listener on `127.0.0.1`, approved exact HTTPS origin `https://artifact.example:<owned-port>`, injected resolver answer `::ffff:7f00:1`, and the **unchanged real default pinned HTTPS request** produce **one localhost connection and 374 TLS ClientHello bytes**. No `testLoopback`, custom transport, credential, remote network request or successful HTTP response was involved. The server closes the socket; download rejects only afterward. This proves pre-connect public-only enforcement is broken, not that TLS verification was disabled or an arbitrary internal HTTP response was retrieved. DNS-answer injection is an explicit offline seam; live vendor DNS behavior is not claimed.
- Classification: **inherited product weakness exposed through the required P5 artifact boundary**, not a newly introduced origin-matching regression or a harness/setup failure. The task explicitly requires all A/AAAA private/link-local/reserved/mixed answers to be rejected. Exact origin checking and IP pinning do not compensate for accepting an unsafe pin. Flags-OFF/unknown-cost controls limit current execution but do not make this boundary conformant.
- Relevant artifacts: `security-probes.mjs`, `security-probes.log`, `security-command.json` in the receipt directory below.

### RC2 — P2: R2's sample-extent check accepts samples referencing a nonexistent codec description

- File/function: `packages/creative-runtime/render/mp4.mjs`, `videoSampleEntry`, lines 393–399; `validateMediaExtents`, lines 448–461. The latter trusts declared `stsd` entry count and only compares each `stsc.sample_description_index` to that count; it never establishes that the referenced entry actually exists. `videoSampleEntry` reports the first entry regardless of the active chunk description.
- Consuming boundaries: `presenter-worker.mjs:31` (approved input), `:76–82` (downloaded output and provenance), and preview `apps/dashboard/app/api/creative/assets/versions/[id]/preview/route.ts:42`.
- Reproduction: copy the actual encoded fixture to scratch; leave its **52,247 bytes**, real video/audio `mdat` payload, offsets, dimensions and duration intact. Change video `stsd.entry_count` from 1 to 2, without adding a second description; set every video `stsc` mapping's description index to 2. Actual description count remains **1**. The validator **accepts** and reports `avc1`, 360×640, five seconds, `mp4a` mono/48 kHz although the video chunks reference a nonexistent sample entry.
- Native command: `node --test C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-runtime-cycle1-review/media-probes.mjs` exits **1**, **2 tests / 1 PASS / 1 FAIL**. The unmodified fixture validates and FFmpeg decodes with exit **0**. The malformed scratch file is admitted, but FFmpeg exits **3199971767** on this Windows host, reporting invalid data/EOF and no output packets for the video stream. Exact native stderr is retained.
- Classification: **product structural-admission defect**, within R2's malformed sample-table boundary, not a request to certify all codec quality by decoding. Validating that an active description exists and corresponds to an allowed codec is a structural check. This is not the old metadata-only fixture: media bytes and extents remain present. A checksum or tenant approval authenticates bytes, not their container validity.
- Relevant artifacts: `media-probes.mjs`, `media-probes.log`, `media-command.json`, `nonexistent-description.mp4`.

## Independently executed positive/regression evidence

All commands and exits below are real execution; overlapping counts are **not added**.

| Command / scope | Native result |
|---|---|
| `node --test` over the repository's 279 test cases (explicit paths in `unit-command.json`) | exit **0**; **279/279**, no failed/skipped/cancelled tests |
| Unchanged `node scripts/creative-talking-head-acceptance.mjs --browser`, scratch sandbox with copied existing build | exit **0**; **82 unique PASS cases**, **43 review-SQL PASS labels**, **51 wrapper gates**, 39 synthetic creates / 43 queries |
| Fresh scratch `node scripts/dashboard.mjs build --webpack` | exit **0**; dashboard compiled/typechecked from the copied current sources |
| Same unchanged acceptance against the fresh webpack build | exit **0**; **82 unique PASS cases**, **43 SQL labels**, **51 wrapper gates**, 39 synthetic creates / 41 queries |
| Reviewer-augmented consent scheduling run against fresh build | exit **0**; original **82** cases plus **one additional race case** = **83 unique cases**; 43 SQL labels / 51 wrapper gates; 39 synthetic creates / 42 queries |
| Additional security admission oracle | exit **1**; 17 cases, 9 pass / 8 fail |
| Additional structural-media admission oracle plus actual FFmpeg | exit **1**; 2 cases, 1 pass / 1 fail; decoder positive 0 / malformed nonzero |

The scratch sandbox is `C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5rc1-sb`. **1,485 tracked files** were byte-compared on copy. Production/runtime/SQL source files are unmodified. Existing dependency directories were junctioned read-only in practice for execution; outputs/build/cache stayed in the sandbox. Fresh build regenerated only the sandbox's `apps/dashboard/next-env.d.ts` among the 568 manifest-bound source paths; the original repository's file was never changed. The first acceptance used the copied existing build; the later acceptance explicitly used a fresh webpack build, not a relabeled old artifact.

The consent scheduling loader first verifies the integration oracle hash against original current bytes, preserves every original assertion, and appends one explicitly reviewer-only scenario. It commits consent revocation on the admin fixture connection **after the runtime's second input recheck and before the actual restricted SQL begin**. Actual runtime begin fails with P0001, with zero ledger append and zero additional provider creates. This proves that scheduled boundary, not atomic exclusion of every possible revocation after ledger begin or after provider submission. Loader and execution receipts are retained separately; the 83-case run is not misrepresented as the unchanged candidate's 82-case run.

### Original runtime invariants observed through real unchanged acceptance

- Both independent lanes traverse authenticated API → durable PostgreSQL job → capability/operation-filtered claim → restricted worker → provider-shaped create/remote anchor → same-task poll → private validated MP4/version/provenance → human approval/rejection.
- Canonical avatar identity is separate from provider binding/provider avatar. D1 includes actual API and worker P5-table CRUD denial, controlled catalog/owner-management readback, invalid actor/non-owner denial. D2 rejects mismatched provider/model/version and unapproved product tuples; valid HeyGen and Sync tuples persist canonical identity.
- Submission and worker deny inactive/blocked/revoked identity/binding, absent/wrong/expired/latest-revoked consent, five foreign avatar/binding/consent/video/audio references, and foreign consent evidence. The new scheduled revocation probe independently verifies zero create at the SQL-begin race boundary.
- Five P4/video, motion, segmentation, image and compose decoy jobs remain queued; parallel SQL SKIP LOCKED yields one claim; full-reader permission denial is not treated as absence permitting create.
- A real child SIGKILL after task attachment, followed by a different worker and controlled fixture requeue, retains exact call ID/task ID, succeeded truth and synthetic actual cost **0.125**, with one create. Poll-indeterminate recovery stays on the same row/task; unanchored create ambiguity/429 never produces a blind replacement.
- Unknown actual cost blocks download. Synthetic charge settles before an intentionally failed artifact download; local retry preserves remote succeeded truth and one call/create. Local cancellation remains intent; remote-reported cancellation is separately settled, with no invented vendor cancel endpoint.
- Controlled WAV/MP3/video readers check private checksum/MIME/size/dimensions; wrong media/text/image inputs are rejected before provider create. Script audit payloads contain hash/length, not full script. Output storage/provenance/private authenticated preview/range and human decisions execute.
- Arabic/mixed/punctuation/numerals/portrait/desktop/mobile and owner/operator/reviewer/viewer paths execute. Fresh unchanged browser previews decode **8 frames each**, 360×640/five seconds. Synthetic pixels/tone audio do not establish spoken language quality, identity realism or lip-sync quality.
- Worker flags OFF deny execution before provider contact; all three API flags OFF deny both lanes/custom enrollment and disable browser controls. Used-history snapshots are byte-identical over down/up and re-up controls are all false.

## Frozen evidence/current-byte verification

Independently checked rather than accepting worker totals:
- **568** manifest source hashes, **54** current task-file hashes, **47** evidence hashes and **3** fixture hashes: zero mismatches.
- **164** native-log entries: staged sanitized hashes **and** raw local native hashes match current bytes; no missing raw files. `cases.json` exactly equals current `native-receipts.json.receipts`; 82 unique names, every status PASS.
- Parsed current native unit footer: 279/279; targeted footer: 58/58. Parsed current regression column-zero PASS/PASS: labels: contracts 52, database 1, foundation 18, image 15, design 18, motion 17, video 21, segmentation 14. SQL formatted result-row labels are not added. **The eight historical regression wrappers were not independently rerun here**; their bytes/counts were checked and original runtime isolation was rerun in full P5 acceptance. No blanket eight-suite independent certification is asserted.
- Beginning/ending exact patch hash agrees; HEAD unchanged; tracked unstaged diff and untracked files empty; `git diff --cached --check` exit 0.

## Harness/setup failures and cleanup

- Two sandbox preparation attempts exited 1 due Windows path-length handling while copying long historical log/build-cache paths. Shorter sandbox name and extended Windows paths resolved setup without modifying repository/oracles. These were **setup failures**, not product test failures.
- `node scripts/dashboard.mjs build` in junction-based scratch sandbox exited **1** because Turbopack rejects a dependency symlink target outside its filesystem root. `fresh-build.log` and `fresh-runtime-commands.json` preserve this **harness/layout failure**. A separately recorded fresh `--webpack` build exited 0; no default-build PASS is invented.
- Three newly created fixtures used unique owner/task labels. Each native runner checked owner label before removing its exact container ID; this reviewer then independently `docker inspect`ed each exact owned ID and observed exit **1 / No such object**. IDs and readbacks are in `final-verification.json`. No foreign container or the historical unlabeled `67b85f4f1d49...` was removed/touched.
- No original `p5-review-runtime.md`, original negative probe/log, staged evidence, docs, source, Git index, generated original `next-env.d.ts`, branch, HEAD or provider configuration was modified. No commit/push/PR/merge/deployment or real provider credential/API/media upload/spend/enrollment/TTS/voice clone/music/billing/publishing/SmartLabs/SmartCC operation occurred.

## Deliverables / scope boundary

Report: `C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-review-runtime-cycle1.md`.
Receipts/scripts/native logs/synthetic outputs: `C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5-runtime-cycle1-review/`.
Scratch execution copy: `C:/Users/tamer/AppData/Local/hermes/cache/scratch/p5rc1-sb` (not the reviewed repository).

Read task 240, ADR 0026, accepted provider decision, current source evidence, real runtime/download/media/adapters/preview paths and execution oracles. This is **runtime/security FAIL for the exact hash above**, not a legal/provider/custom/production acceptance or a substitute for the separate independent database review. Original R1/R2 exact reproductions are repaired, but RC1/RC2 remain blocking. No repair authorization is inferred or acted on.
