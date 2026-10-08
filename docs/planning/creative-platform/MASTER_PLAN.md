# Creative Platform Expansion — Production Architecture Plan

Status: PLANNING / NO PRODUCTION ACTIVATION  
Owner: Tamer  
Working branch: `plan/creative-platform-3aqel-parity`

## Objective

Add the full 3aqel-class creative capability set to Tanaghom while preserving Tanaghom's stronger governance, orchestration, audit, approval, attribution, CRM and agent-runtime model.

This is not a clone project. The target is a governed Arabic-first content-to-revenue platform that can:
- create images, product shoots, ads, carousels, logos, motion, video, talking heads, scripts, voice, music and landing pages;
- manage brand kits and reusable templates;
- price generation with credits;
- support free acquisition tools, gallery, guides, vertical solutions and affiliates;
- schedule/publish through existing governed channels;
- capture leads and continue into GHL/sales workflows;
- retain human approval before public content;
- audit every meaningful generation, edit, approval, publish and external action.

## Non-negotiable architecture rules

1. PostgreSQL remains the operational source of truth.
2. Human approval remains mandatory before public publishing.
3. n8n orchestrates workflows; it is not the customer UI or source of truth.
4. All model/tool calls use structured contracts and auditable job records.
5. External writes are idempotent, retry-safe and staging-first.
6. No secrets in repo, workflow exports, fixtures or logs.
7. Current production NO-GO remains in force until the production-readiness gates are re-evidenced.
8. SmartLabs, SmartCC and voice infrastructure remain out of scope unless separately authorized.
9. Legacy `archive/legacy-v0` is reference only; do not transplant its schema.
10. Arabic text must be rendered deterministically in UI/canvas/video layers; do not depend on diffusion models to spell Arabic correctly.

## Target capability domains

### A. Image & product studio
- text-to-image
- image editing / inpaint / relight / background removal
- product studio with scene presets and product-fidelity checks
- enhancer/upscaler
- logo generation
- white-background/export utilities

### B. Design studio
- ad creator with copy + layout
- carousel builder (6–8 slide default)
- Arabic typography, RTL, brand fonts/colors
- multi-size variants: square / portrait / landscape
- editable design JSON and deterministic exports

### C. Motion & video
- Arabic motion graphics templates
- multi-scene AI video
- product video ads
- image-to-talking-head
- captions, overlays, scene timing
- async long-running GPU jobs

### D. Voice & audio
- TTS
- voice cloning with explicit consent record
- pronunciation/tashkeel support
- music generation
- audio QC and transcription

### E. Writing & web
- script writer
- landing-page builder with RTL
- lead forms routed into Tanaghom lead capture
- vertical content presets

### F. Managed social automation
- brand setup
- content plan
- generation
- approval
- schedule/publish
- performance sync
- governed replies to comments/messages only where the current integration policy allows it

### G. Commercial surface
- subscriptions/plans
- credit ledger
- per-job cost preview
- reclaim/refund-credit policy
- gallery
- free tools
- guides / solutions / compare / best pages
- affiliate/referral ledger
- courses/community represented as product content, not hardcoded engineering assumptions

## Architecture

Introduce a bounded internal subsystem called **Creative Runtime**.

Customer/UI:
`apps/dashboard`

Business/API boundary:
`apps/dashboard/lib/server`

Canonical contracts:
`packages/contracts/schemas/creative-*.schema.json`

Canonical persistence:
`packages/database/migrations/0036_*.up.sql` onward

Runtime package:
`packages/creative-runtime/`

n8n orchestration:
`n8n/workflows/creative/`

Evaluation:
`evaluation/creative-v1/`

Runbooks:
`deployment/creative-runtime/`

Architecture decisions:
`docs/architecture/0020-*.md` onward

The runtime must expose job-oriented internal contracts, not provider-specific APIs to the dashboard.

Core logical operations:
- createImage
- editImage
- createProductShoot
- createDesign
- createCarousel
- renderMotion
- createVideo
- createTalkingHead
- synthesizeVoice
- generateMusic
- generateLandingPage

Each request returns a `job_id`. Large jobs are asynchronous.

## Canonical data model

Muse must inspect existing tenant/auth/audit patterns and extend them; do not invent a parallel identity model.

Minimum new entities:
- creative_jobs
- creative_assets
- creative_asset_versions
- creative_templates
- brand_kits
- brand_kit_versions
- credit_accounts
- credit_ledger
- provider_cost_ledger
- voice_profiles
- voice_consents
- landing_pages
- affiliate_accounts
- affiliate_events
- gallery_entries

Required characteristics:
- tenant/customer ownership
- created_by / approved_by lineage
- correlation_id / idempotency_key
- status machines, not free-form strings
- cost estimate vs actual cost
- provider/model/version provenance
- content safety / review result
- reversible migrations
- retention/deletion hooks
- no public asset URLs by default

## Storage

Binary artifacts must not be stored in PostgreSQL.
Use S3-compatible object storage with:
- private buckets;
- signed short-lived preview URLs;
- content-addressed or immutable object keys;
- thumbnails/proxies;
- asset versioning;
- retention class and deletion workflow.

## Queue and worker model

Do not run heavy media generation inside the dashboard process or long n8n synchronous requests.

