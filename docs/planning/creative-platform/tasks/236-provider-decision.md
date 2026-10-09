# Task 236 — generative video provider decision (fresh, 2026-10-09)

Status: decided from current official sources; no credentials exist.
Predecessors: `tasks/229-provider-decision.md` (P2a image precedent:
fal-ai/flux/schnell), ADR 0025.

Rule followed: nothing integrated from memory or prior research. Every
row below comes from official documentation or the documented absence
of it, verified 2026-10-09. Where official terms could not be verified,
the candidate is rejected (not escalated — the rejection is itself
evidence-backed), except where noted as an acceptance gap.

## Decision matrix

| # | Provider / model | Endpoint / model ID | t2v | i2v | Ref video | Duration / res | Audio | Async / cancel | Pricing | Failed/moderated charged? | Commercial / output rights | Retention / training | Result origins | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Google Veo 3.1 (Gemini API) | `generativelanguage.googleapis.com`, `veo-3.1-generate-001` (GA 2025-11-17), Fast/Lite variants | Yes | Yes (first/last frame, ≤20MB) | 3 ref images | 4/6/8s; 720p/1080p/4K; 16:9+9:16; 24fps; MP4 | Native, always on | LRO poll (`operations.get`); generic `operations.cancel` exists, Veo-specific cancel unconfirmed | Std $0.40/s (720p/1080p), $0.60 4K; Fast $0.10/$0.12/$0.30; Lite $0.05/$0.08; 8s 1080p ≈ $3.20/$0.96/$0.64 | Docs FAQ: 400/500 failures not charged (token framing; video-second treatment presumed same, not explicit) | Permitted; Google claims no ownership; paid tier not used for training (ToS verified) | Paid: no training use; unpaid trains | Download shape (Files API vs signed URL) not fully verified | NOT SELECTED: highest cost, fixed ~8s, forced audio (out of scope), unverified download shape |
| 2 | Kling v3 official (kling.ai API) | `api-singapore.klingai.com`, `kling-v3` / `kling-v3-turbo` / `kling-v3-omni` | Yes | Yes (first, first+last) | Yes (omni) | 3–15s; 720p/1080p/4K; 16:9+9:16+1:1; MP4; audio optional | Task create → query by ID/cursor; `callback_url`; statuses submitted/processing/succeeded/failed; NO cancel endpoint found | 1 unit=$0.14; v3 ≈0.9–1.2 u/s ($0.13–0.17/s); turbo 0.8–1.0 u/s; prepaid, non-refundable recharges | Failed-task deduction NOT documented → ambiguous | Unrestricted incl. derivatives (paid ToS §6.4, verified); IP-infringement risk warning | Results cleared after 30 days (must persist promptly — matches our design) | kling CDN (`*.klingai.com`, `*.inkwai.com`), anti-leech URLs | FALLBACK: full capability fit, clear commercial terms, but failed-billing ambiguity + no cancel keeps it second |
| 3 | ByteDance Seedance 2.x | None found (official) | — | — | — | — | — | — | — | — | — | — | — | REJECTED: no official API surface exists; only third-party resellers found. Terms unverifiable by construction |
| 4 | MiniMax H3 official (platform.minimax.io, pay-as-you-go) | `api.minimax.io`, `/v2/video_generation`, `MiniMax-H3` (H3 Max variant: 480P/768P fast) | Yes | Yes (first/last frame) | Yes (≤9 img, ≤3 video, ≤3 audio, 12 files) | 4–15s ints; 768P/2K (H3); 24fps; MP4; audio optional (we use silent) | `task_id` + poll query endpoint; NO cancel endpoint documented | H3 768P **$0.08/s**, 2K $0.13/s (official paygo page, verified); H3 Max ≈$0.06/s via fal listing | **Explicit: failures and security-review blocks are NOT deducted** (official packages doc, verified) | Permitted; **as between customer and MiniMax the customer retains ownership rights in input and generated content** (current Open Platform ToS, reviewed); **MiniMax may use input and generated content to provide, maintain, develop, and improve the Services** — recorded below as a privacy acceptance gate | Training/retention beyond the improvement-use clause: see privacy gate | Result URL host verified at acceptance time; allowlist pinned then | **SELECTED PRIMARY**: only candidate with written failed-billing rule + paygo + async fit + cheapest first-party rate |
| 5 | Alibaba Wan 3.0 (Model Studio/DashScope) | workspace-scoped `maas.aliyuncs.com` endpoints, preview status | Yes | Yes (first/first-last) | Yes (≤10 img, ≤5 video) | 2–30s @30fps; ≤1080p; audio toggle; watermark flag (default off) | `X-DashScope-Async`; task query | Console pricing only (credits); third-party: failed tasks refunded (unofficial) | Official failed-billing text not found | 2.x weights Apache-2.0; 3.0 preview terms unclear | Unverified | Unverified | NOT SELECTED: preview status, workspace-scoped endpoints, console-only pricing, unclear 3.0 terms |
| 6 | Lightricks LTX (ltx.io API) | `/v2/*` async + `/v1/*` sync; 2.3 Fast/Pro, 2.5 | Yes | Yes | Retake/extend | 6–20s; 720p–4K; 25/50fps; audio | Async + sync; cancel unconfirmed | Fast $0.03–0.06/s tiers (verified); Pro higher | Unverified | Commercial use stated (vendor page); open weights under community (non-Apache) license | Unverified | Unverified | NOT SELECTED: weight-license friction + endpoint deprecation churn (19B retires 2026-08-15); revisit if primary fails acceptance |

