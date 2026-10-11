# P5 — Completed provider decision

**Decision accepted by the user: 2026-10-11.** Issue #240 under Creative Platform master #221; official-source research predecessor #239. Baseline: `04eb35a4bf14ff98efd0023a182f0e1c9f578d60`.

**Completed means an accepted architectural recommendation and a completed documentary consolidation, NOT production, privacy, legal, security, commercial-rights, cost or quality certification.** User authorization is **SOURCE ONLY**. No real provider operation, spend, media upload, custom enrollment, activation, deployment or publication is authorized.

Controlling implementation documents are [task 240](240-talking-head.md) and [ADR 0026](../../../architecture/0026-creative-talking-head.md). This record supplies provider evidence and constraints; it does not create a competing roadmap, expand the task or certify another worker's implementation.

## 1. Acceptance boundaries

| Acceptance dimension | Recorded state | Meaning |
|---|---|---|
| Documentary decision | **COMPLETED / USER ACCEPTED** | Architecture B and conditional provider recommendation accepted. |
| `sourceComplete` | **TARGET ONLY / NOT ASSERTED HERE** | Task 240 must independently verify source, tests, jobs, UI and stub/disposable-runtime evidence. Documentation alone does not complete implementation. |
| `providerAccepted` | **NOT PASSED / REQUIRES SEPARATE ACCEPTANCE** | A bounded real-provider test requires new explicit authorization and provider gates; this user decision is not permission to call a vendor. |
| `customAccepted` | **NOT PASSED / OUTSIDE CURRENT EXECUTION SCOPE** | Real-person enrollment/biometrics and any incidental voice creation need separate acceptance. |
| `productionCertified` | **NOT PASSED** | Privacy/legal/security/rights/cost/quality and deployment clearance remain unpassed. |

`TALKING_HEAD_ENABLED=false`, `LIP_SYNC_ENABLED=false`, `CUSTOM_AVATAR_ENABLED=false` are the required defaults. Human quality status is **LEDGER ONLY / EXTERNAL ACCEPTANCE PENDING**. Public-document capability evidence is not tested API behavior or Arabic-quality evidence.

## 2. Accepted recommendation and Architecture B evidence

**Architecture B:** Tanaghom owns canonical avatar identity, tenant isolation, consent, provenance and governance. Remote provider group/look/face IDs are replaceable bindings, never canonical identity. `TalkingHeadAdapter` and `LipSyncAdapter` are independent capabilities. Future Voice remains separate. No permanent TTS/voice-cloning subsystem, realtime/CVI/WebRTC, phone/conversation avatar, publishing or billing subsystem is added.

| Provider | Accepted role | Source-only scope and reason |
|---|---|---|
| HeyGen | **CONDITIONAL PRIMARY** | Stock presenter + bounded script → MP4 private draft. Current v3 Avatar IV default, approved stock look and explicit approved voice. Custom audio is documented but does not expand the initial script lane. No twins/photo enrollment.[2][36][10] |
| Sync Labs | **CONDITIONAL SPECIALIST** | Independent existing approved video + existing approved audio → lip-synced output; initial `lipsync-2`. No text/TTS/dubbing branch. `lipsync-2-pro`/`sync-3` only future explicitly allowlisted, separately approved configurations.[51][49] |
| Tavus | **CONDITIONAL FALLBACK BINDING EXTENSIBILITY ONLY** | Keep provider-neutral schema extensible; no adapter required in P5. Async stock + approved audio is documented, but idempotency/callback/media/pricing/voice/privacy uncertainties make it a fallback rather than automatic failover.[74][100][79] |
| Synthesia | **EXCLUDED FROM CURRENT IMPLEMENTATION; DOCUMENTARY ALTERNATIVE ONLY** | No adapter. Public DPA/special-category biometric mismatch and subject self-enrollment gates, stock/synthetic paid-ad restrictions, and Personal Avatar offline API incompatibility prevent assumed suitability.[121][144][127] |

Evidence for this architecture is not just multiple vendor names: HeyGen groups and rendering looks are distinct IDs; Tavus faces retain the legacy `replica_id` video field; Sync accepts visual/audio assets without canonical avatar enrollment; Synthesia's editor identity catalog is not its API compatibility catalog. A vendor identity, training result or catalog entry therefore cannot stand in for local identity/consent/capability authorization.[20][21][74]

