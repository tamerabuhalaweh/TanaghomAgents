# Tanaghom P5 — Synthesia official-source diligence

**Research date:** 2026-10-11. **Scope:** commercial, governed Creative Runtime; provider-neutral avatar identity, scoped consent and revocation; separate talking-head generation and lip-sync contracts. Research only: no vendor generation, uploads, authenticated API requests, signing, repository edits, issues or PRs.

**Provenance / tooling limitation:** The requested `web.run` interface was not exposed in this subagent's callable tool set. The configured native web-search backend also reported that it could not execute client-side; Hermes search returned its fallback results. Those searches were restricted to Synthesia domains, and claims below were checked against the actual official pages, official documentation Markdown/OpenAPI definitions, and the DPA PDF linked directly by Synthesia's legal page. No third-party commentary is evidence. This report does **not** claim the `web.run` requirement was met. Retrieval date is the date above; source dates are noted where material. Raw retrieved text is retained in the adjacent `p5-synthesia-evidence/` directory. Sources and short verbatim excerpts are appended by the citation ledger.

**Legend:** VERIFIED = supported by an official source, not live-tested. UNKNOWN = not verified in the retrieved documentation; not a claim that a capability does not exist. CONDITIONAL = proposed Tanaghom decision, not a vendor guarantee. Legal interpretation is diligence, not legal advice.

## 1. P5 decision: conditional candidate, not primary paid-campaign provider

- **Paid-advertising blocker:** The July 23, 2026 licensing policy groups Stock **and Synthetic avatars and voices** together and prohibits paid TV, Facebook, Instagram, YouTube, TikTok/Snapchat, programmatic advertising and any paid promotion. Organic posts, website product videos and training are listed as permitted. Custom-avatar use instead depends on the individual's agreement and free, informed consent.[22]
- **Legal-policy distinction:** The Acceptable Use Policy specifically restricts paid/promoted/boosted social or similar advertising with a Stock Avatar unless Synthesia gives express written consent; Custom Avatars require appropriate individual consent. The help policy is broader: it expressly includes Synthetic avatars **and voices** and paid TV/programmatic promotion. The written-exception route in the AUP is not evidence that any exception is granted to Tanaghom, or that Synthetic voices are cleared.[20][22]
- **Decision (inference):** Do not recommend Synthesia as Tanaghom's primary campaign-to-revenue renderer on standard stock/synthetic licensing. At most, retain it for permitted organic/product/training use, or condition paid campaigns on a written commercial agreement expressly covering the chosen avatar **and voice**, channel, paid promotion, client distribution and consent scope.[20][22]
- **Second blocker:** Personal Avatars available in the editor are not automatically available to the offline Video API. The avatar-type guide explicitly limits API compatibility to Express-1 stock, Legacy stock and Custom Studio avatars. Its table marks both photo-based and legacy video-based Personal Avatars as not API-compatible. A Custom Studio avatar is a distinct product, not a synonym for a Personal Avatar.[38]
- **Decision (inference):** A paid-campaign API path would need both a supported Studio/custom identity and contractual ad rights. Generic create-video language accepting a custom avatar is insufficient proof that a photo-based Personal Avatar works.[1][38]
- **Contract separation (proposal):** Evaluate only the offline Legacy v2 talking-head renderer here. Uploaded narration can make this an audio-in/video-out workflow; it does not establish an arbitrary existing-video lip-sync API. Do not reuse its identity, limits or billing contract for Dubbing, Interactive Avatars or a TTS platform.[30][34]

## 2. Exact offline Video API contract

The documentation now identifies this surface as **Legacy (v2)**. Use a Legacy-scoped API key in the `Authorization` header, not an Interactive Avatars key. API keys and webhook subscriptions belong to an account rather than the whole workspace.[4][16]

### 2.1 Verified endpoints