## Selection

- **Primary: `MiniMax-H3` via `https://api.minimax.io/v2/video_generation`** (pay-as-you-go). 768P silent clips, 4–15s integers, t2v + first-frame i2v for P4. Estimated cost helper: `duration_s × $0.08/s` (768P).
- **Fallback: `kling-v3-turbo` via official Kling API** (720p/1080p, 3–15s, ~$0.11–0.14/s). Config-carried as disabled; promotion requires its own acceptance note on failed-billing ambiguity.
- **Reference video: out of scope for P4 execution** (capability exists in provider; we do not submit reference inputs in this slice).

## Cancel and reconciliation policy (no provider cancel endpoint)

Neither candidate documents a provider cancel endpoint, so:

- Local cancel with NO task_id: job closes cancelled, no provider
  contact, no call row. Nothing remote can exist.
- Local cancel WITH a live task_id: polling CONTINUES until the
  provider reports terminal truth or the poll budget runs out. Success
  is persisted as draft output with full cost + provenance (charged
  work is never silently dropped); the job still closes cancelled so
  the user's intent stays visible. The provider attempt is NEVER
  marked `cancelled` unless the provider reports `cancelled`.
- Poll timeout without cancel: attempt finished `indeterminate`, job
  requeues transiently, and the next pass resumes the SAME anchored
  task_id — never a new create.
- Anchor rule: at most one provider task per Tanaghom job. Retries
  query the anchored id; started/indeterminate attempts without an
  anchor refuse deterministically. The sole re-create allowance is a
  capacity/deterministic rejection that provably never started remote
  work. Deliberately stricter than required: even indeterminate
  creates (no id ever returned) are never retried, because the
  request may have been accepted remotely.

## Recorded gaps (external acceptance, not merge blockers)

1. ~~MiniMax official ToS full text on output ownership + training/retention: verify before production credentials.~~
   RESOLVED (terms recorded, acceptance still gated): the current MiniMax
   Open Platform Terms state that as between the customer and MiniMax,
   the customer retains ownership rights in client input and generated
   content, AND that MiniMax may use that input and generated content to
   provide, maintain, develop, and improve the Services.
2. **Privacy/data-use acceptance gate (NEW, blocking for real media):**
   sending real customer prompts/assets to MiniMax means accepting the
   improvement-use clause above. Enterprise/customer-data policy must
   explicitly approve this before production credentials are created or
   any non-synthetic media leaves the boundary. No code path sends
   customer media today (stubs only); real provider flags stay OFF
   until this gate is signed.
3. Result CDN origins: pinned from live acceptance headers, allowlist updated only with evidence.
4. Credentials + explicit cost authority: absent — flags stay OFF, report EXTERNAL ACCEPTANCE PENDING.