Talking-head rendering and existing-video lip-sync have different input, model, lifecycle and billing contracts. Sync's existing-audio path demonstrates the separate specialist capability; Synthesia uploaded narration renders its own avatar and does not prove an arbitrary-video audio replacement API.[51][132][103]

**No automatic cross-provider retry/failover:** a fallback binding is not permission to submit a second paid task for a failed/indeterminate local job. Reuse Creative Runtime/P4 durable provider-call records, exact operation/capability claim filters, private outputs and human review as required by task/ADR.

## 3. HeyGen: authoritative accepted v3 technical record

### Stock eligibility and model selection

API base `https://api.heygen.com`; API-key requests use `X-Api-Key`. API-key billing is distinct from OAuth/web subscription credits. Endpoint reference and actual approved look capability response govern source design, not marketing announcements or legacy v1/v2 examples.[40][35]

1. Discover public/stock groups with `GET /v3/avatars?ownership=public` (`ownership=private` is owned identity discovery).
2. List looks with `GET /v3/avatars/looks?group_id=...`; optional ownership/avatar-type filters. A group is character identity; the **look `id` is the `avatar_id` for rendering**.
3. Read `GET /v3/avatars/looks/{look_id}` and inspect `supported_api_engines`. Persist and locally approve group + look + engine + voice binding. Public catalog existence is neither universal engine eligibility nor proof of stock actor commercial/endorsement rights.[20][21]

| Engine | Accepted documented capability | Implementation gate |
|---|---|---|
| `avatar_iv` | v3 default; studio, twin, photo, arbitrary image and prompt-created avatar coverage. | Initial P5 stock route explicitly requests IV only for an approved eligible look. No arbitrary uploaded images.[2] |
| `avatar_iii` | Current v3 III, distinct from legacy III; twin/studio/photo. III twin/studio up to 4K; III photo up to 1080p. | No silent substitution to older III or inference that all engines support 4K.[1][35] |
| `avatar_v` | Higher fidelity, opt-in per look; categorical V guide/model matrix specifies eligible digital twins. `supported_api_engines` must include `avatar_v`. | **Not default stock engine.** Photo/V example and create-reference wording conflict with the categorical guide. Photo/studio V general availability **UNKNOWN / REQUIRES ACCEPTANCE**. Optional `reference_look_id` has same-group/twin/consent requirements. No generic V expressiveness claim.[3][21][4] |

### Request, status and output

| Need | Exact accepted endpoint/contract |
|---|---|
| Render | `POST /v3/videos`; response `data.video_id`, initial status example `waiting`, resolved `output_format`.[4] |
| Query provider truth | `GET /v3/videos/{video_id}`; documented enum `pending`, `processing`, `completed`, `failed`; duration, output references, failure information. Preserve the create/status vocabulary distinction.[5] |
| Delete output | `DELETE /v3/videos/{video_id}`; permanent video/associated-file deletion, **not confirmed render cancellation**.[16] |
| Genuine active-render cancel | **UNKNOWN**. `POST /v3/video-agents/{session_id}/stop` is agent-specific, not avatar cancellation. No invented `/cancel` route.[17][16] |

Documentation-derived **source shape only; not submitted**:

```json
{
  "type": "avatar",
  "avatar_id": "APPROVED_STOCK_LOOK_ID",
  "script": "APPROVED_BOUNDED_SCRIPT",
  "voice_id": "APPROVED_STOCK_VOICE_ID",
  "engine": { "type": "avatar_iv" },
  "resolution": "1080p",
  "aspect_ratio": "16:9",
  "output_format": "mp4",
  "callback_id": "LOCAL_GENERATION_ID"
}
```

Script and `audio_url`/`audio_asset_id` are mutually exclusive. Explicit voice selection is required locally: omitting `voice_id` may choose an avatar/group default voice. Approved custom audio can avoid synthesized voice use for a job, but does not prove twin enrollment stopped voice cloning. Audio URLs must be reachable public HTTPS; uploaded MP3/WAV can use an asset ID.[36][10][13]

**Idempotency:** optional header `Idempotency-Key`, 1–255 characters `[A-Za-z0-9_:.-]`, 24-hour replay; in-flight retry 409 `request_in_progress`. Differing-body replay/conflict prose is inconsistent: locally pin the exact immutable payload and key, never use a new key for the same job. Task/ADR's fail-closed indeterminate-create policy is stricter than a theoretical keyed replay; this document does not authorize blind retries.[4][22]

