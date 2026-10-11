# Tanaghom P5 — Tavus official-source decision report

**Research / decision date: 2026-10-11.** Official public documentation and legal pages retrieved with `web.run`; no authenticated access, provider API requests, implementation, repository edits, issues, or PRs. Prices are a retrieval-date snapshot, not a quote. This is a conditional provider assessment, **not legal, privacy, security, or commercial-production certification**.

## 1. Decision and scope

**Conditional shortlist for asynchronous, approved-audio avatar rendering; production approval remains blocked.** Tavus documents a file-output Video Generation product separate from real-time CVI, supporting stock/custom faces and externally supplied audio.[27] The latest face-creation contract, however, introduces voice dependencies that must be resolved before custom training can fit the stated no-permanent-voice boundary.[6]

Tanaghom constraints supplied for this assessment: canonical provider-neutral avatars; separate consent records; approved audio; no permanent TTS/voice feature; no real-time or publishing; commercial legality/privacy unapproved. Proposed decisions below are assessment judgments, not Tavus promises.

- Preserve a Tanaghom-owned avatar identity and a replaceable provider binding; do not treat a Tavus model as the canonical avatar.
- Consider stock-face + approved-audio rendering first, only after contractual/privacy approval. Do not authorize an API experiment through this report.
- Keep custom training blocked until incidental voice creation, processing rights, verification, and revocation/erasure are agreed in writing.
- Treat output ingestion as private review, not publishing. Do not use provider shareability as authorization to distribute.

## 2. Exact documented HTTP surface

Base URL in official examples: `https://tavusapi.com`; authentication is the `x-api-key` header. JSON request bodies use `Content-Type: application/json`.[1][6]

| Operation | Exact method/path | Contract relevant to P5 |
|---|---|---|
| Create render | `POST /v2/videos` | Required `replica_id` plus `script` **or** `audio_url`; optional `video_name`, `callback_url`, backgrounds and rendering controls. Returns HTTP 200 with `video_id`, `status`, `hosted_url`, `created_at`.[1] |
| Render status | `GET /v2/videos/{video_id}` | Returns `status`, `status_details`, `data`, `download_url`, `stream_url`, `hosted_url`, timestamps and thumbnails.[2] |
| List renders | `GET /v2/videos` | Pagination via `limit`, zero-indexed `page` (default 0).[17] |
| Delete render | `DELETE /v2/videos/{video_id}` | `hard=true` irreversibly deletes video and associated assets, including thumbnails. HTTP 200 documented; default example `hard=false`.[3] |
| Create custom face | `POST /v2/faces` | One of `train_video_url` / `train_image_url`; optional `face_name`, `callback_url`, `model_name`, `properties`. Returns HTTP 200, `face_id`, `status`.[6] |
| Face status | `GET /v2/faces/{face_id}` | `status`, `finetune_status`, `error_message`; verbose face type and model metadata.[7] |
| Face discovery | `GET /v2/faces` | `face_type=system` for stock or `user` for custom; `limit`, `page`, `verbose`, `face_ids`, `model_name`; `data` and `total_count`.[14] |
| Delete face | `DELETE /v2/faces/{face_id}` | `hard=true` irrevocably deletes face/associated assets such as training footage. HTTP 200 documented. Does **not** delete conversations created with it.[8] |
| Delete incidental voice | `DELETE /v2/voices/{voice_id}` | HTTP 204; HTTP 409 when still referenced by a face or PAL, with `used_by.faces` / `used_by.pals`.[26] |

**Terminology migration:** `/v2/faces` is current; `/v2/replicas` and `replica_id` / `replica_ids` remain documented aliases.[14] Video creation still requires the field name **`replica_id`**, whose value is the current Face ID. Do not silently rename the Video API field to `face_id`.[1]

**Render lifecycle:** `queued`, `generating`, `ready`, `deleted`, `error` are documented values.[1] Successful retrieval exposes download/stream/hosted URLs; do not interpret a returned `hosted_url` at creation as completed output.[2]

**Face lifecycle:** `started`, `completed`, `error`; failure populates `error_message`.[7] For Phoenix-4.5, preview readiness and tuning completion differ:

