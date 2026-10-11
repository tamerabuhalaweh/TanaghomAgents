# Tanaghom P5 — Sync Labs lip-sync specialist decision

**Research date: 2026-10-11. Scope: official Sync Labs documentation, knowledge base, pricing, Terms and Privacy only. Research only; no authenticated vendor/API calls, media submission, generation, TTS, voice cloning, repo edits, issues or PRs.**

## Executive decision

**Technical capability: YES, documented existing video + existing recorded audio → lip-synced MP4 without a synthesized voice. Production/legal approval: CONDITIONAL / NOT YET ESTABLISHED.** The normal generation schema accepts one video and one audio; audio is described as recorded/captured. Text input and `dubParams` are separate synthesis/dubbing branches and must be forbidden for this P5 route.[6]

**Suggested P5 boundary (our recommendation, not a provider guarantee):** an optional specialist adapter for an already approved video and already approved audio, with an explicit model choice, per-job budget and consent gate. Do not turn this into permanent TTS or authorize real-person face/voice execution from this research. Prefer `lipsync-2` for cost-sensitive talking footage; explicitly select `lipsync-2-pro` for premium facial detail, or `sync-3` where obstructions/angles or native 4K justify its higher price. Image animation is outside the existing-video P5 route even though `sync-3` supports it.[3][4]

The most important blockers are: no documented status **actual-cost** field and failed jobs that may be charged, with moderated/rejected billing still **UNKNOWN**.[7][22] Broad content-use/training legal permissions and no precise standard face/biometric retention or verified public DPA require closure, not optimistic defaults.[17][18] Conflicting duration/webhook details are set out below.

**One Tanaghom job → at most one paid provider task:** persist one immutable submission intent and one idempotency key before submit; after a generation ID exists, query only that ID. Never launch a replacement for that same job because polling/download fails. Provider truth and cost status must be durably recorded before downloading the result. Details below are application requirements, not a claim that the provider supplies every needed field.[7][10]

## Research provenance and limitations

- Retrieved live primary pages and their official `.md` equivalents; evidence extracts are saved in adjacent `p5-sync-evidence/`, with a source ledger in `p5-sync-ledger.json`. Source URLs and short verified verbatim excerpts appear at the end.
- **Requested `web.run` could not be invoked in this subagent runtime: it was not an exposed callable tool.** The available Hermes search wrapper reported that its configured OpenAI native backend could not execute client-side; its fallback returned empty results. The extraction wrapper also reported a search-only backend. Therefore this is direct read-only HTTPS retrieval of official pages and official sitemaps, **not a claimed `web.run` search**. The parent should repeat critical checks with `web.run` if that tool is available there.
- This is a live-page snapshot for the specified date, not an archived historical reconstruction or a tested provider transaction. No API credentials or private account plan were examined.
- Legal pages show Terms revision **June 6, 2024** and Privacy effective date **May 27, 2024**, despite being retrieved for this research date. Do not assume the legal text was revised in 2026.[17][18]
- The official API index advertises an OpenAPI JSON URL, but direct retrieval returned **HTTP 404**. Human-readable endpoint/type documentation was accessible; a machine-readable OpenAPI specification was not verified.[33]

## 1. Models and published current pricing

### Exact legacy subscription + usage price display

The public pricing page gives these rates; **USD, per output frame**, with separately displayed per-second equivalents at **25 FPS**. Hobbyist and Creator share the baseline column. Subscription is extra; do not confuse usage rates with monthly fees.[1][2]

| Model ID | Hobbyist/Creator $/frame | Growth $/frame | Scale $/frame | H/C displayed $/sec @25 FPS | Growth displayed $/sec | Scale displayed $/sec |
|---|---:|---:|---:|---:|---:|---:|
| `lipsync-2` | 0.002 | 0.0019 | 0.0016 | 0.05 | 0.0475 | 0.04 |
| `lipsync-2-pro` | 0.00333 | 0.00317 | 0.00267 | 0.08325 | 0.07925 | 0.06675 |
| `sync-3` | 0.00534 | 0.00507 | 0.00427 | 0.13340 | 0.12660 | 0.10660 |