**Callbacks:** `avatar_video.success` / `avatar_video.fail`; `signature` is hex HMAC-SHA256 over raw body with endpoint secret, constant-time verification; 2xx within 10 seconds, retries up to 24 hours, possible duplicates. Deduplicate and re-read the exact video. Callback-URL signing parity is not independently confirmed. No webhook was registered.[8][9]

### Media/limit authority (container is not codec)

- Script max **5,000 characters**; avatar-containing video **25 fps**. Resolution enum `720p`/`1080p`/`4k`, but 4K eligibility is bounded by the engine matrix; IV/V 4K remains **UNKNOWN**. Aspect reference includes `16:9`, `9:16`, `4:5`, `5:4`, `1:1`, `auto`; overview is narrower. Request bounded format explicitly.[6][4][1]
- MP4 default; WebM alpha only for matting-capable avatars, with background-object/cinematic restrictions. **Exact MP4 video/audio codec profile and WebM codec UNKNOWN**. Local MP4 codec validation is an application policy, not a vendor H.264/AAC guarantee.[14]
- `POST /v3/assets`: documented direct limit 32 MB, PNG/JPEG/MP4/WebM/MP3/WAV/PDF; larger direct-upload permission uses returned `max_bytes`. Render-URL limits differ: MP4/WebM video ≤100 MB; JPG/PNG image ≤50 MB; WAV/MP3 audio ≤50 MB; video/image below 2K and unauthenticated reachability. No upload is authorized here.[41][6]
- Usage guide audio max **600 seconds** conflicts with audio-to-video **30 minutes**. Conservative future bound ≤600 seconds, with engine/plan approval; do not claim a tested 30-minute audio path.[6][10]
- `video_url` is the clean output reference, but caption settings can burn captions into it. Media URLs are presigned/expire; GET again for fresh reference. Exact fixed URL TTL and all-output retention **UNKNOWN**; expiry is not erasure.[15][9]

### Rights, privacy, consent and price gates

**HeyGen remains CONDITIONAL, even for stock.** Terms' commercial ownership language explicitly addresses Creator/Pro/Business; standalone PAYG mapping and Tanaghom embedding/customer-access rights need written clarification. Broad irrevocable content training/improvement license and competitive/benchmarking/interface restrictions cannot be dismissed by output ownership. Privacy describes independent training/improvement and opt-out requests, not default zero training. Biometric enterprise exception does not override every broader content right.[27][28][33]

Require an acceptable API/enterprise agreement, DPA/SCC/subprocessor allocation and no-independent-training/improvement coverage for scripts, images, audio, outputs, consent recordings, embeddings and biometrics. Public DPA biometric versus no-special-category wording requires reconciliation; no signed account-specific agreement is established.[29][33]

Local scoped consent is separate from provider training/consent status. Photo creation has no vendor consent-record step; twins clone voice from footage and require separate group consent mechanics. Vendor waivers/null consent do not authorize Tanaghom use. **No twin/photo/prompt enrollment or persistent personal voice creation is accepted in this slice.** Revocation must block queued/new execution locally; provider deletion completion is separate.[19][13][7]

Privacy describes deletion backups for 60 days and requested-deletion targeting within 72 hours subject to exceptions; biometric rules differ by region. Group/look/asset/video DELETE is not proof of clone, consent, training, derivative or backup purge. Full retention/deletion/revocation propagation and receipts remain **REQUIRES ACCEPTANCE**.[28][33][29]

**Pricing conflict is a gate, not a resolved price schedule.** Accepted live Help Center body is labelled **September 16, 2026**, self-serve USD/minute charged by actual generated seconds: IV photo **$2.31**, IV twin/studio **$4.83**, III twin **$0.60**, III studio/photo **$0.99**, V twin **$7.20**; photo/twin creation **$1.32/$2.13 per call**; lip-sync speed/precision **$0.84/$1.74 per minute**. These are public snapshot figures, not an account quote or permission to spend.[31]

Indexed developer prices differ (IV photo $0.05/sec; IV twin/studio and V twin $0.0667/sec; III twin/studio $0.0167/sec; III photo $0.0433/sec; avatar creation $1/call); their live pricing route returned 404. Older June rates and marketing free-trial language are historical/indexed conflict evidence only. Live marketing redirected to a login-gated dashboard; exact account-authoritative prices, minimum top-up, taxes, rounding and engine entitlement are **UNKNOWN**. The fresh help article says no free API credits starting February 2026. Do not budget from a stale snippet or assume free execution.[37][30][31]