| Stage | `status` | `finetune_status` | Meaning |
|---|---|---|---|
| Initial | `started` | `null` | Not usable |
| Preview | `completed` | `started` | Usable, burned-in preview watermark |
| Tuned | `completed` | `completed` | Unwatermarked tuned version |
| Tuning failed | `completed` | `errored` | Preview remains usable with tuning-failed watermark |

Preview can arrive in roughly a minute from a photo, minutes from video; tuning takes a few hours. The Face ID remains unchanged. Phoenix-4/3 lack this preview stage. These are documented expectations, not SLAs.[16]

### Cancel, retries and idempotency

- **UNKNOWN:** dedicated asynchronous video cancel endpoint, training cancel endpoint, whether DELETE stops queued/running computation, cancellation billing, or whether deletion releases capacity. The inspected index exposes video/face operations but no cancellation entry; absence is not proof of no private capability.[29]
- **UNKNOWN:** provider-supported idempotency key/header, deduplication window, repeat-POST semantics, repeat-DELETE guarantees, retry-safe status codes, formal async rate limit or `Retry-After` contract. Create docs show no idempotency field; discovery/search did not establish one.[1][29]
- **Recommendation:** reserve a local submission identity before POST; quarantine ambiguous timeouts for reconciliation rather than blindly submitting again. Local deduplication is not provider idempotency. Record provider IDs as soon as available; reconcile reads before marking success or deletion complete.

## 3. Webhooks and callback trust

`callback_url` receives completion/error notifications for video generation; face training also supports callbacks.[5] Relevant payloads are **not** the CVI envelope:

- Video success: `video_id`, `face_id`, `status=ready`, URLs, `generation_progress`, timestamps, `data`, `status_details`.
- Video error: `status=error`, explanatory `status_details`, null download/stream URLs in the example.
- Face callbacks: `status=ready` or error with `error_message`. The migration emits legacy `replica_id` and new `face_id` payload twins; deduplicate them as the same resource/event.[5]

**Important distinction:** face callback `ready` is not the polling API's `completed`. Normalize only in an adapter; preserve raw provider state for diagnosis.[5][7]

**UNKNOWN:** callback signing/HMAC, verification secret/header, delivery retry/backoff, timeout, ordering, exactly-once delivery, stable event IDs, replay protection, source IP allowlist, and full Phoenix-4.5 two-stage callback semantics. The public callback page does not establish these guarantees.[5]

**Recommendation:** treat callbacks as advisory until their resource/state is confirmed through authenticated GET. Require provider clarification on authenticity; make handlers duplicate- and reorder-tolerant and use polling recovery. Do not copy the tutorial's open Flask/ngrok example as a production security design.

## 4. Stock/custom avatars and the permanent-voice boundary

**Stock:** documentation offers 100+ prebuilt stock faces and listing with `face_type=system`; no customer training footage is needed. Pro faces are a selected subset. Stock library breadth is not proof of the selected plan's entitlement or actor-rights scope.[13]

**Custom:** current default `model_name=phoenix-4.5`; accepted alternatives `phoenix-4`, `phoenix-3` (legacy). Image-to-face requires a stock `voice_name` or alternative `default_voice_id`; do not send both. Video-to-face creates a voice from recording audio and sets it as the face's default, rather than accepting that field.[6]

**P5 consequence (inference):** approved-audio rendering bypasses script synthesis for a job, but does **not** establish a voice-free custom model workflow. A face-with-voice created during enrollment remains a provider-side voice asset even if Tanaghom exposes no voice feature. **Documented blocker:** a face's `original_voice_id` cannot be deleted at all because it is the fallback; other referenced voices return 409 until detached.[26] Whether hard-deleting the entire face also purges its automatic/original voice is **UNKNOWN**. Obtain a written visual-only/no-persistent-personal-voice option or keep custom enrollment blocked.

The face overview links the PAL Maker's guided upload checks and inline validation. That is not evidence of identity/KYC verification or proof that customer consent records have been reviewed.[25]

## 5. Script/audio, Arabic, dialects and format limits

### Input paths

Text path generates audio from `script`; the approved-audio path passes `audio_url` with the selected face and may use `callback_url`. The quickstart explicitly demonstrates both requests; it describes hosted `.mp3` or `.wav` inputs.[4] Recommended P5 scope is **audio-only input**, not `script` generation.

