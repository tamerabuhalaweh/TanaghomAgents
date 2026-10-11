# Tanaghom P5 — HeyGen official-source diligence

**Decision date: 2026-10-11. Scope:** commercial, governed, asynchronous Creative Runtime research; canonical avatars and purpose-scoped consent. No voice-cloning platform, realtime integration, publication/deployment, repository change, issue/PR, authenticated vendor API request, or vendor contact performed.

## Executive decision

**Conditional candidate, not production-approved.** The current official developer pages confirm v3 avatar generation and Avatar V; IV is the default, not the newest named engine. They distinguish current v3 Avatar III from a different legacy III pipeline.[37]

**Hold commercial implementation until contract/privacy gates clear:** API pay-as-you-go commercial ownership and embedding permission; explicit no-training/no-independent-improvement terms covering all submitted material; enforceable biometric deletion and revocation; agreed authoritative pricing and failed/cancelled-job billing; validated Arabic voices and exact model/look eligibility. These are Tanaghom recommendations, not vendor assurances.

A stock or properly licensed synthetic canonical character with pre-approved non-cloned voice/custom audio is the lower-risk first evaluation path. Real-person digital twins introduce vendor-side voice cloning even if Tanaghom does not call a standalone voice-clone API.[13]

## Retrieval and freshness caveat

Live official developer `.md` pages and official legal/help pages were fetched during this task; underlying captures are in `p5-heygen-evidence/`. The developer documentation index points self-serve pricing to a logged-in dashboard. Direct `docs/pricing.md` returned HTTP 404, and the marketing API-pricing URL redirected to that dashboard in the browser.[39][31][49]

**Requested `web.run` was not available in this subagent tool catalog:** tool discovery returned `not_found`. Available search ran through `hermes_tools.web_search`; its configured OpenAI-native backend could not execute client-side, so it fell back to Exa. Search returns containing official URLs are treated only as indexed excerpts, never as live page verification. Direct requests and a read-only browser resolved live sources. No login was attempted.

Terms show **July 23, 2026** update; Privacy **August 11, 2026**; Biometric Notice **May 5, 2026**.[28][29][34]

DPA is effective **October 2024**.[30] The live API pricing Help Center article states **September 16, 2026** as its last-updated date, despite a relative “Updated this week” label.[32]

## 1. Current model and avatar matrix

| Engine | Current official position | Avatar inputs | Eligibility / controls |
|---|---|---|---|
| Avatar III, `avatar_iii` | Current v3 engine; separate from old v1/v2 III | Digital twin, studio avatar, registered photo avatar | III twin/studio up to 4K; III photo up to 1080p; use IV for arbitrary image and expressive controls.[1][37] |
| Avatar IV, `avatar_iv` | Default v3 rendering engine | Studio, digital twin, photo, arbitrary image, prompt-created avatar | Broadest coverage. `motion_prompt` and `expressiveness` documented for photo/image; expressiveness `high`, `medium`, `low`, default `low`.[2] |
| Avatar V, `avatar_v` | Higher-fidelity, explicitly selected, opt-in per look | Model comparison and V guide: eligible **digital twins only** | Check `GET /v3/avatars/looks/{look_id}` → `supported_api_engines` includes `avatar_v`. Optional `reference_look_id` must be a twin look in the same group and clear applicable consent; otherwise self-reference. No V expressiveness control.[3][37] |

**Documentation conflict:** the look-list guide includes an example labelled `photo_avatar` with `supported_api_engines: ["avatar_iv", "avatar_v"]`; create-video reference prose also discusses a photo/V animation-reference condition. These conflict with the categorical V guide/model matrix. **Photo/studio V general availability: UNKNOWN.** Do not infer entitlement from examples; use the actual look response and a contractually agreed capability list.[21][4][3]

The Avatar V official research page is useful for model positioning, not sufficient evidence of API availability or pricing. API availability is established by the current V guide and v3 reference, not by the research announcement.[36][3][4]

### Canonical stock, photo and twin assets