| Operation | Exact method and URL | Documented result / caveat |
|---|---|---|
| Create video | `POST https://api.synthesia.io/v2/videos` | OpenAPI success `200`; returns a VideoResponse. Root `input` is required.[1] |
| Create from template | `POST https://api.synthesia.io/v2/videos/fromTemplate` | Success `201`; `templateId` and `templateData` required.[3] |
| Read job/video status | `GET https://api.synthesia.io/v2/videos/{video_id}` | Success `200`; video UUID and status are returned.[2] |
| Delete video | `DELETE https://api.synthesia.io/v2/videos/{video_id}` | Success `204`. Documented as deletion, **not** cancellation.[27] |
| Subscribe webhook | `POST https://api.synthesia.io/v2/webhooks` | Success `201`; body requires `events` and `url`; secret returned on creation.[7] |
| List webhook subscriptions | `GET https://api.synthesia.io/v2/webhooks` | Success `200`.[28] |
| Retrieve subscription | `GET https://api.synthesia.io/v2/webhooks/{webhook_id}` | Success `200`.[8] |
| Delete subscription | `DELETE https://api.synthesia.io/v2/webhooks/{webhook_id}` | Success `204`; this does not cancel a video.[9] |
| Upload narration | `POST https://upload.api.synthesia.io/v2/scriptAudio` | Success `200`; uploaded MP3 returns an asset ID. This was not executed.[30] |
| Check uploaded asset processing | `GET https://api.synthesia.io/v2/assets/{user_media_asset_id}` | Asset processing must finish before narration can be used.[31][30] |
| Upload image/video background asset | `POST https://upload.api.synthesia.io/v2/assets` | Separate image/video asset route; not the narration route.[11] |
| Cancel an in-progress render | **UNKNOWN** | No cancellation operation verified in the current index or endpoint definitions. Do not relabel DELETE as cancel.[27][34] |
| Idempotent create / deduplication endpoint or header | **UNKNOWN** | No documented idempotency key, replay window or exactly-once create semantics verified. `callbackId` is correlation metadata, not an idempotency guarantee.[1][3][34] |
| Create Personal/Studio avatar via this API | **UNKNOWN** | No offline v2 avatar-creation endpoint verified in the public index; retrieved creation instructions describe human/editor submission.[14][34][39] |

### 2.2 Inputs and model of a job

- Each `input[]` scene has required `avatar` and `background`. Narration is `scriptText`, with a selected voice at `input[].avatarSettings.voice`, or `scriptAudio` with required `scriptLanguage`. The latter uses an uploaded audio ID, not an arbitrary audio URL. Set voice explicitly: the default can change.[1]
- Root properties include `aspectRatio`, `callbackId`, `folderId`, `test`, `visibility`, title and description. Private is the documented visibility default; a supplied folder inherits permissions. For a governed integration, set privacy/folder intentionally rather than assuming inherited access is appropriate.[1]
- **Proposed local representation:** keep provider job UUID, local request UUID and correlation metadata separate. Prevent duplicate dispatch locally; after an ambiguous network failure, reconcile before retrying because server idempotency is UNKNOWN.[1][2]

### 2.3 Status and webhook semantics

The retrieve schema enumerates `complete`, `deleted`, `error`, `in_progress`, `rejected`, `approved`. Narrative documentation describes `rejected` as moderation rejection, and makes `download` and `duration` available only when complete. Do not treat `approved` as a downloadable terminal success.[2][37]

The Quickstart says creation starts processing immediately, gives a typical 3–5 minute example, and downloads a completed result as `.mp4`. This is guidance, **not** a latency SLA.[5]

Verified webhook event names are only `video.completed` and `video.failed`; the latter documents `error` status and a failure message. Completion is not emitted for a template preview. A distinct moderation-rejection webhook is **UNKNOWN**; retain status polling/reconciliation rather than assuming rejection is a `video.failed` event.[29]

Delivery is HTTP POST to the subscriber URL. Synthesia accepts a non-error `1xx`, `2xx` or `3xx` within six seconds; a failed delivery is retried twice within a ten-minute window. Secret availability is limited to webhook creation.[6]

Signature verification uses `Synthesia-Signature`, `Synthesia-Timestamp`, and HMAC-SHA256 over `timestamp + "." + raw request body`, keyed by the webhook secret. The guide suggests a timestamp tolerance for replay protection and recreating a compromised subscription.[10]

**Proposed runtime controls:** verify signatures with constant-time comparison, enforce freshness, deduplicate events locally, acknowledge promptly, persist before processing and periodically reconcile jobs. These controls are recommendations; ordering, exactly-once delivery, event IDs and durable replay endpoints remain **UNKNOWN**.[6][10][29]

## 3. Stock, Personal and Studio avatar access

| Avatar class | Editor availability versus offline API |
|---|---|
| Express-1 stock / Legacy stock | Explicitly API-compatible; supported stock IDs are published in the API catalog.[32][38] |
| Express-2 stock | Explicitly not API-compatible in the avatar-type guide.[38] |
| Synthetic stock / customizable Express-2 or Express-3 | Guide marks these not API-compatible; editor customization is not offline API support.[38] |
| Personal Avatar from photo | Photo-based digital twin, customizable in the editor. Not API-compatible in the guide's matrix.[14][38] |
| Personal Avatar from video (Legacy) | Editor route with recorded footage; not API-compatible in the guide's matrix.[38] |
| Custom Studio Avatar / Express-1 | Explicitly API-compatible. Paid filmed-footage product, separate from Personal Avatar allowance.[38][39] |