Source for every displayed price above: official pricing page.[1]

**Precision discrepancy:** multiplying the displayed `sync-3` frame prices by 25 gives **0.13350 / 0.12675 / 0.10675**, not the displayed seconds prices. These are tool-calculated comparisons, not corrected vendor prices. The model guides give rounded ranges (`lipsync-2` $0.04–0.05/sec; pro $0.067–0.083/sec; `sync-3` $0.107–0.133/sec). **Exact unrounded billable rate is UNKNOWN from the public display.** Store the provider estimate for the actual organization, duration and FPS; do not fabricate a universal final price.[1][3]

Billing counts output frames. `cut_off` bills the processed shorter duration, not discarded portions. A 25-FPS marketing rate is not a universal per-second price at other frame rates. The estimate endpoint defaults to **30 FPS**, so supply the intended FPS explicitly.[2][12]

### Credit billing also exists — not every account is on the public legacy plans

Organizations enrolled in credit billing have a different plan family. Availability depends on the organization; the documentation directs the customer to Studio billing to determine the actual system. **1 credit represents $0.01 of generation usage**, but purchased top-up credits cost more than $0.01 on some tiers. Approximate consumption at 25 FPS is 5 credits/sec (`lipsync-2`), 8.3 (pro), and 13.3 (`sync-3`). These are not proof of the effective cash cost of a particular subscription/top-up mixture.[21]

| Credit plan | Monthly USD | Monthly credits | Concurrency | Max video | Max input file | Top-up USD/credit |
|---|---:|---:|---:|---|---|---:|
| Hobby | 5 | 300 | 1 | 1 minute | 500 MiB | 0.013 |
| Starter | 12 | 700 | 5 | 2 minutes | 2.5 GiB | 0.012 |
| Pro | 29 | 2,000 | 10 | 5 minutes | 2.5 GiB | 0.011 |
| Team | 99 | 8,000 | 20 | 10 minutes | 5 GiB | 0.010 |

Credit-plan table and top-up prices: official Credit Billing guide. Hobby is watermarked; Starter+ is watermark-free when clean output is available. Automatic top-up is a separate paid capability; **P5 must not enable it** as a side effect.[21]

### Legacy plan limits

| Legacy plan | Monthly USD | Concurrent pending/processing jobs | Max generation |
|---|---:|---:|---|
| Free | 0 | 1 | 20 seconds; `sync-3` special 15-second allowance |
| Hobbyist | 5 | 1 | 1 minute |
| Creator | 19 | 3 | 5 minutes |
| Growth | 49 | 6 | 10 minutes |
| Scale | 249 | 15 | 30 minutes |
| Enterprise | Custom | Custom | Contract-specific; UNKNOWN without agreement |

Legacy limits come from Billing and Concurrency docs. Growth discounts usage 5%, Scale 20%; Creator+ removes watermarks. Free allows 3 generations/month, at most one `sync-3` generation (15 seconds). This is not an authorization to consume the user's allowance.[2][13]

## 2. Exact request shape: existing approved video + audio, no voice synthesis

**Documented endpoint:** `POST https://api.sync.so/v2/generate`; `Content-Type: application/json`; required `x-api-key` header. Allowed model enum: `sync-3`, `lipsync-2`, `lipsync-1.9.0-beta`, `lipsync-2-pro`, `react-1`. P5 should allowlist only the requested three specialist models, not silently fall back to a legacy or expressive model.[6]

**Illustrative request only — never sent:**

```http
POST /v2/generate
Host: api.sync.so
Content-Type: application/json
x-api-key: <secret-managed-api-key>
Idempotency-Key: <persisted-one-job-key>
```