Output options include `fast=true`, which disables background generation, thumbnails and streaming URLs, and `transparent_background=true`, which yields `.webm` and requires fast mode. Background website/video URLs and watermark PNG/JPEG URLs must be publicly reachable.[1] These options do not confer distribution rights.

### Arabic evidence, not a dialect certification

The async overview advertises 42 supported languages and bring-your-own audio, but does not enumerate them.[27] The explicit language table is in **CVI** documentation: Arabic / `ar` is among the 42 default `tavus-auto` TTS languages; language routing and per-engine coverage are CVI configurations.[10]

- **KNOWN:** an official Tavus table explicitly names Arabic.
- **UNKNOWN:** an async-specific Arabic script/voice guarantee, MSA accuracy, Egyptian, Levantine, Gulf, Iraqi or Maghrebi dialect quality, locale tags for these dialects, Arabic phoneme/lipsync benchmark results, code-switching, names/numerals, diacritics and Arabic subtitles/RTL typography.
- **Inference:** approved Arabic audio removes the need to depend on provider script TTS, but not the need to evaluate pronunciation preservation, timing and lipsync for the intended dialect. No such evaluation was performed.

### Numeric limits and conflicting documentation

The errors table documents input-audio minimum **3 seconds**, maximum **10 minutes**, maximum-size rejection at **750 MB**, and a requirement for **WAV**; downloadable audio links must be publicly accessible. It also labels the old consent-phrase failure as **legacy**.[18]

This conflicts with the quickstart's `.mp3` or `.wav` statement.[4] **Recommendation:** use WAV conservatively in a later approved trial and obtain a written format contract; MP3 support remains **UNCERTAIN**, not guaranteed.

Phoenix-4 training: 30 seconds speaking + 30 seconds still in one shot; minimum 25 FPS/1080p; maximum 750 MB; `.webm` or `.mp4` (H.264/AAC) listed; full-body framing supported; typical training 3–4 hours.[12] Phoenix-4.5 similarly documents portrait training, 750 MB, 25 FPS, 1080p and `.webm`/`.mp4`, but not head-to-toe full body.[15] The general errors table instead says MP4/H.264 only, another inconsistency to resolve.[18]

**UNKNOWN:** general script character/token limit; maximum generated-video duration beyond the audio-input rule; async output resolution/FPS/bitrate; audio sample-rate/channels contract; aspect-ratio controls; per-request payload limit; maximum simultaneous queued/running renders; generation-time SLA. Do not infer async limits from CVI's 1080p/24 kHz marketing.

Training download URLs should remain usable for at least **24 hours** after submission.[11] The retention/access window for job audio URLs is **UNKNOWN**. Recommendation: short-lived access sufficient for the documented processing window, never indefinite public identity-media hosting.

## 6. Pricing and capacity — retrieved 2026-10-11

**Public pricing contains conflicting duplicated comparisons; definitive account entitlement is UNKNOWN.** Top Developer cards and nearby comparison:[23]

| Developer tier | Monthly listed price | Async minutes/month | Custom trainings/month | CVI concurrent streams |
|---|---:|---:|---:|---:|
| Basic | Free | 5 | Not listed | 1 in comparison |
| Starter | $59 | 10 | 3 | 3 |
| Growth | $397 | 100 | 7 | 10 |
| Enterprise | Custom | Scaling/custom | Contract | Custom |

Starter/Growth async overage lists **$1/$0.90 per minute**; training overage **$65/$40**. Another comparison shows async allowances `5/15/50/250/custom` and rates `$1/$0.90/$0.80/custom`, so do not reconcile these into invented tiers. Async billing there states a **30-second minimum** and nearest **6-second increment**.[23]

CVI concurrency measures live conversations, **not established async throughput**. Paid plans advertise uncapped overage; pricing also states 20% annual discount. Consumer PALs plans are not Developer/API entitlements.[23]

The Face FAQ says failed training credits return after **roughly a day**; request/check the training credit before deleting the failed face, because deletion obscures the failure record and prevents the documented refund check. This does not establish a cash refund or failed-video billing.[9]

**UNKNOWN:** failed/rejected render billing, failed-training cash refunds, retry/duplicate charges, partial-output charges, cancel refunds, rounding tie rules, tax-inclusive total, async concurrency/rate limits, and negotiated SLA. Obtain dated written pricing/entitlements before approving spend.