- **Stock/public avatars:** `GET /v3/avatars?ownership=public`; `ownership=private` for owned characters. A group is the character identity, not the render ID. Public catalog existence does not establish exclusive rights or unlimited downstream distribution.[20]
- **Looks:** `GET /v3/avatars/looks?group_id=...`; filter `ownership` and `avatar_type`. Render with the **look `id` as `avatar_id`**, not the group ID. Persist approved group+look pair and engine eligibility in Tanaghom's canonical registry.[21]
- **Photo creation:** `POST /v3/avatars` with `type:"photo"`, `name`, `file` (URL/asset/base64), optional `avatar_group_id`. Keep `avatar_item.id`; poll `GET /v3/avatars/looks/{look_id}` until completed or failed. Photo identity is the reference for later looks. No vendor consent step/record; permission is the customer's responsibility.[19]
- **Twin creation:** same create endpoint with `type:"digital_twin"`. Response separates `avatar_item.id` and `avatar_group.id`. Poll look training; training events `instant_avatar.success/fail`. Training footage 15–600 seconds, one person, audible speech, MP4/WebM, long edge 640–4096 px; about two minutes at 1080p recommended. **A voice is cloned from the footage.** Omitting `voice_id` can select the group's default; explicitly approved custom audio avoids using that voice but does not prove cloning was disabled.[13]
- **Synthetic prompt avatars:** `POST /v3/avatars` supports `type:"prompt"` as well as photo and twin. This is a creation route, not permission to imitate a real/public person. Creation/training can be asynchronous.[47][40]

## 2. Consent: vendor mechanics versus Tanaghom authorization

Vendor twin consent is group-scoped. `POST /v3/avatars/{group_id}/consent` drives webcam consent and, for enabled enterprise accounts, recorded-video submission. Webcam link lasts **24 hours**. Enterprise may instead obtain a waiver through an indemnity agreement. Neither a waiver nor `consent_status:null` authorizes Tanaghom use.[7]

Recorded consent requires the same visible person, audible statement in any language, single face and **under 35 seconds**; separate from training footage. Poll `GET /v3/avatars/{group_id}` for `pending/accepted/rejected`. No consent webhook; training webhooks are not consent approval. Only add same-person looks to an existing group.[7][13]

The consent reference accepts optional `reroute_url` for webcam flow, or enterprise `consent_video` object (`type:url` or `type:asset_id`) for upload. `Idempotency-Key` is supported. Submission while review is pending or already accepted can produce a 400; rejected consent can be resubmitted.[46][7]

**Tanaghom gates (recommended):** local signed consent before uploads; separate authorizations for likeness generation, commercial scopes, specific channels/territories, duration, transformations, voice use and any model improvement; canonical subject ID; asset provenance; revocation version and audit trail. Never turn on vendor consent-skip as a substitute. Reject arbitrary unapproved images/IDs and prohibit cross-person group reuse. Photo assets still require the local record.

## 3. Exact asynchronous API contract

### Avatar rendering / status

Production API base: `https://api.heygen.com`; production API keys use `X-Api-Key`. API key billing is distinct from OAuth/web-subscription credit billing; keys can have resource scopes.[42]

| Operation | Exact documented endpoint | Result / caveat |
|---|---|---|
| Render avatar or image | `POST /v3/videos` | Returns `data.video_id`, initial status (example `waiting`), resolved `output_format`.[4] |
| Read authoritative status/output | `GET /v3/videos/{video_id}` | Status enum `pending`, `processing`, `completed`, `failed`; duration, output URLs and failure information.[5] |
| Create avatar | `POST /v3/avatars` | `type: photo / digital_twin / prompt`; use returned look/group identities distinctly.[47] |
| Read look | `GET /v3/avatars/looks/{look_id}` | Training status and supported engines.[21] |
| Read group/consent | `GET /v3/avatars/{group_id}` | Group consent status; consent cannot be inferred from look training.[7] |
| Existing-video lip-sync | `POST /v3/lipsyncs`; `GET /v3/lipsyncs/{lipsync_id}` | Create returns `lipsync_id`; `mode:"speed"` or `"precision"`.[18][11] |
| Delete video | `DELETE /v3/videos/{video_id}` | Permanent deletion and associated files; **not documented as render cancellation**.[16] |
| Stop Video Agent | `POST /v3/video-agents/{session_id}/stop` | Empty body; stop at next checkpoint, preserve partial results. Agent-specific, not an avatar-render cancel API.[17] |

**Direct avatar-render cancellation: UNKNOWN / no confirmed public endpoint found.** Do not invent `/v3/videos/{id}/cancel`, reinterpret DELETE as cancellation, or promise no charges on deletion. “Cancel” mentioned in app-oriented help is not proof of an API route.[16][17][45]