```json
{
  "model": "lipsync-2",
  "input": [
    { "type": "video", "assetId": "<approved-video-asset-uuid>" },
    { "type": "audio", "assetId": "<approved-audio-asset-uuid>" }
  ],
  "options": {
    "sync_mode": "cut_off",
    "output_format": "mp4"
  },
  "outputFileName": "tanaghom_p5_job_<safe-id>",
  "webhookUrl": "https://<owned-verified-endpoint>/sync/generation"
}
```

Schema source: Create Generation.[6]

- Use real returned asset UUIDs, not the literal placeholders. Each media input can instead use `url`; choose a single representation per input and keep it unchanged on retries. Normal non-segment lipsync requires exactly one visual input and one audio/text input; our permitted route narrows that to **video + audio only**.[6]
- `outputFileName` is the base name without extension; `.mp4` is added automatically. Allowed filename characters are alphanumerics, `_`, `-`, up to 255 characters. The example is an application-specific name, not a supplied provider artifact.[6]
- `options.output_format` is documented **deprecated**, with enum `mp4`/`mov` and default `mp4`. `fps` and `output_resolution` options are also deprecated. Explicit `mp4` expresses intent but does not replace downloaded-file validation; no durable future guarantee for a deprecated option was established.[6]
- Never include `type: "text"`, a TTS `provider`, `voiceId`, `script`, `dubParams`, or `dialogueEdit`; never call TTS or voice-clone endpoints. `dubParams` extracts and dubs audio using ElevenLabs; that is **not** this route.[6]
- `sync_mode` defaults to `bounce`. Set it deliberately: `cut_off` produces the shorter duration; `loop` repeats video to audio length; `bounce` reverses/repeats video; `silence` preserves the longer duration and pads shorter audio; `remap` retimes video to audio length. With `cut_off`, important speech can be truncated, so require duration agreement/approval rather than silently discarding audio.[25]
- Uploaded assets are recommended for reusable/private media. Upload flow: authenticated `POST /v2/assets/upload` with `fileName`, `contentType`, `size`; PUT bytes to returned signed `uploadUrl`; authenticated `POST /v2/assets` with returned canonical URL/type; then use returned asset ID. No part of that flow was executed here.[15]

**No synthesized voice is necessary:** the approved captured audio is the audio input. However, **bit-identical audio preservation / no resampling / a specific output audio codec is UNKNOWN**; duration modes and transcoding can change the media. Do not promise a lossless audio roundtrip.[6][14][25]

## 3. Lifecycle endpoints and callback contract

| Need | Documented contract | Caveats |
|---|---|---|
| Create | `POST /v2/generate` | First accepted keyed action: 201. Equivalent replay: 200 + same ID + `Idempotency-Replayed: true`.[6][10] |
| Status | `GET /v2/generate/{id}` | Singular `generate`; `x-api-key`; PENDING, PROCESSING, COMPLETED, FAILED, REJECTED.[7] |
| Long-poll | Same status route with `wait=true&timeout=5` | Timeout range 1–10 seconds; HTTP 200 can still be non-terminal. Cannot combine `wait=true` with `include=progress`.[7] |
| Progress | Same route with `include=progress` | Adds live `progress_percent`; not an actual-cost field.[7] |
| Estimate | `POST /v2/generations/estimate` | Alias `POST /v2/generate/estimate-cost`; body `model`, positive `duration`, optional positive `fps`, optional `reasoningEnabled`.[12] |
| Download URL | `GET /v2/generations/{id}/download` | Plural `generations`; 200 returns **unquoted `text/plain` URL**, not JSON/video/redirect. Fetch it separately without API key.[8] |
| Delete generation | `DELETE /v2/generations/{id}` | Terminal jobs only; active deletion returns 409 `generation_not_deletable_while_processing`.[9] |
| Delete uploaded asset | `DELETE /v2/assets/{id}` | API-key deletion requires key-owner ownership; organization-shared asset deletion needs admin/owner session.[28] |
| Cancel active generation | **UNKNOWN / no documented cancel endpoint located** | Delete is not cancel; do not claim it stops rendering or charges. Public API index contains delete but no generation cancel operation.[9][33] |

### Webhooks: useful, but not sufficient on their own