**Plan availability:** the pricing page advertises 125+ stock avatars on Starter, 180+ on Pro and 240+ on Enterprise; Personal Avatar allowances are 3 / 5 / unlimited subject to reasonable consumption and compute, respectively. These are editor/plan entitlements, not a guarantee that all listed identities can be rendered over v2.[15][38]

**Identity portability:** avatar IDs can be copied in the editor and the API stock catalog lists supported IDs. Generic avatar-management documentation says copying an ID is useful for API references, but that instruction does not override the explicit compatibility matrix.[32][36][38]

**Create access:** Personal Avatar creation includes photo/footage submission and live consent. Public v2 REST creation access, consent-recording ingestion endpoints and programmatic avatar approval/status/deletion contracts are **UNKNOWN**. Studio creation follows a filmed-footage submission process; do not invent a REST onboarding route.[14][34][39]

**Studio cost qualification:** the pricing page describes a $1,000/year Express-1 Studio add-on for annual-plan users, with processing up to ten days. The avatar-type guide describes $1,000 per avatar for self-submitted footage on annual Starter and above or Enterprise. Confirm renewal, included voice and account availability in writing before estimating lifetime cost.[15][38]

## 4. Script, custom audio and Arabic evidence

**Audio-in talking head is verified:** the upload-script-audio page expressly permits uploading narration from another text-to-speech engine and using it instead of the Synthesia script. The documented file is MP3 with `Content-Type: audio/mpeg`; the OpenAPI representation labels the raw binary field under `application/json`, a documentation inconsistency to resolve before implementation. It asynchronously processes assets; early generation with an unprocessed ID fails.[30]

**Do not infer a generic lip-sync service:** this route renders a Synthesia avatar from narration; verified inputs do not establish uploading any arbitrary existing face video and swapping its audio. Dubbing is a separately indexed API and needs its own provider-neutral contract and diligence.[1][30][34]

### 4.1 Explicit language / locale support

The script-audio language enum explicitly includes `ar-DZ`, `ar-BH`, `ar-EG`, `ar-IQ`, `ar-JO`, `ar-KW`, `ar-LY`, `ar-MA`, `ar-QA`, `ar-SA`, `ar-SY`, `ar-TN`, `ar-AE`, `ar-YE` and `ar-001`. These are accepted language identifiers, not an independently verified accuracy claim.[1]

The API voice catalog labels Arabic regional voices for **Algeria, Bahrain, Egypt, Iraq, Jordan, Kuwait, Libya, Morocco, Qatar, Saudi Arabia, Syria, Tunisia, United Arab Emirates and Yemen**, plus **Arabic (World)**. Selected explicit IDs are below; there is no need to rely on a generic multilingual marketing claim.[13]

| Catalog locale | Documented selection | Exact voice ID |
|---|---|---|
| `ar-EG` | Female, Natural | `dc1e83d6-e785-4239-92a3-a4ec77c4e4d3`[13] |
| `ar-SA` | Male, Natural | `c1da2241-c031-4e53-af2e-a91121e5ca9f`[13] |
| `ar-001` | Male, Grounded | `b799bd55-98e7-452c-86c6-eaa3e912a6d1`[13] |

The **translation** language table separately lists generic Arabic and Bahrain, Egypt, Iraq, Jordan, Kuwait, Libya, Morocco, Qatar, Saudi Arabia, Syria, Tunisia, UAE and Yemen. Algeria is present in the API voice/audio lists but not in the retrieved translation table. Do not merge those surfaces into one capability promise.[12][13]

Arabic is explicitly listed for voice-clone creation, and voice cloning is described as available on all plans, with some other languages Enterprise-only. This does not verify Arabic clone availability for a particular v2 job or entitlement.[33]

**UNKNOWN:** dedicated Modern Standard Arabic quality guarantee; colloquial Egyptian/Gulf/Levantine/Darija accuracy; Lebanese or Palestinian locale; named Saudi subdialects; diacritics, mixed Arabic/English, pronunciation control and measured Arabic lip-sync quality. A country label is not proof of dialect fidelity. No samples were generated or judged; any adoption needs an authorized Arabic-language acceptance evaluation.