General self-service terms make subscription fees non-refundable and authorize billing/renewal; they do not establish per-failed-render charging semantics.[19] Enterprise fees follow the Order Form.[20]

## 7. Legal rights, ownership and training use

### Contract hierarchy and ownership

Self-service Terms show **last updated 2025-04-24**. A separately signed MSA controls instead where present. Sections 4.1/6.2–6.5 permit integrations subject to conditions, assign customer/end-user ownership of inputs and generated media as between the parties, but customer avatars remain platform-managed and non-exportable. Customer must obtain applicable likeness, voice, biometric notices/releases and bears responsibility for output use and third-party rights.[19]

Self-service §6.5 grants a non-exclusive, worldwide, **perpetual**, royalty-free, fully-paid license over inputs/outputs for requested generation, functionality, maintenance and product improvement. Therefore output ownership is **not** equivalent to a no-training/no-improvement promise. Customer rights claims do not certify copyrightability or legality of particular output.[19]

Enterprise Terms show **last revised 2025-09-10**. §6.3 retains customer/end-user input/output ownership and platform-only avatars; §6.4 also licenses inputs/outputs for generation and improvement, but omits the self-service clause's explicit perpetual/fully-paid wording. This is **not** an explicit no-training restriction. Entitlements/fees depend on a signed Order Form.[20]

**UNKNOWN:** a Tanaghom-specific MSA, explicit exclusion of training/evaluation/human review, opt-out mechanism and scope, rights to stock actors' performances in Tanaghom's commercial contexts, or an applicable indemnity commitment. Obtain negotiated terms; do not assume enterprise purchase solves these automatically.

### Biometrics, retention and privacy scope

Privacy Policy is **effective 2025-11-12** and expressly excludes data processed on behalf of business customers, which may be governed by customer agreements. Its U.S. biometric policy identifies facial geometry/voiceprints; says anonymized biometric data is created for AI training/services; permits necessary third-party processing. Retention is until purpose fulfillment or one year after last interaction, **whichever occurs first**; biometric deletion may be requested at `support@tavus.io` or by closing the account.[22]

It also allows general R&D/model improvement and international transfers including the U.S. The connected-Google-account section's up-to-90-day conversation logs are **not** an async avatar/audio retention promise.[22]

**UNKNOWN for Tanaghom business data:** contracted retention by asset class, audio/seed/video TTL, inference-log retention, model-weight retention, backup purge interval, deletion completion SLA/certificate, subprocessors/locations, regional residency, and removal of already anonymized training derivatives. The public biometric timeframe must not be applied as a business-service deletion warranty.

### DPA/security evidence

No executed or fully reviewed public DPA, SCC annex, current subprocessor list, or BAA was established in this research. **UNKNOWN:** applicable controller/processor roles, transfer mechanism, audit terms, breach-notice deadline and subprocessors' biometric handling.

The Tavus Trust Center is provider-linked and shows last update **2026-08-25**, listing SOC 2 Type 2, HIPAA and GDPR; the accessible page is not the audit report or a DPA.[28] Tavus's **2026-05-28** security guidance itself recommends written residency guarantees and DPA/SCC terms, audit rights and explicit model-training exclusion. That guidance is not proof Tavus has agreed those terms for this account.[24]

## 8. Consent verification, revocation and public figures

AUP is **effective 2026-04-14**. §§2–3 require explicit informed subject consent; customer must maintain creation/use/distribution consent, honor revocation/removal and stay within its scope. Subjects may contact Tavus directly. Under-18 replicas and real-person replicas without explicit consent, including public figures, are prohibited. Prominent AI disclosure is required. Stock actors cannot be presented as personally endorsing opinions/conditions; political campaigns, fundraising, news or sensitive current events require prior Tavus written consent. Fraudulent/harmful impersonation is prohibited; legitimate political advertising requires prior written approval.[21]

**Verification UNKNOWN:** current mandatory spoken phrase, separate consent-video field, liveness/identity verification, documentary proof format, audit interface, consent-to-face binding and verification result. Current Create Face fields do not establish a consent-record submission API.[6] The old `consent_phrase_mismatch` documentation explicitly calls that flow legacy.[18] Do not resurrect an old memorized consent phrase as a current requirement.

