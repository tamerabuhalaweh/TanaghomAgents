# Independent P5 runtime/provider/media/UI review

## Verdict: FAIL

Frozen staged patch SHA-256, independently verified at beginning and end with `git diff --cached --binary --full-index`:
`7c265e589fb3e6dea39cc01643d695aa66b3279903cbc6f6f7807b0885170f7e`

Worktree: `C:/Users/tamer/AppData/Local/hermes/cache/scratch/tanaghom-p5-decision`.
Baseline: `04eb35a4bf14ff98efd0023a182f0e1c9f578d60`. Staged files: 90. Unstaged tracked diff empty. No repository edits, Git writes, live provider calls, credentials, uploads, spend, enrollment, publication or deployment performed. SQL/governance review remains the other reviewer's scope.

## Blocking findings

### R1 — P2: runner's artifact-origin configuration is incompatible with the reused downloader

- New path: `scripts/creative-presenter-worker.mjs:18-20,26`; propagation: `packages/creative-runtime/render/presenter-worker.mjs:75`.
- Boundary: unchanged `packages/creative-runtime/adapters/http-image.mjs:133-138`.
- Runner requires each `CREATIVE_PRESENTER_ARTIFACT_ORIGINS` entry to be an exact HTTPS URL origin (`new URL(o).origin === o`), e.g. `https://artifact.example`. The existing downloader compares **hostname strings** to these entries, not URL origins. Consequently every valid configured HTTPS origin is rejected, while the hostname representation the downloader actually accepts is rejected by the runner. Loopback fixtures bypass this allowlist and cannot detect this integration bug.
- Executed offline reproduction: runner predicate accepts `https://artifact.example`; `validateArtifactUrl('https://artifact.example/output.mp4', {allowedOrigins:['https://artifact.example']})` throws `provider artifact host is not allowlisted`. Positive control with `allowedOrigins:['artifact.example']` succeeds.
- Effect: independently of DNS/transport, a future separately authorized/charge-settled run cannot retrieve its legitimately configured artifact. Current intentional unknown-charge gate masks this additional defect; that intentional gate is not itself a finding. Preserve the existing hardened downloader and establish a compatible, tested configuration boundary without broadening authorization to arbitrary hosts/subdomains/ports.

### R2 — P2: presenter admission accepts a metadata-only MP4 with no video/audio media data

- Admission: `packages/creative-runtime/render/presenter-worker.mjs:31,76-82` and `apps/dashboard/app/api/creative/assets/versions/[id]/preview/route.ts:42`.
- Validator: `packages/creative-runtime/render/mp4.mjs:301-310,357-365,404-419`.
- Reproduction used the real staged `encoded.mp4`: keep its `ftyp`, `moov`, and `free` boxes, remove the complete `mdat` box, and invoke the unchanged public validator with `expectedDurationSec:5`, `allowedCodecs:['avc1']`, `requireAudio:true`. It accepts the resulting **5,260-byte** file and reports H.264, 360×640, five seconds and AAC/mono/48 kHz audio, although no audio/video sample payload remains and sample offsets refer past EOF.
- Actual FFmpeg decoding of the mutated scratch file fails with `partial file`, `Invalid data found when processing input`, and `Nothing was written ... no packets`. Decoding the original staged fixture exits 0 with no error.
- Effect: the controlled input path can submit such an approved/checksummed file for paid work, and the result path can register/preview it as a validated presenter output. New `requireAudio` checks sample-entry metadata only; it does not establish actual audio data presence. This is an **inherited structural-validator weakness now exposed by P5's required input/output boundary**, not a claim that P5 originally introduced the missing `mdat` check. Full codec decoding need not be introduced to reject a file lacking media data or whose sample extents are outside it.

## Nonblocking notes / evidence limitations

