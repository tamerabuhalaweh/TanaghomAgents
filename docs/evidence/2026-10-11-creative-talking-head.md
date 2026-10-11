# P5 #240 — correction cycle 1, remaining runtime blockers (2026-10-11)

**CURRENT-BYTE SOURCE GATES GREEN; BOTH NEW INDEPENDENT REVIEWS PENDING. NO PUBLICATION. LEDGER ONLY / EXTERNAL ACCEPTANCE PENDING.** Native green tests are not independent approval, provider/custom identity acceptance or production certification.

Branch `feature/creative-p5-talking-head`; unchanged HEAD/base `04eb35a4bf14ff98efd0023a182f0e1c9f578d60`. This continues the original R1/R2 correction scope. D1/D2 source is unchanged; no SQL/API redesign, dependency installation, commit, push, PR, merge, deployment, real-provider request, credential use, upload, spend, enrollment, TTS/voice clone, music, billing, publishing or production activation. Feature defaults remain OFF.

## Current artifact and preserved history

The authoritative new evidence directory is **`evaluation/creative-talking-head-v1/corrections/remaining-runtime/`**, abbreviated **N**. Latest full gates are exclusively **N/final/**; N root and N/current executions are intermediate checkpoints, not final-byte certification. N/manifest.json, N/gate-receipts.json and N/review-handoff.md bind final source/evidence and describe review boundaries. The final binary/full-index staged patch hash is outside the hashed patch, in scratch `p5-correction-20261011-1/remaining-runtime/review-ready-freeze.json`.

The old `corrections/review-ready/` checkpoint and its b2f09838bb5ffabcc62696c4d05622a71084553c1fa3e1ff4bc1f827b4037e06 frozen patch remain unchanged and historical. Its runtime independent verdict was **FAIL**, database verdict **PASS (source-only)**. Both reports are retained in N/historical-review and at their original scratch paths. That database PASS applies only to the old digest and cannot approve the new freeze. The former version of this source report is preserved exactly as N/historical-review/prior-source-evidence.md. Original runtime/database FAIL/BLOCKED evidence, prior SQL/API/runtime REDs, prior native logs, original freeze receipt/patch and database review history are neither overwritten nor relabeled.

Native outputs are staged as sanitized `.log.txt` copies. N/native-log-digests.json records each raw and staged digest, origin path and normalization. Credentials/JWTs are redacted and CRLF/trailing whitespace normalized; assertions, outcomes and diagnostics remain native, not reconstructed. The unchanged independent security/media oracles are retained byte-identically in scratch `p5-remaining-runtime-cycle1/`, with exact source copies and digest provenance in N/oracles/.

## Actual final-byte gates

| Command | Exit | Native result |
|---|---:|---|
| `npm test` | 0 | N/final/native/unit.log.txt: **343/343**, zero failed/skipped/cancelled |
| targeted presenter-review/boundary/talking-head/motion/video `node --test` | 0 | N/final/native/targeted.log.txt: **122/122** |
| unchanged independent security + media oracles `node --test` | 0 | **19/19**; prior same-oracle RED **10 PASS / 9 FAIL**, exit 1 |
| `npm run check` | 0 | repository verification; final post-report check also retained |
| `npm run build:dashboard` | 0 | fresh default dashboard build on final runtime source |
| `npm run typecheck:dashboard` | 0 | built-generated and restored-original next-env import runs retained |
| `npm audit --audit-level=moderate --json` | 0 | **0 vulnerabilities**, actual CI moderate threshold |
| `node scripts/creative-talking-head-acceptance.mjs --browser` | 0 | **82 unique PASS** cases, **39 creates / 41 queries**, exclusively owned loopback fixture traffic |
| regression `contracts database foundation image` | 0 | all four fresh suite exits 0 |
| regression `design motion` | 0 | both fresh suite exits 0 |
| regression `video segmentation` | 0 | both fresh suite exits 0 |

Final acceptance run ID is `78928303-f876-416f-803a-ddd3f656c485`: **51 successful wrapper gates**, **43 actual up migrations** through 0046, unused down/re-up, restricted SQL/API/worker, browser, used down/up and flags-OFF proofs. Review SQL retains **43 PASS labels**, including direct CRUD denial under both restricted roles. Used-history snapshots of all seven identity/consent/job/asset/version/provider-call tables are byte-identical; re-up controls are all false. API uses `tanaghom_api`, workers use EXECUTE-only `tanaghom_creative_worker`; admin is only fixture bootstrap/fault scheduling/assertion authority.

All eight final regression suites were rerun after the last production edit. Native PASS-label counts: contracts 52, database 1, foundation 18, image 15, design 18, motion 17, video 21, segmentation 14. These, 51 wrapper gates, 43 SQL labels, 82 acceptance cases, 122 targeted cases and 343 units overlap and are **not added** into a purported total. Historical counts 279/58/82 do not certify the new bytes.

## Remaining R1/RC1 — root cause and correction

**Product security defect:** inherited IPv6 classification used spelling prefixes and an unconditional colon-to-public fallback. Alternate compressed/expanded spellings, fc01/fe90 ranges, hexadecimal mapped IPv4 loopback/private/metadata, reserved/benchmark/discard addresses and mixed DNS sets could reach the reused pinned transport. The retained unchanged RED used the real default HTTPS transport with test bypass OFF and an owned ephemeral localhost listener: one connection and 374 TLS ClientHello bytes.

The same hardened downloader now validates IP syntax, normalizes the address into binary integer bits, compares complete CIDRs, unwraps both dotted and hexadecimal IPv4-mapped/RFC6052 well-known /96 tails into the existing IPv4 gate, and rejects scoped/invalid addresses. Private, link/site-local, multicast, protocol/benchmark/documentation, transition/discard and unallocated destinations fail closed. Its positive IPv6 gate uses a retained IANA RIR allocation snapshot; new/unlisted allocations require review rather than becoming public merely because they fit 2000::/3. Provider-specific protocol ranges are conservatively excluded. Valid public IPv4/IPv6/mapped/translation controls still pin successfully in offline transport doubles.

Exact approved origin, hostname, HTTPS requirement, all-answer A/AAAA rejection, original Host/TLS-SNI, pinned destination, redirect revalidation and byte bounds remain the existing boundary. No generic HTTP bypass or second P5 downloader was introduced. Final unchanged oracle proves **zero actual default-transport localhost connections and zero TLS bytes**; strengthened tests also reject both mixed-answer orders and equivalent binary spellings. No external private-address probe or vendor transport was performed. IANA public registry retrieval was documentation-only, not provider execution.

## Remaining R2/RC2 — root cause and correction

**Product structural-admission defect:** the validator trusted stsd's declared entry_count and reported the first codec without proving that each referenced description existed. A real 52,247-byte encoded H.264/AAC fixture with unchanged media payload/offsets but declared count 2 and active index 2 was admitted even though only one description existed.

The bounded validator now proves actual stsd count, bounded entry parsing and exact parent coverage before trusting any sample_description_index. Every description has a valid minimum entry layout; actual video codecs/visual metadata and audio codec/channels/rate must be consistent. Every active chunk mapping indexes an actual entry, and **all** video/audio tracks must agree with the admitted codec/audio report, preventing a secondary track from hiding an unsupported active entry. Missing, malformed, truncated, undeclared-extra, unsupported and mismatched descriptions fail closed. Consistent existing second-description positive controls pass. Existing mdat/sample extent checks remain; no decoder/platform dependency was added to admission.

The original unmodified fixture still reports avc1, 360×640, five seconds, mp4a mono/48 kHz and 52,247 bytes, and real FFmpeg decodes with exit **0**. The unchanged nonexistent-description mutation is rejected as `mp4_malformed_stsd`; actual FFmpeg still fails with native Windows exit **3199971767**, diagnostics retained. This is structural container validation, not certification of all encoded bitstreams or spoken/lip-sync quality.

## RED classifications and unchanged D1/D2

- Unchanged independent oracles: native **19 tests, 10 PASS / 9 FAIL, exit 1** before repair; **19/19, exit 0** on final source. Original reviewer outputs and parent's native negative log remain retained separately.
- First strengthened-unit harness assumed moov was last; actual fast-start fixture places moov before mdat. Original **56-test, 16 PASS / 40 FAIL** output is preserved as mixed product/harness RED. The narrowly corrected fixture builder preserves every mdat byte and relocates offsets after entry insertion. The corrected-harness baseline genuinely failed **34/56** before production correction; no assertion was relaxed.
- Further sensitivity: secondary active-video description **1 FAIL / exit 1** before all-track enforcement; unallocated CIDR oracle **4 FAIL / 1 PASS / exit 1** before the allocation-aware positive gate. Final full units execute these strengthened tests.
- Intermediate full-unit **334/335** failure was an exact diagnostic-label regression for IPv4 documentation ranges, not an unsafe admission or failed private gate. Existing `reserved` reason strings were restored in production; unchanged original expectations pass.
- D1/D2 have no production delta versus the old independent database-PASS freeze. Controlled catalog/owner governance, zero API/worker P5 table CRUD, canonical approved provider/model/version ledger identity, consent/tenant checks and immutable remote-task truth remain unchanged and were freshly exercised in final SQL/API/worker acceptance. N/unchanged-database-provenance.json pins those unchanged files to the old freeze.

## Actual path and resource boundaries

Both talking-head and lip-sync retain authenticated API → durable filtered claim → restricted worker → provider-shaped create → immediate persisted remote anchor → same-task poll → validated private MP4/version/provenance → actual human review. Crash recovery uses a real killed child and different worker; unknown charge blocks artifact processing; synthetic settled success survives download failure without replacement create. Revoked/inactive/foreign references and five unrelated queue decoys remain denied/untouched. Actual browser previews decode and private/range/reviewer/viewer/OFF-control assertions execute. Synthetic pixels/tone audio establish no language, identity realism or lip-sync quality.

Fresh fixture containers use unique owner/task labels; runners validate the exact owned ID and owner label before removing it, then assert absence. Final acceptance exact-ID readback is absent and post-run task-240 labeled container census is empty. Foreign resources and historical unlabeled `67b85f4f1d49...` were untouched; its disposition stays with the parent. No new dependency or package installation occurred.

## New freeze and required reviews

All task source/tests/docs and sanitized native evidence are explicitly staged. The outside-repository immutable freeze receipt records the new binary/full-index patch digest, staged file list, full index/worktree byte equivalence, current source/evidence hashes, unchanged HEAD, empty unstaged/untracked implementation, and `git diff --cached --check` result. It avoids a self-hash loop.

The parent must obtain **both explicit independent PASS verdicts at the identical new hash**, including a new database review despite the older database PASS. This implementer supplies no independent approval. Do not alter the index after freeze; no commit/push/PR/merge/publication is authorized. Provider/legal/privacy/biometric/training/custom identity, spoken-media quality, real charge and production acceptance remain pending; all external activation gates remain closed.