FAQ says public figures, celebrities and deceased persons can be created when legal rights/permission exist; **the same FAQ** lists `CelebrityFoundError` rejecting recognizable figures/copyrighted characters. Both model generations share that checker. This is an unresolved permission-versus-enforcement conflict, not a safe celebrity exception.[9]

**Recommendation:** exclude public figures and deceased/minor subjects from P5 by default; require provider-specific written clearance plus legal review for any exception. A deceased-subject exception to the explicit-consent rule is **UNKNOWN**.

**Revocation/erasure UNKNOWN:** no verified single API revoking consent, atomically disabling all renders, cascading model/voice/output deletion, purging backups/training derivatives, or proving completion. Face deletion explicitly does not delete associated conversations; its reference to Delete Video is itself ambiguous for conversation cleanup.[8]

Proposed local revocation sequence, not an implemented/provider-guaranteed workflow: revoke the separate consent record; block new submissions/output access; reconcile in-flight jobs; delete each output and hard-delete provider identity assets; resolve voice dependencies; request residual/backup erasure; record confirmation and retained audit basis. Downloaded/distributed copies need separate governance.

## 9. Conditional acceptance gates / questions to Tavus

These are Tanaghom recommendations; **none were executed**:

1. **Contract/privacy gate:** legal approval, applicable MSA/DPA/SCCs, current subprocessors and locations, no-training/no-human-review terms, lawful biometric basis, retention/backup deletion and incident obligations.
2. **Voice gate:** can a visual-only custom face exist without a cloned/persistent personal voice? Can the automatic voice be removed while preserving approved-audio video rendering? Require documented answer or keep custom training disabled.
3. **Rights gate:** verified adult identity and scope-specific, revocable consent stored separately; authorized audio/background assets; stock-actor commercial rights and prohibited contexts; clear AI disclosure.
4. **Reliability gate:** idempotency/ambiguous submission reconciliation, cancellation semantics, authenticated callbacks or polling-first operation, state reconciliation and tested erasure.
5. **Media gate:** settled MP3/WAV and MP4/WebM conflicts; async output technical contract; controlled Arabic/dialect tests with approved audio and human review; no script-TTS dependency.
6. **Cost gate:** signed dated async plan/overage schedule, failed/retry/cancel/training billing, async concurrency/rate limits and hard spend controls.
7. **Architecture gate:** provider-neutral avatar identity; adapter-only Tavus IDs/raw states; consent separate from training status; private outputs; no CVI, publishing or permanent voice module.

**Bottom line:** sufficiently documented to remain an async-render candidate, insufficiently resolved to approve commercial production or custom biometric enrollment. Stock + approved audio is a possible narrower future trial, **conditional on user authorization and the gates above**.

## 10. Research limitations

Only official Tavus docs, Tavus legal/pricing pages and its linked Trust Center support provider claims. Search results from third parties were not used. Public pages were inspected without logging in or accessing private contract/security documents. No empirical provider behavior, Arabic quality, billing or deletion result was tested. UNKNOWN means not established by the retrieved public sources, not necessarily unsupported. Documentation and duplicated pricing conflicts are preserved rather than silently resolved.

The user specifically requested investigation of current faces versus legacy replicas: this report uses `/v2/faces` for new enrollment, retains the actual `replica_id` field in `/v2/videos`, and separates Phoenix-4.5 preview/tuning from Phoenix-4 full-body and Phoenix-3 legacy flows.[1][6]

Async downloadable output is the proposed scope; a provider `stream_url` for file playback is not a real-time CVI integration and is not a requirement to enable streaming.[2][27]

Inline numbered citations below map to retrieved URLs; each source carries a concise verbatim evidence excerpt. Source evidence is intentionally brief and not a substitute for reviewing the full controlling contract.

## Sources

[1] https://docs.tavus.io/api-reference/video-request/create-video — Generate Video
    > "The only required body parameters are `replica_id` and either `script` or `audio_url`."
[2] https://docs.tavus.io/api-reference/video-request/get-video — Get Video
    > "This endpoint returns a single video by its unique identifier."
[3] https://docs.tavus.io/api-reference/video-request/delete-video — Delete Video
    > "If set to true, the video and associated assets (such as thumbnail images) will be hard deleted."