**Idempotency:** create-video reference documents optional `Idempotency-Key`, 1–255 characters in `[A-Za-z0-9_:.-]`; same endpoint/resource key replays the original response within **24 hours**; in-flight retry returns **409 `request_in_progress`**. The reference says slightly different bodies can replay with a warning. Error docs say workflow-authoring key reuse with different body/target conflicts. Therefore reuse a key only for the **same persisted exact payload**, not edits; new generation means new key.[4][23]

### Script versus custom audio

Use `type:"avatar"`, canonical `avatar_id`, explicit `engine:{type:"avatar_iv"}` (or approved III/V), and either `script` plus an approved `voice_id`, or `audio_url`/`audio_asset_id`. Script and audio are mutually exclusive. An avatar can fall back to its default voice when `voice_id` is absent; disallow that implicit choice locally.[38][10]

Illustrative **documentation-derived request only; not executed**:

```json
{
  "type": "avatar",
  "avatar_id": "APPROVED_CANONICAL_LOOK_ID",
  "audio_asset_id": "APPROVED_AUDIO_ASSET_ID",
  "engine": { "type": "avatar_iv" },
  "resolution": "1080p",
  "aspect_ratio": "16:9",
  "output_format": "mp4",
  "callback_id": "LOCAL_GENERATION_ID"
}
```

`audio_url` must be public HTTPS; uploaded MP3/WAV can be referenced by asset ID. No voice clone is needed merely to lip-sync approved existing audio. The audio-to-video guide says output follows supplied audio and mentions up to 30 minutes; usage-limits says avatar audio input max 10 minutes. **Unresolved input-duration conflict:** cap P5 evaluation at 600 seconds unless an authoritative account contract/test proves more.[10][6]

Existing-video lip-sync uses structured `video` and `audio` inputs (public URL or asset ID), not script TTS. Speed and Precision have distinct quality modes. Controls include dynamic-duration adjustment, captions, music stripping, speech enhancement, same-format preservation and `fps_mode:vfr/cfr/passthrough`; lip-sync status guide uses `pending/running/completed/failed`, distinct from video status.[11][12][18]

### Webhooks (documented only; none created)

- Register `POST /v3/webhooks/endpoints` with public HTTPS `url`, explicit `events`, optional `entity_id`. List via GET same path; update `PATCH /v3/webhooks/endpoints/{endpoint_id}`; DELETE same item path; rotate via `POST .../{endpoint_id}/rotate-secret`. Secret shown only on create/rotation; rotation invalidates old secret immediately.[8]
- Avatar render events are **`avatar_video.success` / `avatar_video.fail`**, not the generic names in the page's search description. `GET /v3/webhooks/event-types` enumerates event catalog; `GET /v3/webhooks/events` reads delivery history. Success includes `event_data.video_id`, pre-signed `url`, optional `callback_id`, and app/share links.[9]
- Verify header **`signature`**: hex HMAC-SHA256 of **raw body** with endpoint secret, constant-time compare. Respond 2xx within **10 seconds**. Exponential-backoff retries for **24 hours**; duplicates possible. Deduplicate video ID + event type or local callback correlation, then re-read authoritative resource. Do not trust unsigned callbacks; callback URL signing parity is not separately confirmed.[8][9]

## 4. Arabic and dialects

The official voice-language article explicitly lists **Arabic: Algeria, Bahrain, Egypt, Iraq, Jordan, Kuwait, Lebanon, Libya, Morocco, Oman, Qatar, Saudi Arabia, Syria, Tunisia, United Arab Emirates, Yemen**.[41]

Translation's language list adds **Standard** and **World** Arabic to those regional entries. This is translation capability evidence, not proof that every catalog TTS voice or every avatar has all those dialects.[33]

`GET /v3/voices` supports language/type/engine filtering; inspect the actual returned stock voice before binding it to a canonical avatar. API-wide exact Arabic dialect→locale→voice-ID mapping, uniform provider/model coverage, and tested Iraqi/Levantine/Gulf phoneme quality are **UNKNOWN**. Country labels are not a guaranteed dialect-fidelity benchmark.[27]

**Recommended acceptance test, not performed:** approved Arabic script/custom audio with diacritics, numbers, brand terms, mixed Latin/Arabic and each target dialect; human review of pronunciation, identity fidelity and lip-sync. Do not establish business quality from the generic multilingual marketing claim.