PAYG concurrency 10; enterprise 20 included with documented separately pooled burst capacity at 1.5× contract rate. App help's no-credit failed/cancelled claim is not a verified PAYG USD settlement rule. Failed/cancelled/training-failure billing and refunds remain **UNKNOWN / REQUIRES ACCEPTANCE**.[6][23][42]

## 4. Sync Labs: separate approved-video + approved-audio specialist

### Exact API and controlled upload mechanics

Base `https://api.sync.so`, header `x-api-key`; initial **`lipsync-2`** selected explicitly. Normal API permits video/image plus audio/text, but P5 deliberately permits **approved video + approved recorded audio only**. Reject `text`, script, `voiceId`, TTS provider, `dubParams`, `dialogueEdit` and clone/TTS endpoints. Dub parameters invoke an ElevenLabs branch; that is not this capability.[51]

Approved reusable/private asset flow, **documented only; no requests or bytes sent**:

1. Controlled private reader verifies tenant-owned approved asset/version, MIME/magic/container/codec/size/duration/checksum; never accept arbitrary user URLs.
2. Authenticated `POST /v2/assets/upload` with `fileName`, `contentType`, `size` returns signed `uploadUrl` and canonical resource URL.
3. PUT bytes to the signed URL with matching Content-Type; **do not forward the provider API key to signed storage**. `expiresIn` governs; example 3600 is not a guaranteed constant.
4. Authenticated `POST /v2/assets` with returned canonical URL/type registers the asset; use returned asset UUID as `assetId`. Pin IDs/representations in the immutable submission.[60]

Source request shape, **not executed**:

```json
{
  "model": "lipsync-2",
  "input": [
    { "type": "video", "assetId": "APPROVED_VIDEO_ASSET_UUID" },
    { "type": "audio", "assetId": "APPROVED_AUDIO_ASSET_UUID" }
  ],
  "options": { "sync_mode": "cut_off", "output_format": "mp4" },
  "outputFileName": "tanaghom_p5_job_SAFE_ID"
}
```

`outputFileName` excludes extension (MP4 added), ≤255 alphanumeric/underscore/hyphen characters. `options.output_format` enum MP4/MOV and default MP4 is **deprecated**, as are FPS/resolution options; validate result bytes rather than promise durable deprecated behavior. Direct multipart uses the same create endpoint and JSON-string nested fields, but stable assets are preferred for immutable retries.[51][67]

`sync_mode` defaults to bounce. Deliberately selected `cut_off` uses the shorter duration and can truncate speech; require approved duration agreement. Loop/bounce repeat visual motion; silence pads shorter audio to longer input; remap retimes video. Approved audio avoids synthesis, but bit-identical audio/no resampling/exact output audio codec **UNKNOWN**.[66][59]