[4] https://docs.tavus.io/sections/video/quickstart — Async video quickstart
    > "Script in text form, or audio as `.mp3` or `.wav`"
[5] https://docs.tavus.io/sections/webhooks-and-callbacks — Webhooks and Callbacks
    > "New integrations should key off `face_id`; the `replica_id` twin will be removed once the legacy field is retired."
[6] https://docs.tavus.io/api-reference/faces/create-face — Create Face
    > "Video-to-face does not take this field: a voice is created from the training video's own audio and set as the default."
[7] https://docs.tavus.io/api-reference/faces/get-face — Get Face
    > "On Phoenix-4.5, `completed` means the zero-shot preview is ready, not that tuning is done."
[8] https://docs.tavus.io/api-reference/faces/delete-face — Delete Face
    > "If set to true, the face and associated assets (such as training footage) will be hard deleted."
[9] https://docs.tavus.io/sections/faces/face-faqs — Face FAQs
    > "This includes faces of public figures, celebrities, or deceased individuals."
[10] https://docs.tavus.io/sections/conversational-video-interface/language-support — CVI Language Support
    > "Tavus speaks 42 languages with the default `tavus-auto` TTS engine."
[11] https://docs.tavus.io/sections/faces/video-to-face-quickstart — Video to Face
    > "Keep them valid for at least 24 hours after submission."
[12] https://docs.tavus.io/sections/faces/phoenix-4-video-requirements — Phoenix-4 Video Requirements
    > "Your video must be one continuous shot, containing 30 seconds of speaking followed by 30 seconds of still footage."
[13] https://docs.tavus.io/sections/faces/stock-faces — Stock Faces
    > "Tavus offers a library of 100+ stock faces"
[14] https://docs.tavus.io/api-reference/faces/list-faces — List Faces
    > "The total number of faces given the filters provided."
[15] https://docs.tavus.io/sections/faces/phoenix-45-video-requirements — Phoenix-4.5 Video Requirements
    > "Maximum file size: 750 MB"
[16] https://docs.tavus.io/sections/faces/phoenix-45-preview-and-status — Phoenix-4.5 Preview and Status
    > "Tuning continues in the background for a few hours."
[17] https://docs.tavus.io/api-reference/video-request/get-videos — List Videos
    > "The page number to return (0-indexed). Default is 0 (first page)."
[18] https://docs.tavus.io/sections/errors-and-status-details — Errors and Status Details
    > "All face training footage must be .mp4"
[19] https://www.tavus.io/terms-of-service — Terms of Service; updated 2025-04-24
    > "They are not made available for download, transfer, or independent use outside the Tavus Platform."
[20] https://www.tavus.io/enterprise-terms-of-service — Enterprise Terms; revised 2025-09-10
    > "Customer hereby grants Tavus a non-exclusive, worldwide, royalty-free license"
[21] https://www.tavus.io/acceptable-use-policy — Acceptable Use Policy; effective 2026-04-14
    > "Creating a Customer Replica requires the explicit, informed consent of the individual depicted in the Seed Files"
[22] https://www.tavus.io/privacy-policy — Privacy Policy; effective 2025-11-12
    > "Use of Biometric Data. Tavus will create anonymized data to train AI models"
[23] https://www.tavus.io/pricing — Pricing retrieved 2026-10-11; conflicting page sections
    > "Each video incurs a 30-second minimum charge."
[24] https://www.tavus.io/blog/conversational-ai-security — Security procurement guidance; 2026-05-28
    > "Start with written data residency guarantees that cover both inference processing and storage."
[25] https://docs.tavus.io/sections/faces/overview — Face overview
    > "For a guided face creation flow with upload checks and inline validation"
[26] https://docs.tavus.io/api-reference/voices/delete-voice — Delete Voice
    > "A face’s original_voice_id cannot be deleted at all, since it is the id a face reverts to."
[27] https://docs.tavus.io/sections/video/overview — Video overview
    > "There is no real-time interaction involved."
[28] https://tavus.securitypal.com — Tavus Trust Center; last updated 2026-08-25
    > "Tavus Trust Center"
[29] https://docs.tavus.io/llms.txt — Official documentation index
    > "How to access machine-readable docs and API artifacts for developers"