## 5. Duration, output, input limits and retention

| Topic | Confirmed official wording / limit | P5 interpretation |
|---|---|---|
| Script | 5,000 characters max.[6] | Split deliberately; preserve approved script hashes locally. |
| Avatar audio | Usage guide: max 600 seconds; audio-to-video guide: up to 30 minutes.[6][10] | Conflict: 600 seconds safe documented bound; above that UNKNOWN. |
| Scene/video | Max 30 minutes per scene; single avatar/image request is one scene; max 50 scenes in multi-scene modes.[6] | Not evidence of guaranteed 30-minute custom-audio admission. |
| FPS | Avatar-containing video: **25 fps**.[6] | No general controllable arbitrary render-fps claim. |
| Resolution | v3 enum `720p`, `1080p`, `4k`; 4K limited to III twin/studio; III photo max 1080p.[4][1] | Default guide says 1080p; explicitly request resolution and verify downloaded media. IV/V 4K UNKNOWN. |
| Dimensions | Usage guide: width/height 128–4096 px.[6] | Subject to engine resolution limits, not arbitrary 4K support. |
| Aspect | Reference: `16:9`, `9:16`, `4:5`, `5:4`, `1:1`, `auto`; auto derives source framing, falls back to 16:9. Usage overview only lists 16:9/9:16.[38][6] | Record overview/reference discrepancy; use current endpoint schema. |
| Container/alpha | Default MP4; `output_format:"webm"` gives transparent alpha for matting-capable avatars; background object rejected with WebM; cinematic mode lacks this option.[14] | Exact MP4 codec profile/audio codec and WebM codec **UNKNOWN**. Explanatory H.264/H.265 discussion is not a codec guarantee. |
| Direct uploaded assets | `POST /v3/assets`: 32 MB, PNG/JPEG/MP4/WebM/MP3/WAV/PDF; larger direct-upload cap supplied as `max_bytes`.[43] | Asset upload limit differs from URL-resource render limits. |
| Render URL inputs | Video MP4/WebM ≤100 MB, image JPG/PNG ≤50 MB, audio WAV/MP3 ≤50 MB; video/image below 2K; reachable without authentication.[6] | Signed URLs can still be bearer-accessible while valid; not private-authenticated delivery. |
| Output links | Pre-signed links expire; read `Expires`, download promptly, GET video again for fresh link.[15][9] | Exact fixed TTL **UNKNOWN**; do not assume seven days or durable public URL. |
| Vendor output retention | No fixed all-videos retention period established. Privacy retains as needed; account/content deletion has backup policy.[29] | Retention is not output-link expiry. Contract for actual TTL and deletion. |

GET video exposes `video_url`, `captioned_video_url`, `subtitle_url`, `thumbnail_url`, `gif_url`, lifecycle timestamps and failure details. Choose clean `video_url`; caption style can burn captions into it. Composition details can include script/assets; they do not guarantee a pixel-exact rebuild.[15][9]

## 6. Pricing — exact retrieved figures, unresolved authoritative conflict

### Fresh official Help Center body (September 16, 2026 label)

Self-serve **USD/minute**, “charged by actual seconds generated”; copied as published, without converting rounded rates.[32]

| Engine/type or operation | Published self-serve USD | Published credits |
|---|---:|---:|
| Avatar V / digital twin | $7.20/min | 144/min |
| Avatar IV / photo | $2.31/min | 46/min |
| Avatar IV / digital twin | $4.83/min | 97/min |
| Avatar IV / studio | $4.83/min | 97/min |
| Avatar III / digital twin | $0.60/min | 12/min |
| Avatar III / studio | $0.99/min | 20/min |
| Avatar III / photo | $0.99/min | 20/min |
| Create digital twin | $2.13/call | 43 |
| Create photo avatar | $1.32/call | 26 |
| Lipsync speed | $0.84/min | 17/min |
| Lipsync precision | $1.74/min | 35/min |

Article: standalone pay-as-you-go wallet, no new subscription needed; grandfathered API Pro/Scale deprecated, unrecoverable after cancellation. PAYG credits expire **12 months**; legacy Pro/Scale **30 days**. **No free API credits starting February 2026**. No current new-account Pro/Scale monthly price should be inferred.[32]

### Conflicting indexed developer/marketing excerpts — **NOT verified current**