Use a queue-backed worker system:
- CPU queue: canvas render, FFmpeg composition, HTML screenshot, lightweight transforms;
- GPU image queue;
- GPU video queue;
- GPU audio/talking-head queue.

Workers claim jobs with leases/heartbeats.
Required job states:
`queued -> claimed -> running -> succeeded | failed | cancelled | expired`

Retry policy must distinguish:
- transient provider/network errors;
- deterministic validation errors;
- out-of-capacity;
- user cancellation;
- policy rejection.

## Providers / engines

Provider implementations are adapters behind contracts.

Phase 1 preferred categories:
- ComfyUI-based image workflows
- BiRefNet-class cutout
- IC-Light-class relight
- deterministic React/canvas design renderer
- Remotion/Motion-Canvas-class motion renderer

Later phases:
- video generation adapter(s)
- talking-head/lipsync adapter(s)
- TTS/voice adapter(s)
- music adapter(s)

Exact model/checkpoint licenses must be re-verified immediately before production use. No checkpoint enters the production allowlist without a license record.

## Arabic/RTL rules

- UI: full RTL/LTR switch.
- Templates: logical start/end alignment, not hardcoded left/right.
- Use Arabic-capable fonts bundled/licensed appropriately.
- Preserve connected Arabic letters via browser/canvas shaping.
- Use bidi-aware line wrapping and punctuation handling.
- Arabic inside generated raster imagery is not trusted.
- Text-heavy output must use overlay/canvas/template rendering.
- Add Arabic visual-regression fixtures to Playwright/screenshots.

## Human approval and publishing

Generated assets are drafts.
No creative job may directly publish.

Publish flow:
creative job -> draft asset -> human review -> approved content/asset -> existing governed publishing boundary -> provider.

Re-check approval at execution time.
A forged webhook or stale UI state must not bypass approval.

## Security

- private runtime ingress only;
- mTLS or WireGuard/Tailscale/private network is acceptable for service-to-service transport;
- application authorization still required even on a private network;
- signed callbacks;
- strict egress allowlist where practical;
- per-provider credentials via existing vault pattern;
- malware/MIME validation on uploads;
- image/video decompression limits;
- SSRF-safe URL ingestion;
- consent records for voice clone;
- prompt/output logging must redact personal/secrets data.

Tailscale/WireGuard must never become the authorization model; they are transport controls only.

## Production rollout phases

### Phase P0 — reconciliation and design freeze
No feature coding until Muse produces:
- current-architecture map;
- affected tables/APIs/workflows;
- ADR list;
- dependency/license inventory;
- capacity assumptions;
- exact test plan;
- open questions.

### Phase P1 — Creative foundation
Deliver:
- migrations 0036+
- contracts
- job lifecycle
- object storage abstraction
- queue/worker abstraction
- audit events
- credit estimate/ledger foundation
- dashboard Creative Studio shell
- no real GPU/model call required for acceptance

### Phase P2 — Image/Product/Design/Carousel
Deliver production-quality:
- text-to-image adapter
- edit/remove-bg/relight/product studio
- ad creator
- carousel
- logo workflow
- brand kits
- preview/download
- Arabic RTL visual tests

### Phase P3 — Motion
Deliver:
- deterministic Arabic motion templates
- render queue
- captions and brand injection
- MP4 outputs

### Phase P4 — Voice/Talking Head/Music
Deliver:
- TTS
- consented voice profile flow
- talking head
- music generation
- audio/video preview
- audit and consent enforcement

### Phase P5 — Generative Video
Deliver:
- async video generation
- image-to-video/product ads
- scene planner
- cost controls
- cancellation and capacity backpressure

### Phase P6 — Landing / Growth / Free tools
Deliver:
- RTL landing builder
- lead form integration
- gallery
- free utility tools
- solutions/guides/compare/best content framework
- affiliate tracking

### Phase P7 — Managed social
Combine existing Tanaghom governance with:
- brand calendar
- generated content
- approval
- scheduling
- performance
- governed response automation

### Phase P8 — Production certification
No launch until every new gate has evidence:
- clean install/build/tests
- migration up/down on disposable DB
- tenant isolation
- object-store isolation
- idempotency/retry
- queue recovery
- Arabic desktop/mobile acceptance
- credit accounting
- provider cost accounting
- model/license allowlist
- rate-limit handling
- capacity/load envelope
- observability/alerts
- backup/restore
- rollback
- bounded real-provider staging journeys
- security review
- customer UAT/signoff

## Release strategy

Feature flags:
- creative_studio_enabled
- image_generation_enabled
- motion_generation_enabled
- voice_generation_enabled
- video_generation_enabled
- managed_social_enabled
- billing_enabled

Default off in production until corresponding acceptance evidence exists.

## Prohibited shortcuts

- no provider API calls directly from React components;
- no public S3 bucket;
- no credits stored only as a numeric user balance;
- no long polling loops in browser for unbounded jobs;
- no hardcoded provider/model IDs in business logic;
- no "success" before artifact persistence and audit commit;
- no duplicate schema outside packages/database;
- no publishing from Creative Runtime;
- no bypass of existing auth/tenant controls;
- no production activation merely because local tests pass.

## Required output from Muse before first implementation PR

Muse must answer the questions in `MUSE_REPO_RECONCILIATION.md`, then propose exact files to change and ADRs. Implementation can then proceed in bounded PRs.