| Need | Exact route / truth |
|---|---|
| Create | `POST /v2/generate`; new accepted keyed action 201, replay 200 same ID plus `Idempotency-Replayed: true`.[51][55] |
| Status | `GET /v2/generate/{id}` (**singular**); `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `REJECTED`.[52] |
| Estimate only | `POST /v2/generations/estimate`, alias `/v2/generate/estimate-cost`; positive duration/model, explicit intended FPS (default 30). Does not fetch media/create work; estimated USD/frames/credits, not actual charge.[57] |
| Resolve output | `GET /v2/generations/{id}/download` (**plural**); 200 **unquoted text/plain URL**, then separately download without API key. Not JSON, redirect or video bytes.[53] |
| Delete generation | `DELETE /v2/generations/{id}`, terminal only; active 409 `generation_not_deletable_while_processing`.[54] |
| Delete input asset | `DELETE /v2/assets/{id}` with ownership constraints.[69] |
| Cancel | **UNKNOWN / no documented active cancel**; deletion is not cancellation or refund.[54][73] |

### Idempotency, cost and same-task recovery

`Idempotency-Key` is a header: organization-scoped, case-sensitive, one header, 1–128 characters `[A-Za-z0-9._~-]+`. Protection seven days from acceptance, longer while active/unresolved. Exact payload equivalence includes model/options/input order/segments/webhook/output filename/context; URL query refresh or URL→asset representation change conflicts. Persist key + intent before submit.[55]

Conflict/in-progress/outcome-unknown/unavailable/deleted-key responses must never trigger fresh-key/unkeyed create for that local job. Provider-key expiry, terminal failure, 404/deletion, restart, lost webhook, expired output or download failure does not erase the local provider mapping. **One Tanaghom job → at most one paid provider task**; any genuinely new user-authorized attempt is a new local job. Task/ADR requires fail-closed indeterminate create; preserve evidence and reconcile, not blind replay.[55]

Canonical GET truth is authoritative. Webhook guide documents `Sync-Signature` (`t`/`v1`, timestamp + dot + raw body), but payload reference documents `X-Signature-Primary`, differing error fields and no REJECTED event. **Actual deployed callback signing/header/payload/rejection delivery UNVERIFIED**; never disable auth to reconcile the conflict. No automatic failed-delivery retry is documented, so same-ID polling remains necessary.[56][72][52]

**Billing before download is a blocking design constraint:** status does not document actual charged USD/credits/final frame count; `generationEstimate` is a completion-time estimate, not cost. Cost-estimate endpoint is only an estimate. Usage CSV supplies job ID/frames/cost/model/API key/time, but no public settled per-generation cost API was established. Actual-cost source is **UNKNOWN / REQUIRES ACCEPTANCE**.[52][57][48]

Durably record provider ID/status/outcome, immutable intent, estimate as estimate, and genuine charge source or `actual_cost_status: UNKNOWN` (null, never zero). **Task 240 requires actual-cost settlement before download: if no authoritative accepted charge source exists, block local download/ingestion pending reconciliation; UNKNOWN recording does not satisfy that gate.** Local media/download failure must not rewrite remote success or submit replacement work. Failed/poor-quality jobs may be charged; REJECTED/moderated billing, refund timing and cancellation settlement remain **UNKNOWN**.[64][52]

### Formats and conservative limits

| Area | Accepted official support versus application boundary |
|---|---|
| Video input | MP4, MOV/QT, WebM, AVI supported; prefer bounded MP4/H.264, 1080p, constant 24/25/30 FPS, 8-bit SDR BT.709. Recommendation is not a universal mandatory codec constraint.[59] |
| Audio input | Full support WAV, MP3, OGG, FLAC, ALAC, MP4 audio; AAC/M4A/M3A/WMA limited. P5 controlled input allowlist narrows to bounded WAV/MP3; no universal AAC entitlement inferred.[59] |
| Audio properties | 44.1/48 kHz recommended; higher downsampled to 48 kHz; up to 32-bit float/7.1, no spatial audio, first audio stream only.[59] |
| Output video | H.264/libx264 re-encode, CRF 17/preset slow, RGB processing; HDR normalized to SDR, alpha removed, FPS/bitrate/color can differ. Exact output audio codec/channel layout **UNKNOWN**.[59] |
| Visual limits | Above 4096×2160 rejected; arbitrary aspect including portrait. `lipsync-2` nominal 512×512 face region; pro refinement; file resolution is not facial-quality proof.[59][49] |
| Image route | **Initial `lipsync-2` image input denied.** Image+audio is documented **only for `sync-3`** (JPEG/PNG/WebP), with image-specific caveats. Do not infer image support from generic union schema or enable a different model silently.[50][51] |
| File size | Up to 5 GiB per file at application/asset layer, subject to plan and lower transport limits. Prefer tighter local bounds; do not treat maximum as permission to upload.[59][60] |
| Duration | Plan limits 10/30 minutes conflict with error guide 300-second audio ceiling. Future clips must be **strictly under five minutes AND below actual plan limit** pending clarification. Do not split one job into multiple paid generations.[48][63][68] |

### Economics, privacy and commercial acceptance

Published baseline Hobbyist/Creator `lipsync-2` **$0.002/output frame** (displayed $0.05/sec at 25 FPS); Growth $0.0019, Scale $0.0016/frame. Pro/sync-3 have separate higher rates. Displayed sync-3 seconds/frame arithmetic conflicts; use actual organization estimates and accepted unrounded billing contract. FPS changes effective per-second cost. Legacy subscriptions and newer credit-plan families differ; 1 credit represents $0.01 usage but top-up cash rate varies. Account billing regime/watermark/plan/concurrency/entitlement must be identified; automatic top-up must not be enabled.[47][48][63]

Commercial support covers legacy subscription commercial use, but newer credit-plan application and blanket output ownership are **UNKNOWN**. Terms grant broad perpetual irrevocable improvement/promotion content rights; privacy permits training/fine-tuning. Face/voice biometric processing, consent obligations and US/other transfers need legal approval. No public DPA/SCC/subprocessor annex was verified; enterprise ZDR availability is not a signed DPA/no-training commitment. No precise standard biometric/input/output/backup deletion TTL or purge attestation established.[70][61][62]

Download URL signing requests seven days but may expire sooner; older stored URLs need not refresh. URL validity is not retention SLA. Terminal-generation and separate asset deletion do not prove backup/model/derivative erasure. Training carve-out, rights/privacy/DPA/biometrics/retention/deletion, failure billing, actual cost, duration conflict, callback conflict and Arabic/media quality remain **REQUIRES ACCEPTANCE** before real use.[53][54][65]

## 5. Tavus fallback evidence, not a P5 adapter

Async file generation is separate from CVI. `POST https://tavusapi.com/v2/videos` uses `x-api-key`, actual field **`replica_id`** (current Face ID), and `script` or `audio_url`; P5 fallback concept is approved audio only. `GET /v2/videos/{video_id}` provides output/status; lifecycle queued/generating/ready/deleted/error. `/v2/faces` is current identity API; do not rename the video field.[74][75][87]