## 5. Bounds, output format and retention

| Requirement | Verified fact or explicit gap |
|---|---|
| General video limits | Editor creation docs: at most **150 scenes**, **5 minutes per scene**, **4 hours total**. This is a general product limit; API-specific equivalents are **UNKNOWN** because v2 schema does not publish those cardinality/duration bounds.[35][1] |
| Minimum / maximum narration upload | MP3 is verified; byte limit, min/max seconds, sample rate, channels and bitrate are **UNKNOWN** for the script-audio endpoint.[30] |
| API script character / scene array limit | **UNKNOWN**; no `maxLength` / `maxItems` enforcement contract verified in the create schema.[1] |
| Aspect ratios | Create schema: `16:9`, `9:16`, `1:1`, `4:5`, `5:4`; default `16:9`.[1] |
| Render resolution | Help download policy states Full HD **1920×1080** for MP4. Exact API dimensions for portrait/square, selectable v2 resolution, 4K generation and upscaling are **UNKNOWN**.[44][1] |
| FPS / output codecs | **UNKNOWN** for generated v2 video: no verified FPS, video codec, audio codec, profile, color space, bitrate or alpha-channel contract. MP4 is a container, not proof of H.264/AAC.[5][44] |
| Studio input recording, NOT output | Filmed Studio requirements mention H.264/MP4, less than 2 GB per video, minimum 2 minutes, UHD 3840×2160 and 29.97/30 FPS. Do not substitute these for generated-output guarantees.[39] |
| Result download | MP4 via time-limited `download` URL once complete. Exact URL TTL, storage SLA and automated asset expiry are **UNKNOWN**.[5][37] |
| Background transparency | Product guide describes transparent backgrounds for certain avatar types; create docs mention green-screen replacement. This does not establish an alpha-capable output codec.[1][38] |
| Generated-video retention | Retained account content is user managed; no universal auto-expiry TTL verified. Deletion/termination rules below are not normal successful-job retention guarantees.[40][46] |

### 5.1 Deletion and retention cannot be represented as one TTL

- A July 24, 2026 video-deletion article describes a **30-day trash** restore window, then permanent removal including backups; explicit permanent deletion is also available. Deleted-video credits are not returned.[40]
- The July 22 deletion-request article says avatar/video/voice data is fully removed **within 90 days** of a request, with written confirmation, and similarly within 90 days after termination without a specific request. Avatar-credit reallocation is not a refund of video-generation credits.[43]
- The legal Security Practices page also gives **up to 90 days** for requested/account deletion, but says residual backup copies may remain until backup lifecycle purging. It also describes MP4 retrieval assistance for up to 90 days after the relationship ends and security-log storage up to four years.[46]
- The DPA clause 7.2 says destruction **after 90 days** following termination, subject to contractual/security limitations and lawful retention, unless return is requested before the period expires.[42]
- **Conflict / qualification:** do not promise all-system erasure after 30 days, instantaneous deletion, or a fixed backup purge deadline. Different pages describe different triggers and make inconsistent backup claims. Exact backup-erasure deadline, consent-recording retention, uploaded-audio TTL and API DELETE-to-trash versus permanent behavior are **UNKNOWN** pending contractual clarification.[27][40][43][46]

## 6. Current pricing, API floor, usage and billing uncertainty

### 6.1 Date-sensitive plan correction

The October 1, 2026 plan-change article says **Creator was renamed Pro**, with the same price/features; Pro includes 6,000 paid-plan credits plus 500 base credits, and the new Pro multipliers add 12,000 / 24,000 / 36,000 / 48,000 plan credits. Each plan has ten minutes of included video/dubbing; API video consumes **160 credits/minute**. Annual plans receive the year's credits at start/renewal, monthly plans monthly.[17]

The October 8 Video API Introduction now explicitly states **Pro or above**, while the API help article still says Creator and Enterprise for Legacy v2. Read the latter's Creator label in light of the October 1 rename; do not quote the all-plan Interactive API entitlement as offline Video API access.[4][16][17]

| Plan, displayed USD monthly billing | Price on retrieved pricing page | Offline v2 eligibility |
|---|---|---|
| Basic | $0 | Not verified / below documented floor.[15][4] |
| Starter | $29/month | Below documented floor.[15][4] |
| Pro | $89/month | Minimum documented plan.[15][4] |
| Pro expanded paid-credit tiers | 12,000: $176; 24,000: $347; 36,000: $514; 48,000: $676/month | Pro-level floor applies; confirm offer.[15][4] |
| Enterprise | Custom quote | Eligible; purchased allowances govern.[15][4] |

