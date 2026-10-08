# P2a Provider/Engine Decision Record (Phase A)

Date: 2026-10-08. Verified live this date; re-verify at procurement.
Status: accepted for P2a scope (bounded non-production test only).
Escalation rule from #229 applies: AGPL / non-commercial / ambiguous /
materially revenue-restricted selections STOP integration.

## Decisions

### 1. Text-to-image: HTTP provider adapter, allowlisted endpoints

| Field | Value |
|---|---|
| Capability | `image` text-to-image (+ image-to-image redux where offered) |
| Primary endpoint | `fal-ai/flux/schnell` via fal.ai (`POST https://fal.run/fal-ai/flux/schnell`) |
| Weights lineage | FLUX.1 [schnell], 12B flow transformer, 1–4 steps |
| License (weights) | **Apache-2.0** (verified on HF `black-forest-labs/FLUX.1-schnell`, Jan 2026 note) |
| Commercial use | Allowed, personal/scientific/commercial; fal states commercial rights included |
| Revenue restrictions | None on weights; API billed per use (see cost) |
| Redistribution | Apache-2.0 terms for weights; API outputs per fal terms |
| Output rights | fal: commercial usage rights included; billed only for successful outputs (5xx never billed, queue time free) |
| Self-host vs API | API for P2a (no GPU here); self-host path reserved (weights Apache-2.0, needs ~24GB VRAM class) |
| Min/recommended VRAM (self-host) | 24GB+ (12B model, bf16) — not provisioned in P2a |
| Expected latency | Sub-second–seconds via API (4 steps) |
| Cost unit | **$0.003 per megapixel**, rounded up per MP (fal schnell page + platform pricing API) |
| Arabic relevance | Prompt accepts Arabic; raster Arabic text NOT trusted (P2b overlay rule) |
| Fallback | BFL API schnell (vendor-direct, same Apache-2.0 weights); then DeepInfra schnell (~$0.0005×MP×iters) |
| Reason selected | Only commercial-clean open-weights family with a keyed API, documented per-MP pricing, and no subscription; ideal allowlist seed |

Rejected for self-host/integration: **FLUX.1-dev family** — `flux-1-dev-non-commercial-license`
(non-commercial, non-production; verified on HF + `black-forest-labs/flux`
`model_licenses/`). A paid BFL commercial license exists but is out of P2a
scope. Never downloaded, never integrated.

Reference alternative (not integrated): SD 3.5 Large under Stability
Community License (free incl. commercial <$1M annual revenue, outputs
owned; 8B params / 16.5GB weights; gated HF; Enterprise license above
$1M). Kept as a documented second allowlist candidate for later phases
because the revenue threshold needs a business decision first.

### 2. Segmentation (product cutout): interface reserved, integration deferred

| Field | Value |
|---|---|
| Candidate | BiRefNet (`ZhengPeng7/BiRefNet`), 445–885MB weights |
| License | **MIT** (code + weights, verified on GitHub + HF `license: mit`) |
| Commercial/revenue/redistribution | None (MIT) |
| Self-host vs API | Self-host (Python/torch or onnxruntime); provider-API option recorded |
| VRAM | GPU recommended; CPU viable but 30–60s+ per image |
| Decision | **Deferred**: no GPU/python host in P2a scope. P2a product flow uses alpha/mask inputs + sharp composition. Adapter operation name reserved: `segment`. |
| Fallback | fal/Replicate-hosted BiRefNet endpoints (keyed, stub-tested pattern) |

Explicitly excluded: RMBG/BRIA (non-commercial) — never integrated.

### 3. Relight: sharp relight-lite now, model later

- P2a executes brightness/saturation/gamma modulation + white-balance-ish
  temperature shifts via sharp (Apache-2.0, already pinned at 0.35.5).
  Deterministic, CPU, audited parameters in provenance.
- IC-Light (Apache-2.0 code, verified prior research) recorded as the
  future model-based relight option; needs GPU host decision. Not integrated.

### 4. Enhance/upscale: sharp now

- Lanczos resize + optional sharpen/median via sharp; kernel and scale
  recorded in provenance. No model upscale in P2a.

### 5. Object storage: SigV4 S3 adapter, no MinIO

| Field | Value |
|---|---|
| Interface | `put` (conditional create), `get`, `delete`, `signPreview` (presigned GET), byte caps, key-shape enforcement |
| Backend implemented | Generic S3 REST + SigV4 (undici fetch, zero new deps) |
| Test double | Disposable S3-compatible harness in CI (no credentials) |
| MinIO | **Excluded**: AGPLv3 (verified; repo archived Apr 2026, moved to AIStor). Per stop rule, no MinIO code/image/dependency anywhere, including test-only use without explicit approval. |
| Buckets | Private only; no ACLs; no canonical public URL |
| Why SigV4 by hand | Avoids `@aws-sdk/*` dependency weight + audit surface; verified against official AWS signing test vectors in unit tests |

### 6. What executes for real in P2a CI

- sharp pipeline: source bytes → scene composite → relight-lite → enhance →
  validated PNG/JPEG → checksum → private test storage → version row.
- HTTP adapter: full metering/retry/validation path against an in-repo
  stub provider (fal-schnell-shaped), including 429/timeout/malformed/
  cancellation/indeterminate cases. No key, no egress beyond localhost.
- Vendor pixels: NOT executed (no key/GPU) → lane status
  **external acceptance pending**, recorded in evaluation, never claimed
  certified.

## Cost/latency evidence collected in P2a

- Local pipeline: measured ms + byte counts per case (evaluation ledger).
- Provider: fal pricing API shape ($0.003/MP schnell) used for estimate
  display; no charges incurred (zero provider calls leave localhost).