Provider idempotency, async cancellation and authenticated callback delivery guarantees remain **UNKNOWN**. MP3/WAV quickstart conflicts with WAV-only error wording; output codecs/FPS/resolution and async concurrency are not established. Pricing page has incompatible allowance tables and a 30-second minimum/6-second increment; account quote/failure billing still gated. Preserve these unknowns rather than applying CVI capabilities to async rendering.[102][78][91]

**Custom enrollment outside scope:** current video-to-face automatically creates a voice; image-to-face requires stock/default voice association. Original fallback voice cannot be deleted independently; hard face deletion's voice cascade is **UNKNOWN**. Supplying approved audio later does not undo enrollment voice cloning. No custom face training is accepted.[79][99]

Self-service/enterprise content improvement licenses and business-data/privacy-policy scope, DPA/subprocessor/transfer/no-training/deletion gaps, explicit informed subject consent, revocation and stock endorsement/political restrictions require contractual closure. No fallback production certification or provider call is implied.[92][93][94]

## 6. Synthesia excluded: preserve evidence without completing a missing appendix

**Accepted exclusion is stronger than the underlying report's conditional-alternative wording:** no Synthesia adapter or onboarding. Its Legacy v2 API does document `POST/GET /v2/videos` and uploaded MP3 narration, but that does not establish arbitrary-video lip-sync. October 8, 2026 introduction says **Pro or above**; October 1 Creator→Pro rename explains older Creator help wording. No stale Starter/API eligibility assumption.[103][132][106]

Blocking distinctions:

1. Public Privacy Policy describes facial geometry/voiceprints and potentially Article 9 biometric identification; July 22, 2026 public DPA Schedule 1 says special-category data will not be processed. **Written clarification/bespoke coverage and executed applicable agreement required**; reading the public DPA is not certification.[121][144]
2. Photo avatar requires same-person live consent and **subject's own creation/submission**; Tanaghom/agent permission is not self-enrollment. No agent submitting another person's image even with permission.[116][127]
3. Personal photo/video avatars are not offline API-compatible in the matrix; Express-1/Legacy stock and Custom Studio are compatible. Editor avatar ID access does not override this.[140]
4. July 23 licensing restricts paid stock/synthetic avatars **and voices**; AUP exception wording is not an exception granted to Tanaghom. Custom rights are subject-specific; paid channel/client distribution rights require written clearance.[124][122]
5. Avatar/voice deletion does not retract historical generated videos; retained consent/model/backup data, immediate revocation and conflicting 30/90-day deletion descriptions require separate accepted contracts.[138][143][148]

**Incomplete underlying appendix:** archived `p5-synthesia.md` ends with a Sources heading and unpopulated mechanical placeholder. Its separate `p5-synthesia-ledger.json` maps source IDs to URLs/access dates but contains **no verbatim quotes/evidence attachments**. Both are preserved verbatim, not silently repaired. This consolidation attributes its Synthesia statements to that accepted report plus ledger; it does not claim missing raw captures/quotes were reviewed or that an evidence-mode verification passed. No newly invented excerpt, page capture, empirical result or completed appendix is supplied.

## 7. Common real-use gates and quality evidence