- `validateWave` (`presenter-worker.mjs:16-18`) accepts a trailing incomplete RIFF chunk: append four bytes `junk` to the actual WAV, update RIFF length, and it still returns five-second PCM metadata. Tighten complete chunk consumption; no exploit or decoder failure is claimed for this tolerant case.
- Native `.log` evidence is available locally but **not staged**: all 32 top-level evaluation logs, plus runner/regression child logs, are excluded. `gate-receipts.json` and evidence document lines 11-23/50 point to those paths without binding log bytes by digest. Reviewable scripts and JSON summaries are staged, so rerunning is possible, but a PR checkout cannot inspect the claimed native GREEN/RED outputs. Include sanitized native logs or explicitly disclose local-only evidence and archive/hash them separately.
- Browser script `creative-talking-head-browser.mjs:24` takes `rtl-lip-sync.png` **after** navigation to the submitted job, not while showing the selected video/audio controls. Actual selector submission is exercised at lines 21-23. Mobile screenshot has the fixed navigation overlapping the form's lower action area; the recorded browser click succeeds, so this is an ergonomics/screenshot coverage note, not an asserted inaccessible submission bug.
- Crash oracle (`creative-talking-head-integration.mjs:164-168`) really kills a separate process after the post-attach marker and resumes using a different worker after controlled administrative fixture requeue. It asserts one create/one row, but should additionally assert the final exact call ID/task ID, success and retained actual cost as explicitly as the poll-timeout oracle does. It correctly does not certify a production lease reaper.

## What passed / was independently checked

- Read full task 240, ADR 0026, accepted provider decision and source-only evidence. HeyGen uses accepted v3 `/videos`, IV look and explicit stock voice; Sync uses v2 `/generate`, `lipsync-2`, controlled multipart video/audio, and rejects image/text/TTS input. Neither invents a cancel endpoint. Provider JSON is bounded, response/error bodies are not logged, status adapters leave actual cost null.
- Runtime uses P4 begin/get/attach/finish/reconcile and existing storage/downloader. Existing-row recovery refuses unanchored blind create; remote ID attaches before polling. Runtime governance recheck occurs after private source reads and before begin/create. Cancellation retains local intent separately from provider terminal truth. Success settles before download, unknown charge blocks download, and local artifact errors do not rewrite remote success. No fabricated estimate-as-actual path found.
- Independent fresh execution: `node --test tests/creative-talking-head.test.mjs tests/creative-image.test.mjs`: **19/19 passed, exit 0** (P5 11 + image/downloader 8). Existing hardened downloader remains unchanged; inspected HTTPS, all-address DNS validation, Host/SNI IP pinning, redirect revalidation and byte caps. No replacement downloader found.
- Parsed retained evidence, not blind receipt acceptance: 80 unique PASS named receipts; `cases.json` equals native receipts; 38 loopback creates/40 queries; 50 wrapper gates including 43 migrations. Read the actual crash/poll/local-download-failure assertions and browser selectors/playback/permission checks. Local native unit log reports 264/264; acceptance native log's 130 PASS labels are overlapping 80 cases + 50 wrapper gates, not 130 independent cases.
- All **566** manifest source hashes match present bytes; all three fixture digests match. No tracked unstaged diff means reviewed runtime source equals the staged freeze. Reviewed regression wrappers distinguish full-0046 contracts/foundation/image from historical migration-target sibling harnesses; their eight suite labels are not eight additional browser tests.
- Browser receipts record eight decoded frames each for talking-head and lip-sync with 360×640/five-second metadata. Browser oracle actually plays video, checks frames/currentTime, performs reviewer decisions and checks database state; these counts are not hardcoded. Inspected Arabic mobile script containing mixed text/punctuation/numerals and selected 9:16, and reviewer lip-sync preview/provenance/approve/reject screenshot. UI claims remain ledger-only; synthetic blue frames/tone audio are not represented as Arabic realism or lip-sync quality. Viewer/reviewer restrictions and flags-OFF closure are exercised by retained native harnesses.
- **Not rerun here:** disposable SQL/API/browser acceptance and full regression suites (their runners write repository evidence and create disposable fixtures). This read-only review inspected their shipped oracles/native local outputs; fresh independent execution was limited to the 19 units and scratch-only negative probes. No live quality/provider acceptance implied.

## Scratch artifacts

- `p5-review-runtime.md` — this report.
- `p5-review-runtime-probes.mjs` / `p5-review-runtime-probes.log` — executable offline negative probes and output.
- `p5-review-runtime-units.log` — fresh 19-test native output.
- `p5-review-runtime-no-mdat.mp4` — mutated scratch-only media sample; staged fixture untouched.

Ending frozen hash: `7c265e589fb3e6dea39cc01643d695aa66b3279903cbc6f6f7807b0885170f7e`.