`https://developers.heygen.com/docs/pricing` indexed excerpts returned these figures, but **live source returns 404**: V twin **$0.0667/sec**; IV photo **$0.05/sec**, IV twin/studio **$0.0667/sec**; III twin/studio **$0.0167/sec**, III photo **$0.0433/sec**; avatar creation twin/photo **$1.00/call**. Retain only as conflict evidence; NOT current budgeting rates.[39]

Parent also reported older June help-page figures **$1/min III, $3/min photo IV, $4/min twin IV**, and concurrency 10. Those prices are not the fresh Help Center body fetched here; **unverified historical/indexed figures**, not current contractual prices.[32]

Marketing search excerpt says both “Start with just $5” and “Try the HeyGen API for free”. Fresh Help Center explicitly says no free API credits since February 2026. Live marketing URL redirects to a login-gated pricing dashboard. **Minimum top-up and free allocation: UNKNOWN beyond Help Center's no-free assertion; do not resolve conflict in favor of free trials.**[31][32]

Current developer index's pricing dashboard requires login; no account access or quote requested. **Exact account-authoritative current price, negotiated enterprise price, rounding/minimum billable duration, tax/currency treatment, avatar slot/storage fees, and entitlement to V: UNKNOWN.** The published Help Center is best live public price evidence, but do not use it as a signed price schedule.

### Concurrency and failure billing

Current usage docs: **PAYG 10** concurrent workflows; **Enterprise 20** included, up to **+50 per workflow type** burst at **1.5×** contract rate. Asynchronous sessions, avatar renders and translations consume concurrency; over-limit returns 429 and `Retry-After`.[6][24]

Burst applies separately to avatar renders and translation pools; above-included workflows get the burst price, not all work. Dashboard enables extra capacity. **Enterprise rate itself unpublished/contract-specific.**[24]

Official app-processing help says cancelled/failed video consumes no Credits “under any circumstances”. Its discussion is regular app queues, not an explicit USD-wallet API settlement contract. **API-wide failed/cancelled billing, refund timing, partial-output charging and avatar-training-failure billing: UNKNOWN.** Do not equate no-credit app language with verified PAYG refund semantics.[45]

## 7. Ownership, legal terms, training and biometrics

### Commercial ownership and embedded product risk

Terms §3 is explicitly headed **Creator, Pro and Business**; these users own Input/Output and can use output commercially, subject to termination provisions. §4 Free Plan output is personal/non-commercial/internal-evaluation only. **Standalone PAYG API account mapping is not explicitly resolved.**[28]

The same Terms grant HeyGen a royalty-free, transferable, sublicensable, worldwide **irrevocable** content license covering model training/improvement, surviving termination. §2 restricts competitive/similar products, benchmarking/comparative access, third-party service access, and white-label/interface use unless functionality explicitly provided. **Do not interpret output ownership as clearance for Tanaghom embedding or training confidentiality.**[28]

**Required contract gate:** signed API/enterprise agreement that expressly permits Tanaghom's governed commercial integration and customer access, establishes paid/API output rights and sanctioned evaluation, and overrides broad training/content-license rights. Standard stock/avatar licenses and moderation rights still apply; output ownership does not guarantee copyright or third-party-clearance.

### Training / data improvement

Privacy identifies HeyGen as processor for customer-directed processing but controller for independent purposes including AI training, product improvement, analytics and marketing. Input can train/enhance models; users may request training opt-out. This is **not default zero training** and does not establish an already-effective workspace opt-out.[29]

Biometric Notice says face geometry and potentially **voiceprints** are processed. Training/improvement language says “Except for enterprise customers, if you have granted consent”; the EEA text also discusses legitimate interest and a separate explicit-consent basis where used to uniquely identify. **Enterprise exception in this notice does not independently negate the broader Terms content license or all non-biometric training.**[34][28]

**Contract required:** no independent-purpose training/improvement using scripts, recordings, images, consent videos, embeddings, biometrics or outputs; coverage of subprocessors; separate optional consent only if ever desired; proof of account configuration. Do not contact the vendor during this research.

### Retention / deletion / DPA

Privacy: after account/information deletion, disaster-recovery backups retained **60 days**, then erased; deletion requests targeted within **72 hours**, subject to permitted/required retention. Neither is a guaranteed zero-retention render option.[29]