All real execution is forbidden now. Future acceptance must separately address:

- **Rights and consent:** stock actor/avatar/voice license, commercial channel/territory/client distribution, no implied endorsement; real subjects require scoped, revocable authorization before any upload. Local approval is not vendor-policy override. Public-figure/minor/deceased impersonation and political use remain excluded by default; provider policy restrictions apply.[38][94][127]
- **Privacy/legal:** account-specific agreement, lawful biometric processing basis, applicable DPA/Article 9/SCC/subprocessors/locations, no independent training/improvement/human-review terms, input/output/consent/voice/model/backup retention, erasure propagation and evidence. No vendor is assumed zero training from a paid plan.[27][62][93]
- **Budget/reliability:** account-authoritative pricing and entitlement, failed/rejected/cancelled charges/refunds, genuine actual-cost source, immutable request anchor/key, one-task invariant and same-ID reconciliation. Local cancellation intent is not remote cancelled or free work.
- **Quality/media:** download/inspect actual MP4 tracks/codecs/dimensions/duration/audio, permitted dialect and identity fidelity, human approval before any future publication. Nothing generated or evaluated here.

Arabic evidence is bounded: HeyGen lists regional Arabic languages, but exact selected API voice/dialect quality requires catalog binding and human acceptance; Sync explicitly names Arabic lip-sync, not a dialect-level quality metric; Tavus explicit Arabic table is CVI TTS, not async script certification; Synthesia explicit locale/voice catalog is not naturalness/lip-sync evidence. **UNKNOWN:** MSA/colloquial dialect quality, mixed AR/EN, diacritics/numerals/brands and 9:16 quality until separately authorized evaluation.[39][71][83]

Use task 240's EN/AR/mixed/punctuation/numerals/9:16, denial/revocation/cross-tenant, indeterminate/crash/same-task, moderation/429/5xx, malicious download/malformed media, cost/cancel/local-failure fixtures. Stub results prove source contracts/governance, never real provider parity, spend, billing, privacy erasure or Arabic realism.

## 8. Archive and authority

[Research archive index](240-provider-research/README.md) inventories the five accepted scratch inputs and explains limitations. `manifest.json` contains input byte counts/SHA-256 for preservation verification. Reports retain their original provider-specific citation numbers, retrieval/tool limitations, historical wording and explicitly UNKNOWN findings. This consolidation's numeric citations use separate `decision-ledger.json`; never confuse the two numbering systems.

This is consolidation of the accepted **2026-10-11** research snapshot, not fresh procurement/re-certification. No credentials/customer media were present in the reviewed reports; no redactions were needed. Official-source reports are analyst-authored summaries with short source excerpts, **not full raw provider-page captures**. Adjacent scratch evidence directories mentioned inside original reports are not claimed to be archived here. In particular, the incomplete Synthesia appendix remains incomplete.

The current task/ADR supersedes old research lines that recommended holding *all implementation* until gates close: **source-only implementation is now authorized; real provider/privacy/commercial/custom acceptance remains blocked**. Endpoint/schema evidence and conflicts are preserved, not smoothed over. No provider account, webhook, generated video, media upload, spend, enrollment, commit, push, PR or GitHub write was performed by this documentary worker.

## Sources