`webhookUrl` is a create-body field. The webhook guide describes HTTPS POST, terminal completion/failure delivery, HMAC-SHA256 `Sync-Signature` containing `t=...` and `v1=...`, signing timestamp + `.` + raw JSON bytes, and organization signing secret from `GET /v2/organizations/webhook/secret`. Respond quickly with 2xx. **No automatic retry for failed webhook delivery** is documented; polling is the fallback.[11]

**Official documentation conflict:** webhook payload reference calls the header `X-Signature-Primary`, limits status enum to `COMPLETED`/`FAILED`, and uses `error_code`. Create/status use `errorCode`, and status supports `REJECTED`. The webhook guide uses `Sync-Signature`. Treat the actual deployed signature/header/payload and REJECTED delivery as **UNVERIFIED** until a safe contract check is approved; never disable authentication to accommodate the inconsistency. Canonical GET status must determine provider truth.[6][7][31]

**P5 application recommendation:** verify callback raw bytes/signature and freshness, associate the existing provider ID, deduplicate callback handling, then GET that same task. A callback must never create a second provider task. Missing webhook delivery or lookup failure means reconcile, not resubmit.

## 4. Idempotency: documented, but Tanaghom needs a stricter lifetime invariant

The optional **header**, not body field, is `Idempotency-Key`. Case-sensitive, organization-scoped across API keys/members, exactly one header, 1–128 characters matching `[A-Za-z0-9._~-]+`. Persist it with the immutable payload **before the first request**. Direct retrieval of the supplied `create.mdx` documentation returned HTTP 200 and identical content to the canonical `.md` create reference; older claims of no idempotency are inaccurate.[6][10]

| Response | Meaning | P5 action recommendation |
|---|---|---|
| 201 | New action accepted | Persist generation ID, request/response, model/input/options and acceptance time. |
| 200 + replay header | Original action's current state | Bind/query original ID; not a new generation. |
| 400 `INVALID_IDEMPOTENCY_KEY` | Malformed/duplicate key header | Validate first; no guessed repair of an existing identifier. |
| 409 `IDEMPOTENCY_KEY_CONFLICT` | Changed inputs/context | Restore original request; no fresh key for same job. |
| 409 `IDEMPOTENCY_IN_PROGRESS` | Original action preparing | Honor `Retry-After: 2`; same key/payload only. |
| 503 `IDEMPOTENCY_OUTCOME_UNKNOWN` | Acceptance uncertain | Preserve key; poll supplied `generationId`; otherwise controlled same-key recovery only. |
| 503 `IDEMPOTENCY_UNAVAILABLE` | Keyed submissions not enabled | Keep key; do not bypass with unkeyed create. |
| 410 `IDEMPOTENCY_GENERATION_DELETED` | Original task deleted | Do not recreate under the same Tanaghom job. |

Provider responses and error names: Idempotent Requests guide.[10]

Keys protect **seven days from acceptance**, longer while active/unresolved. Expired resolved keys may be reused. Payload equivalence includes model/options, input and segment order, webhook URL, output filename and effective context. Signed URLs compare literally including query strings: refreshing one changes the payload. Switching URL/file/asset representation conflicts even for identical media.[10]

The provider says a failed accepted generation can intentionally be replaced with a new key. **Tanaghom must not implement that as an automatic retry for the same job**: that would violate at-most-one paid task. A genuinely new separately approved user action needs a new Tanaghom job. After provider-key expiry, the local mapping remains authoritative and must still suppress create. Even deletion, 404, a failed render, expired output, restart, webhook loss, or download failure must not erase that mapping.

## 5. Media support, quality and limits