Biometric Notice: verification geometry promptly deleted, typically minutes; EEA/UK/Swiss active-avatar biometric data retained while avatar active and destroyed within **60 days** of avatar/account deletion. Training deletion subject to feasibility/already-trained-model limits. Illinois: purpose satisfied or three years after last interaction, whichever first; Texas: no more than one year after purpose expires. **Do not globalize region-specific deadlines.**[34]

DPA gives customer controller/company processor roles, instruction-based processing, subprocessors, SCC transfer framework and precedence **SCCs > DPA > Agreement**. §9: necessary storage only; destroy copies including archives within a reasonable time after termination/earlier request; return data within **30 days** on request; certificate of deletion within **30 days** where permitted. **No fixed comprehensive deletion deadline established.** Exhibit text includes biometric identity-authentication data while another transfer field says no special-category data: reconcile before signing.[30]

| Deletion target | Exact public API | Important limitation |
|---|---|---|
| Generated video/files | `DELETE /v3/videos/{video_id}` | Permanent; not proof of backup/biometric/model erasure.[16] |
| Owned avatar group + looks | `DELETE /v3/avatars/{group_id}` | Public/community groups cannot be deleted.[25] |
| Owned photo/twin/kit look | `DELETE /v3/avatars/looks/{look_id}` | Last look removes parent group; studio looks cannot be deleted by API.[48] |
| Uploaded asset | `DELETE /v3/assets/{asset_id}` | Permanent workspace asset deletion; broader lineage erasure not confirmed.[26] |

**Unknown deletion propagation:** whether group deletion automatically removes cloned twin voice, all generated outputs, derivative looks outside group, training data, retained consent videos and subprocessor copies. Maintain Tanaghom deletion manifests and require contractual propagation/receipts. Vendor API deletion alone is not a privacy-completion assertion.

### Public figures / policy

Moderation policy requires actor consent for creation **and use/sharing**; actor may request likeness removal. Photo avatars must not represent real individuals, celebrities or public figures without explicit consent. It also bans political content broadly, not just deceptive campaign media. Local permission does not bypass vendor moderation.[40]

**Recommended P5 policy:** disallow public-figure impersonation and political scenarios by default; no arbitrary user avatars; maintain scoped actor consent and deletion workflows. Stock character availability is not an endorsement license.

## 8. Go/no-go checklist for the parent decision

1. **Commercial authority:** explicitly contracted PAYG/enterprise rights; embedding/customer access; approved non-comparative evaluation.
2. **Privacy:** no-training/no-improvement carve-out binding over standard Terms; controller/processor purposes and subprocessor transfers known.
3. **Consent:** Tanaghom-local scoped records before any upload; photo and indemnity-waived twin still gated; no implicit cloned/default voice use.
4. **Technical contract:** canonical group/look/engine registry; V eligible twin only until conflicts resolved; payload-pinned idempotency, authoritative polling and deduplicated signed webhooks.
5. **Economics:** account-authoritative price schedule, V entitlement, concurrency and failure/refund/cancel semantics. Budgeting is blocked by conflicting public/indexed prices.
6. **Deletion:** agreed TTL, backups, consent/biometric/clone/output lineage, revocation enforcement and deletion certificates.
7. **Arabic quality:** exact selected dialect/voice/provider reviewed with human acceptance; custom audio rights separately cleared.

**Outcome: research-only conditional recommendation.** No consent/privacy/commercial gate was satisfied merely by reading public pages. No generated video, API capability test, webhook, avatar, upload, deployment or publication occurred.

## Evidence provenance

The Sources section below is generated from a task-specific citation ledger. Each short excerpt is attached to the retrieved page text and checked verbatim. Source [39] supports only the live 404; conflicting indexed prices are explicitly labelled above and preserved in `p5-heygen-evidence/search-pricing-conflicts.json`. Source [31] requires the browser redirect record and saved indexed marketing excerpt, not an invented live pricing body.

## Sources

[1] https://developers.heygen.com/avatar-iii
    > "Studio avatar looks are video avatars"
[2] https://developers.heygen.com/avatar-iv
    > "Avatar IV is the default HeyGen v3 rendering engine"
[3] https://developers.heygen.com/avatar-v
    > "Avatar V is opt-in per look."
[4] https://developers.heygen.com/reference/create-video
    > "Optional client-supplied key for safely retrying mutations."
[5] https://developers.heygen.com/reference/get-video
    > "Returns details for a video"
[6] https://developers.heygen.com/docs/usage-limits
    > "Maximum 10 minutes (600 seconds)."