**Pricing caveats:** annual subscription dollar prices, taxes/region-specific quotes, overage rates, dedicated credit purchases, exact application of the ten included minutes to API renders, and any negotiated API allowance are **UNKNOWN**. The pricing comparison still contains a 360-minutes/year API line; its relationship to the new 160-credit/minute model is not reconciled by the retrieved pages. Do not advertise the UI's approximate Pro video minutes or Enterprise unlimited-video wording as unlimited API rendering.[15][17]

### 6.2 Verified rate limits, not concurrency

Per endpoint, the current API introduction lists:[4]

| API tier | Write requests | Read requests |
|---|---|---|
| Tier 3 — Pro | 60/min; 300/hour; 1,000/day | 60/min; 20,000/day |
| Tier 2 — Enterprise | 80/min; 400/hour; 2,000/day | 80/min; 40,000/day |
| Tier 1 — Enterprise | 120/min; 600/hour; 3,000/day | 120/min; 80,000/day |

Excess requests return `429` with `RateLimit-Limit` and `RateLimit-Reset` in seconds. Test creation is limited to 30 videos/day.[4]

**UNKNOWN:** offline render concurrency, simultaneous accepted/processing jobs, queue capacity, per-avatar parallelism, queue latency/SLA and Enterprise tier assignment. Requests/minute are not concurrency. Interactive session limits were not researched or substituted.

### 6.3 Failure / moderation billing

- `test: true` is documented as free, watermarked and excluded from quota; no tests were executed.[1][3]
- **UNKNOWN:** whether failed renders, moderation rejections, partial renders or retries consume/refund credits, reserve usage before processing, or bill per started/rounded minute. No per-job failure/moderation credit rule was verified. A moderation warning before generation is not a guarantee of zero charge after rejection.[17][23]
- General purchases are non-cancelable/non-refundable except contractual exceptions; billing help directs Enterprise customers to their Order Form and offers case review for confirmed technical-access failures. That is not a failed-render credit refund policy.[45]
- Deleting generated content does not restore its used credits.[40]

## 7. Ownership, training, biometrics and consent

### 7.1 Ownership / usage / training

Customer Terms define Customer Data as input/output and say the customer owns it, excluding Synthesia components/content. Synthesia retains its own content and IP; its embedded-content licence continues after subscription subject to compliance. Customer grants limited-term rights needed to provide, maintain and improve the service. The AI-improvement section prohibits use beyond prior written customer instructions and relevant individual's consent, and prohibits independent model development outside the Services; it does **not** state a universal ban on improvement/fine-tuning of AI integrated with the used Services. Avatars cannot be exported.[18]

**UNKNOWN:** an account-wide no-training toggle; whether selected customer recordings are used for shared model improvement in practice; per-plan training opt-out/default; model unlearning or deletion of trained weights. Require contractual answers instead of advertising unconditional no-training or fully portable avatars.[18]

### 7.2 Live consent and the operational revocation gap

- Photo-based Personal Avatar creation requires live consent video from the same person as the submitted image; recorded consent cannot simply be uploaded. Voice cloning similarly requires live consent audio, a biometric checkbox and randomized passphrase.[14][33]
- Photo-avatar moderation additionally says the person must create/submit their own avatar: submitting on behalf of another is prohibited even with permission. Use human self-service onboarding, not an agent submitting a client's headshot.[25]
- The governance guide distinguishes Talent, Owner, User and Approver; it describes consent, access control, permission revocation and takedown. It also says previously generated videos continue to exist after avatar deletion, and shared avatars can remain usable after their original user's departure until access is revoked.[41]
- Owners can remove access in the editor; Personal/custom avatars can be deleted there, but Studio deletion requires support. Removing access does not retroactively remove the avatar from already-generated videos; regeneration/republication is needed for changed content.[36]
- Voice deletion similarly prevents future use but does not remove the voice from videos already generated.[33]

**Provider-neutral consent proposal:** store independent scopes for likeness, voice clone, uploaded narration, commercial use, paid advertising, publication channels, named client/tenant, territories, duration, onward distribution and any training permission. Recheck scope before dispatch **and publication**. Revocation must block new work immediately locally, quarantine pending/results, revoke provider access, request deletion and track confirmation. Separately locate and retract previously distributed artifacts. Provider avatar deletion alone is not downstream revocation.[22][36][41]