| Area | Verified official documentation | UNKNOWN / caveat |
|---|---|---|
| Video containers | MP4, MOV/QT, WebM, AVI.[14] | Not every codec/container combination was experimentally validated. |
| Full audio support | WAV, MP3, OGG, FLAC, ALAC, MP4 audio.[14] | AAC, M4A, M3A, WMA have only limited support due to licensing/legal restrictions.[14] |
| Preferred inputs | MP4 video; WAV or MP3 audio; H.264, 1080p, constant 24/25/30 FPS, 8-bit SDR BT.709 recommended.[14] | Recommended properties are not necessarily hard constraints. |
| Video resolution | Above 4096×2160 rejected; arbitrary aspect ratios supported, including portrait.[14] | The model guide calls `sync-3` native 4K; general format guide describes 512×512 face extraction. Do not apply that older/general statement as a verified `sync-3` face-resolution ceiling.[3][4][14] |
| Model face detail | `lipsync-2`: 512×512; pro: same nominal face size with diffusion detail refinement; `sync-3`: native 4K claims.[3][4] | Output file resolution alone does not prove rendered face fidelity. |
| Image inputs | `sync-3` only; JPEG, PNG, WebP; image+audio supported. Manual multi-face selection can use native pixel coordinates and frame 0; image auto-detect unsupported; sync mode ignored.[4] | Image-specific maximum dimensions/file policy beyond generic plan limits is UNKNOWN. P5 existing-video route excludes image inputs. |
| Audio properties | 44.1/48 kHz recommended; higher sample rates downsample to 48 kHz; up to 32-bit float and 7.1 channels; no spatial audio; first audio stream only.[14] | Original multiple streams or bit-identical audio are not preserved guarantees. |
| Output | H.264/libx264 re-encode, CRF 17/preset slow; RGB processing; HDR normalized to SDR; alpha removed; bitrate/FPS/color can differ.[14] | Exact output audio codec/channel layout and lossless-source fidelity are UNKNOWN. |
| File size | Asset and direct multipart application limit 5 GiB **per file**, subject to plan and lower transport/proxy limits. URLs avoid multipart parser cap but not plan/media requirements.[14][15] | Legacy plan-specific input size table was not located; credit sizes are listed above.[21] |
| Direct multipart | Same `POST /v2/generate`, form `model`, `video`, `audio` (or supported image field). Nested `input`, `options`, `segments`, `dubParams`, `dialogueEdit` require JSON-string form fields.[26] | Prefer stable uploaded assets for retry safety; no direct multipart tests were run. |
| Fetchable URL | Must return media bytes without additional authentication headers; a browser sharing/preview HTML page is not a media URL.[14][15] | Do not expose long-lived private media unnecessarily; signed URLs are sensitive. |

### Duration conflict requiring an explicit conservative gate

Plan tables advertise up to 10/30 minutes on Growth/Scale, but Error Handling explicitly documents `generation_audio_length_exceeded` as an audio limit of **300 seconds (5 minutes)** and suggests trimming/splitting below that duration. **Whether that global-sounding audio limit is stale, plan-specific, model-specific or actually enforced is UNKNOWN.** Do not advertise a verified 30-minute existing-audio path. Use an approved clip strictly under five minutes and under the actual plan limit pending clarification. Splitting one Tanaghom job into multiple paid generations is **not allowed** under the one-task invariant.[2][21][27]

## 6. Arabic: explicit evidence, not only inference

**Arabic is explicitly named** in the official knowledge-base language article alongside Bengali, Nepali, Korean and Japanese. The same article says models are language-agnostic and support virtually any spoken language. Thus Arabic lip-sync capability has explicit official evidence; it is not merely inferred from a general language-independent architecture.[30]

The `sync-3` model page says **95+ languages**, without an exhaustive model-specific list. **Arabic dialect-level quality, accuracy targets and an Arabic-specific sync-3 evaluation are UNKNOWN**. Ordinary recorded audio inputs do not require a language field in the create schema. TTS/translation-provider language lists are irrelevant when providing existing Arabic audio and must not be confused with lipsync support.[4][6][30]

## 7. Billing truth before download

### What is and is not exposed

The create/status response documents ID, status, model/input/options, `outputDuration`, output URLs, error/errorCode and optional generation estimate. It **does not document charged USD, charged credits, final frame count or billing settlement**. `generationEstimate` is a completion-time estimate, populated for Sync's own apps and absent for API-created generations; it is not the cost estimate.[6][7]