[7] https://developers.heygen.com/docs/avatar-consent
    > "Having no API step to complete is not permission"
[8] https://developers.heygen.com/docs/webhooks
    > "failed deliveries are retried with exponential backoff for up to 24 hours."
[9] https://developers.heygen.com/docs/webhook-events
    > "The video download URL (`url`) is a pre-signed URL"
[10] https://developers.heygen.com/audio-to-video
    > "the difference is that you pass"
[11] https://developers.heygen.com/lipsync-precision
    > "Preserve the source video's resolution and bitrate."
[12] https://developers.heygen.com/lipsync-speed
    > "Preserve the source video's resolution and bitrate."
[13] https://developers.heygen.com/docs/avatar-from-video
    > "clones a voice from the same recording"
[14] https://developers.heygen.com/transparent-background-videos
    > "Transparency requires a format that supports alpha"
[15] https://developers.heygen.com/video-details
    > "Media URLs are presigned and expire"
[16] https://developers.heygen.com/reference/delete-video
    > "Permanently deletes a video and its associated files."
[17] https://developers.heygen.com/reference/stop-video-agent-session
    > "Halts an active agent run at its next checkpoint."
[18] https://developers.heygen.com/reference/create-lipsync
    > "Replaces the audio on an existing video"
[19] https://developers.heygen.com/docs/avatar-from-photo
    > "HeyGen does not collect a consent record for photo avatars"
[20] https://developers.heygen.com/docs/avatars
    > "for HeyGen's preset avatars"
[21] https://developers.heygen.com/docs/avatar-looks
    > "It's the value you pass as `avatar_id` to video creation."
[23] https://developers.heygen.com/docs/error-codes
    > "subsequent retries with the same key within 24 hours replay the original response."
[24] https://developers.heygen.com/docs/burst
    > "pay 1.5× the contract rate only on the jobs"
[25] https://developers.heygen.com/reference/delete-avatar-group
    > "Permanently deletes an avatar group and all its associated looks."
[26] https://developers.heygen.com/reference/delete-asset
    > "Permanently deletes an asset"
[27] https://developers.heygen.com/docs/voices/search-voices
    > "List and filter HeyGen voices by language"
[28] https://www.heygen.com/terms
    > "including to train or otherwise improve or modify our artificial intelligence"
[29] https://www.heygen.com/privacy
    > "it is kept in the backups for the purpose of disaster recovery for 60 days"
[30] https://www.heygen.com/data-processing-addendum
    > "Company will not store or retain any Customer Personal Data"
[31] https://www.heygen.com/api-pricing
    > "Sign in with Google"
[32] https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained
    > "Last updated on September 16, 2026."
[33] https://help.heygen.com/en/articles/11391941-video-translation-languages-we-support
    > "Arabic (Standard, Algeria, Bahrain, Egypt"
[34] https://www.heygen.com/biometric-privacy-notice
    > "Except for enterprise customers, if you have granted consent"
[36] https://www.heygen.com/research/avatar-v-model
    > "Avatar V is the latest version of HeyGen’s avatar video generation system."
[37] https://developers.heygen.com/models
    > "A separate, older Avatar III engine remains available"
[38] https://developers.heygen.com/generate-avatar-video
    > "Generate AI avatar video from a script"
[39] https://developers.heygen.com/docs/pricing
    > "The requested page could not be found."
[40] https://www.heygen.com/moderation-policy
    > "including celebrities or public figures, without their explicit consent"
[41] https://help.heygen.com/en/articles/11391932-voice-languages-we-support
    > "Arabic (Algeria, Bahrain, Egypt"
[42] https://developers.heygen.com/docs/api-key
    > "Generate your HeyGen API key in under a minute."
[43] https://developers.heygen.com/docs/upload-assets
    > "a single `multipart/form-data` request."
[45] https://help.heygen.com/en/articles/9655503-video-priority-processing-times
    > "you will not be charged any Credits under any circumstances."
[46] https://developers.heygen.com/reference/create-avatar-consent
    > "The link expires after 24 hours and accepts one submission."
[47] https://developers.heygen.com/reference/create-avatar
    > "Supports photo, digital_twin, and prompt types."
[48] https://developers.heygen.com/reference/delete-avatar-look
    > "Deleting the last look in a group"
[49] https://developers.heygen.com/llms.txt
    > "Enterprise contract pricing is not published"