**UNKNOWN provider contracts:** machine-readable consent record/schema; consent-record download/export; immutable receipt; scope enforcement API; immediate revocation SLA; avatar/voice deletion API; callbacks for consent withdrawal; propagation to downloaded/copied video and backups.

### 7.3 Biometric treatment

Privacy Policy expressly addresses facial geometry/voiceprints extracted from Samples and Verification Recordings, identity comparison/authenticity/fraud checks and biometric consent. It treats unique identification as GDPR special-category processing. Avatar-creation biometrics are retained while the avatar is available or as the customer instructs; authentication-comparison data normally lasts only minutes until confirmation. Relevant biometrics are then destroyed, with lawful-retention exceptions, and vendors are required to do likewise. Manual Studio verification is described as an alternative. The policy says biometric data is not sold, leased or traded and provides consent-withdrawal/erasure rights.[19]

**UNKNOWN:** exact consent-video/audio TTL, proof of deletion, derived-model retention after withdrawal, regional biometric-processing guarantees and latency from withdrawal to blocked generation.[19]

### 7.4 DPA and a material special-category inconsistency

Synthesia's legal page links a pre-signed DPA PDF dated July 22, 2026. It describes Customer as controller/business and Synthesia as processor/service provider; instructions-only processing, no sale/share/cross-context advertising, equivalent subprocessor protections, data-subject assistance, incident notification without undue delay and 30-day subprocessor objection rights. Clause 7.1 gives the DPA precedence on conflicting personal-data processing terms; 7.2 handles termination return/destruction after 90 days. The execution instructions require a valid signed submission unless the Agreement provides otherwise.[21][42]

**Critical inconsistency:** Schedule 1 says special categories under GDPR Article 9 will **not** be processed, while the Privacy Policy describes biometric identity verification potentially falling within special-category processing. Do not assume the public DPA automatically covers the chosen biometric onboarding flow. Require clarification of roles, legal basis, Article 9 coverage, subprocessors, transfer safeguards and any bespoke schedule before client/talent onboarding.[19][42]

An executed DPA for Tanaghom, processor geography commitments and a customer-specific no-training/deletion annex are **UNKNOWN**; nothing was signed or submitted.

## 8. Public figures, impersonation and moderation

Photo-avatar moderation flags public figures, celebrities and executives, unclear likeness rights, and mismatches between photo and live consent. It requires direct submission by the subject and can reject/escalate impersonation.[25]

The impersonation policy prohibits misleading representations of public figures, employees or stock actors; it asks users not to present stock actors as holding personal opinions, preferences or experiences. Real employee representations should use the person's appropriate avatar and clear framing, not a stock spokesperson pretending to be them.[26]

The AUP prohibits misleading impersonation in its specified non-Enterprise wording and violations of privacy/publicity/IP rights. Its Enterprise qualifier is **not** verified permission to impersonate a public figure or bypass photo moderation; bespoke permissions remain **UNKNOWN**.[20][25]

Moderation applies to voice-only content too. Stock-avatar factual/neutral scripts can still be restricted for politics, health, legal or sensitive topics; disclaimers may not override restrictions. Custom identity is not a blanket policy exemption.[23]

## 9. Required commercial answers before any recommendation or execution

1. **Ad rights:** written approval covering stock/synthetic/custom identity, voice, paid channels, TV/programmatic/social, sublicensing/client distribution and territories; resolve AUP/help-policy scope.
2. **Identity access:** exact supported avatar type/model and ID, API entitlement, Studio onboarding/renewal cost; no assumed Personal Avatar API access.
3. **Job semantics:** cancel support or absence, ambiguous-create reconciliation/idempotency, rejection notifications, render concurrency/queue SLA.
4. **Billing:** 160-credit/minute application, included-minute usage, legacy 360-min/year line, rounding, reservation/refund rules for failure/moderation/cancellation/retry.
5. **Media:** enforced API duration/scene/text/audio bounds; portrait dimensions; FPS/codecs; download TTL and input/output retention.
6. **Consent / privacy:** talent-specific commercial scopes, immediate revocation behavior, retained generated videos, recording/model/backup deletion and evidence; reconcile Article 9 processing against DPA Schedule 1.

**Final conditional classification:** credible documented offline video API for permitted use, but **not cleared as a primary paid-campaign provider**. Arabic locale/voice options are explicitly documented; dialect and lip-sync quality are unevaluated. Identity compatibility, ad licensing and revocation/deletion semantics are decision gates rather than implementation details.

## Sources

<!-- Populated mechanically from p5-synthesia-ledger.json, with short verified excerpts. -->