The estimate endpoint returns `estimatedFrameCount`, `estimatedGenerationCost` in USD, and `estimatedCredits` (null for dollar-billed organizations). It uses supplied duration/FPS, fetches no media, creates no generation, and is **not actual charged cost**.[12]

Billing documents a usage CSV with **Job ID, Frames, Cost (USD, four decimals), Model, API Key, Processed At UTC**. A public per-generation settled-cost API was **not located** in the reviewed API index. Without such a contract, automated authoritative actual-cost capture remains **UNKNOWN**; the CSV/manual billing reconciliation is a documented fallback, not a tested integration.[2][33]

### Failed, rejected and moderated work

- Official support says a failed/poor-quality generation **may be charged** and advises a refund/credit request with job ID, issue and charged amount. No blanket automatic failed-job-free policy can be asserted.[22]
- **Moderated/REJECTED job charge policy, automatic refund timing, credit reservation/release semantics, and actual-cost availability for every failed/rejected job: UNKNOWN.** A state enum or failure response does not establish a zero charge.[7][21][22]
- Submission validation failures can occur before rendering, but ambiguous submissions may already have a generation; follow keyed recovery rather than infer acceptance or cost from HTTP failure alone.[10][27]

### Required Tanaghom adapter ledger (design recommendation)

Before downloading any completed result, durably record:

1. Tanaghom job ID; persisted idempotency key and immutable intent; consent/asset approval references; chosen model; budget; billing system/plan if known.
2. Original provider generation ID and authenticated canonical status response; terminal status; output duration/reference; errors; timestamps. Preserve FAILED/REJECTED evidence too.
3. Provider estimate as **estimate**, with duration/FPS, currency/credits and source timestamp.
4. Actual provider charge with authoritative source if obtainable. If unavailable, persist **`actual_cost_status: UNKNOWN`**, not 0, and retain the reconciliation reference. If policy requires settled actual cost before download, block download until that requirement is satisfied; do not downgrade it to an estimate silently.
5. Only then resolve/download the **same ID's** output. Download failure must not create new work. Validate MP4/H.264, actual dimensions/duration/audio and identity/consent scope before publishing.

## 8. Retention, output lifetime and deletion

**Download access:** completed organization-scoped output can be resolved via the download endpoint without a Studio project/session. Plan/billing-version entitlement selects watermarked versus clean existing output; upgrading does not necessarily remove a burned-in historical watermark. Resolving download does not rerender, incur a generation charge or restore deleted files.[8]

Signed S3 download URLs request **seven-day validity**, but credential expiry/revocation/access changes/deletion can invalidate them sooner. Re-resolve the same task while the object exists. Older URL-only records return their stored URL unchanged with no availability check or expiry extension. **Seven days is URL signing intent, not the output's retention SLA.** Standard output object lifetime, archival guarantee and expiry of status `outputUrl` are **UNKNOWN**.[8]

Upload signed URLs last the response's `expiresIn` seconds; the guide example is 3600, not an immutable guaranteed default. `Content-Type` must match and the API key must not be forwarded to the signed storage PUT.[15]

Standard personal-data retention is purpose/legal-obligation based, with no precise public face-template/biometric/input/output TTL found. Enterprise ZDR is available, set up by Sync under an enterprise agreement, **not a self-serve toggle**. ZDR scope/timing, backups, support/log data and enforceable no-training treatment require the actual contract; the public availability statement is not that contract.[18][24]

`DELETE /v2/generations/{id}` removes a terminal generation according to the endpoint, while uploaded assets have a separate delete operation and ownership constraints. **Physical storage purge timing, backup deletion, model-unlearning and deletion of every copied derivative are UNKNOWN.** Do not equate API deletion with a complete GDPR/privacy erasure attestation.[9][28]

Privacy permits account deactivation/deletion by contacting Sync, but deactivation may not fully erase personal data; a separate personal-data deletion request is needed and may be limited by legal obligations. No public deletion SLA or universal irrevocable completion guarantee was verified.[18]