[1] https://developers.heygen.com/avatar-iii
[2] https://developers.heygen.com/avatar-iv
[3] https://developers.heygen.com/avatar-v
[4] https://developers.heygen.com/reference/create-video
[5] https://developers.heygen.com/reference/get-video
[6] https://developers.heygen.com/docs/usage-limits
[7] https://developers.heygen.com/docs/avatar-consent
[8] https://developers.heygen.com/docs/webhooks
[9] https://developers.heygen.com/docs/webhook-events
[10] https://developers.heygen.com/audio-to-video
[13] https://developers.heygen.com/docs/avatar-from-video
[14] https://developers.heygen.com/transparent-background-videos
[15] https://developers.heygen.com/video-details
[16] https://developers.heygen.com/reference/delete-video
[17] https://developers.heygen.com/reference/stop-video-agent-session
[19] https://developers.heygen.com/docs/avatar-from-photo
[20] https://developers.heygen.com/docs/avatars
[21] https://developers.heygen.com/docs/avatar-looks
[22] https://developers.heygen.com/docs/error-codes
[23] https://developers.heygen.com/docs/burst
[27] https://www.heygen.com/terms
[28] https://www.heygen.com/privacy
[29] https://www.heygen.com/data-processing-addendum
[30] https://www.heygen.com/api-pricing
[31] https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained
[33] https://www.heygen.com/biometric-privacy-notice
[35] https://developers.heygen.com/models
[36] https://developers.heygen.com/generate-avatar-video
[37] https://developers.heygen.com/docs/pricing
[38] https://www.heygen.com/moderation-policy
[39] https://help.heygen.com/en/articles/11391932-voice-languages-we-support
[40] https://developers.heygen.com/docs/api-key
[41] https://developers.heygen.com/docs/upload-assets
[42] https://help.heygen.com/en/articles/9655503-video-priority-processing-times
[47] https://sync.so/pricing
[48] https://sync.so/docs/product/billing
[49] https://sync.so/docs/models/lipsync
[50] https://sync.so/docs/models/sync-3
[51] https://sync.so/docs/api-reference/api/generate-api/create
[52] https://sync.so/docs/api-reference/api/generate-api/get
[53] https://sync.so/docs/api-reference/api/generate-api/download
[54] https://sync.so/docs/api-reference/api/generate-api/delete
[55] https://sync.so/docs/api-reference/guides/idempotency
[56] https://sync.so/docs/api-reference/guides/webhooks
[57] https://sync.so/docs/api-reference/api/generate-api/estimate-cost
[59] https://sync.so/docs/compatibility-and-tips/media-formats-support
[60] https://sync.so/docs/developer-guides/asset-uploads
[61] https://sync.so/terms
[62] https://sync.so/privacy
[63] https://sync.so/docs/product/billing/v3
[64] https://support.sync.so/articles/2267102106-how-do-i-get-a-refund-for-failed-or-poor-quality-video-generations
[65] https://support.sync.so/articles/3861799718-what-are-your-data-retention-policies-and-can-we-opt-out-of-data-collection
[66] https://sync.so/docs/developer-guides/sync-mode
[67] https://sync.so/docs/api-reference/api/generate-api/create-with-files
[68] https://sync.so/docs/developer-guides/error-handling
[69] https://sync.so/docs/api-reference/api/assets-api/delete
[70] https://support.sync.so/articles/2618163041-commercial-usage-rights-across-sync-so-subscription-plans
[71] https://support.sync.so/articles/4079312867-what-languages-does-sync-support-for-lip-syncing
[72] https://sync.so/docs/api-reference/api/webhooks-payload-reference/webhooks/generation-status-update
[73] https://sync.so/docs/api-reference/llms.txt
[74] https://docs.tavus.io/api-reference/video-request/create-video
[75] https://docs.tavus.io/api-reference/video-request/get-video
[78] https://docs.tavus.io/sections/webhooks-and-callbacks
[79] https://docs.tavus.io/api-reference/faces/create-face
[83] https://docs.tavus.io/sections/conversational-video-interface/language-support
[87] https://docs.tavus.io/api-reference/faces/list-faces
[91] https://docs.tavus.io/sections/errors-and-status-details
[92] https://www.tavus.io/terms-of-service
[93] https://www.tavus.io/enterprise-terms-of-service
[94] https://www.tavus.io/acceptable-use-policy
[99] https://docs.tavus.io/api-reference/voices/delete-voice
[100] https://docs.tavus.io/sections/video/overview
[102] https://docs.tavus.io/llms.txt
[103] https://docs.synthesia.io/reference/create-video
[106] https://docs.synthesia.io/reference/video-api-introduction
[116] https://docs.synthesia.io/docs/personal-avatars
[121] https://www.synthesia.io/legal/privacy-policy
[122] https://www.synthesia.io/legal/acceptable-use-policy
[124] https://help.synthesia.io/en/articles/6341928-synthesia-video-licensing
[127] https://help.synthesia.io/en/articles/13846500-photo-avatars-content-moderation
[132] https://docs.synthesia.io/reference/upload-script-audio
[138] https://docs.synthesia.io/docs/synthesia-avatars
[140] https://help.synthesia.io/en/articles/15197011-which-avatar-type-is-right-for-me
[143] https://help.synthesia.io/en/articles/15453102-avatar-policy-foundation
[144] https://cdn.prod.website-files.com/65e89895c5a4b8d764c0d710/6a60d5cc5118f1e8bd486899_2026.07.22_Synthesia_DPA.docx.pdf
[148] https://www.synthesia.io/legal/security-practices