## 9. Commercial rights, ownership, training, biometrics, consent and DPA

| Topic | Primary evidence / consequence |
|---|---|
| Commercial use | Official support says all subscription plans include full commercial usage rights, including advertising, client sale/licensing and commercial products/services. It names legacy Hobbyist/Creator/Growth/Scale. This supports commercial use; explicit application of that article to the newer credit-plan names is **UNKNOWN**.[29] |
| Output ownership | Terms require ownership/rights in uploaded User Content; a clear blanket assignment of all generated-output rights to the customer was **not located**. **Output ownership/copyright exclusivity is UNKNOWN**, distinct from commercial-use permission.[17][29] |
| Content license | Terms grant Sync a worldwide royalty-free, transferable/sublicensable, perpetual irrevocable content-use license for operation, improvement and promotion/marketing. This is materially broader than processing solely to deliver one result.[17] |
| Training | Privacy expressly allows developing, training and fine-tuning supporting AI models using personal information. **Do not represent ordinary paid accounts as no-training.** A default opt-out or paid-plan automatic no-training promise was not verified.[18][24] |
| Face/voice biometrics | Terms acknowledge face/voice analysis can generate biometric information under applicable laws and describe acting on user instructions, with purpose-based retention language. No precise face embedding/template retention TTL or biometric-specific public deletion procedure was verified.[17] |
| Consent | Terms require required notices/consents and privacy/publicity rights for uploading/storing/transmitting/processing User Content. The person approving a Tanaghom job must have appropriate rights; having a video file is not evidence of depicted-person consent.[17] |
| DPA | **UNKNOWN:** no public DPA text, signed DPA, SCC schedule, subprocessor annex or controller/processor allocation was verified in legal pages/sitemaps/docs. Enterprise ZDR availability does not itself establish a DPA.[18][24] |
| Regional processing | Privacy says personal information is provided in the US and may transfer to the US/other jurisdictions with safeguards where required. EU-only hosting/data residency or a particular contractual transfer instrument is **UNKNOWN**.[18] |
| Client delivery | Commercial support is permissive, but Terms' API/Data restrictions include competing uses and standalone third-party Data distribution. The exact boundary for a lip-sync SaaS/client-delivery workflow warrants legal review; do not infer support copy overrides contractual definitions.[17][29] |

**Approval gates (our recommendation):** obtain depicted-person/image rights and audio rights/required consents, purpose and disclosure approval, cost approval, and an acceptable contract/DPA covering training, retention, biometrics, deletion and subprocessors. If confidential/client media cannot be licensed for improvement/promotion/training, the public self-service terms are not a safe assumed fit. No real-person generation is approved or executed by this research.

## 10. Decision checklist / remaining UNKNOWNs

**Documented capability confirmed:** the three requested model IDs, existing video+audio request shape without TTS and MP4 default.[6] Arabic is explicitly named in official language support.[30] The report documents lifecycle routes, generation idempotency, both plan families and usage/credit rates.[10][21] Failed jobs can be charged.[22]

**Before implementation or any paid test, close these items:**

- Identify the actual organization's billing system, selected model, unrounded price/FPS behavior, concurrency/duration/file entitlements and watermark eligibility.
- Verify an authoritative actual-cost retrieval/reconciliation path; settle UNKNOWN versus blocking policy before download.
- Clarify 300-second audio error documentation versus longer plan durations.
- Verify deployed webhook signature header and REJECTED event contract; retain authenticated same-ID polling regardless.
- Confirm active-task cancellation, if required; do not misuse DELETE as cancellation.
- Resolve no-training/content license, commercial ownership/client delivery, DPA/SCCs/subprocessors and consent requirements.
- Obtain explicit face/biometric/input/output/backup retention and deletion commitments; seven-day URLs do not answer those questions.
- Verify Arabic dialect quality and MP4/audio output characteristics in a separately authorized safe test. Do not allocate that test automatically here.

**Bottom line:** suitable as a **research-qualified, narrowly scoped lip-sync candidate**, not an unconditional production-approved provider. The safest documented function is one approved existing video + one approved existing audio → MP4, with synthesis branches disabled, local at-most-one-task enforcement, same-ID reconciliation, and truthful cost/retention/legal UNKNOWNs.

## Sources

[1] https://sync.so/pricing
    > "Price / sec (25 FPS)"
[2] https://sync.so/docs/product/billing
    > "Usage is calculated per output frame"
[3] https://sync.so/docs/models/lipsync
    > "lipsync-2-pro delivers diffusion-based super resolution for fine facial detail."
[4] https://sync.so/docs/models/sync-3
    > "**Supported image formats:** JPEG, PNG, WebP"
[6] https://sync.so/docs/api-reference/api/generate-api/create
    > "Normal lipsync requests must include exactly one visual input (video or image) and one audio or text input."
[7] https://sync.so/docs/api-reference/api/generate-api/get
    > "The status of the generation."
[8] https://sync.so/docs/api-reference/api/generate-api/download
    > "The successful response is an **unquoted URL in a text/plain body**"
[9] https://sync.so/docs/api-reference/api/generate-api/delete
    > "Only generations in a terminal state can be deleted"
[10] https://sync.so/docs/api-reference/guides/idempotency
    > "Keys remain protected for seven days from initial acceptance"
[11] https://sync.so/docs/api-reference/guides/webhooks
    > "There is no automatic retry for failed webhook deliveries."
[12] https://sync.so/docs/api-reference/api/generate-api/estimate-cost
    > "No media is fetched and no generation is created."
[13] https://sync.so/docs/api-reference/guides/rate-limits
    > "Generation creation also enforces the plan's concurrency limit described below."
[14] https://sync.so/docs/compatibility-and-tips/media-formats-support
    > "All output is re-encoded to H.264 using libx264"
[15] https://sync.so/docs/developer-guides/asset-uploads
    > "The application allows a single asset upload up to 5 GiB"
[17] https://sync.so/terms
    > "such tools may generate biometric information as defined by applicable laws."
[18] https://sync.so/privacy
    > "developing, training, and fine-tuning the AI models we use to support the Services"
[21] https://sync.so/docs/product/billing/v3
    > "**1 credit covers \$0.01 of generation usage.**"
[22] https://support.sync.so/articles/2267102106-how-do-i-get-a-refund-for-failed-or-poor-quality-video-generations
    > "you may be charged for the generation even though the output doesn't meet your needs."
[24] https://support.sync.so/articles/3861799718-what-are-your-data-retention-policies-and-can-we-opt-out-of-data-collection
    > "Zero data retention options are currently available only for enterprise customers"
[25] https://sync.so/docs/developer-guides/sync-mode
    > "`cut_off` uses the shorter input length."
[26] https://sync.so/docs/api-reference/api/generate-api/create-with-files
    > "must be sent as JSON strings in multipart requests."
[27] https://sync.so/docs/developer-guides/error-handling
    > "longer than the maximum permitted duration of 300 seconds (5 minutes)."
[28] https://sync.so/docs/api-reference/api/assets-api/delete
    > "organization-shared assets can only be deleted from an admin/owner session."
[29] https://support.sync.so/articles/2618163041-commercial-usage-rights-across-sync-so-subscription-plans
    > "All Sync.so subscription plans include full commercial usage rights for the content you generate."
[30] https://support.sync.so/articles/4079312867-what-languages-does-sync-support-for-lip-syncing
    > "Less common languages (Bengali, Nepali, Arabic, Korean, Japanese, etc.)"
[31] https://sync.so/docs/api-reference/api/webhooks-payload-reference/webhooks/generation-status-update
    > "`X-Signature-Primary` (string, required) — An HMAC signature of the payload"
[33] https://sync.so/docs/api-reference/llms.txt
    > "The raw OpenAPI 3.1 specification for this API is available at:"
