# ADR 0028: P4 generative video lane — governed provider execution

Date: 2026-10-09. Status: implemented for review under #236; not deployed.
Predecessors: `tasks/236-provider-decision.md`, `tasks/236.md`,
RECONCILIATION.md §§9/14, ADRs 0020–0027.

## Decision and scope

Text-to-video and image-to-video through ONE selected provider
(MiniMax-H3, official pay-as-you-go; Kling v3-turbo documented
fallback, disabled) with async reconciliation, cost estimates, and
reviewer approval:

1. Provider (`packages/creative-runtime/adapters/http-video.mjs`):
   MiniMax V2-shaped client (create task → `task_id`; poll
   queued/running/succeeded/failed/cancelled; time-limited result
   URL), normalized requests, bounded sizes, timeouts, classified
   errors (429→capacity, 402/422/4xx→deterministic, 5xx/529→transient,
   timeout/transport→indeterminate). No key in repo; the lane is
   stub-proven and reports **external acceptance pending** until
   credentials + cost authority exist.
2. Jobs (`0044_creative_video_lane`, function-only): capability
   `video`, lane `gpu_video`, filtered `claim_creative_video_job()`,
   pinned input via `get_creative_video_input()`, tenant-checked
   i2v sources via `get_creative_video_source()`, EXECUTE-only
   worker role. Provider metering reuses `creative_provider_calls`
   (operation vocabulary widened additively to
   text_to_video/image_to_video); fidelity lineage and output
   readers reused.
3. Worker (`render/video-worker.mjs`, CLI
   `scripts/creative-video-worker.mjs --once`): mark running,
   duplicate guard, anchor decision from the full prior-attempt
   record (`get_creative_provider_call`): at most one provider task
   per job, anchored immediately via
   `attach_creative_provider_request()` (same-value idempotent,
   replacement rejected); retries and restarts reconcile the SAME
   anchored task_id, and started/indeterminate attempts without an
   anchor refuse deterministically. Provider call metering per
   attempt; bounded reconcile loop with cooperative cancel. No
   provider cancel endpoint is documented, so cancel is local-only
   and NEVER records provider-cancelled: with a live task polling
   continues to provider truth (success persists as draft output
   with cost, job closes cancelled); only a provider-reported
   `cancelled` status marks the attempt cancelled. Transient poll
   failures never terminalize — they keep reconciling within
   budget. SSRF-safe download through the P2a boundary (allowlist,
   DNS pinning, no private targets), MP4 validation against the
   vendor codec allowlist (`mp4v`+`avc1`, never trusting
   MIME/filenames), private storage, versioned asset with
   provider/model/task/cost/cancel/reconciliation provenance,
   controlled completion. Failed/moderated provider work is
   deterministic and terminal, matching the vendor's no-deduction
   policy for failures.
4. Cost model: pre-submit estimate (`duration × $0.08/s`, flagged
   informational-only); actuals computed from provider-reported
   output seconds at the same rate and persisted on both the call
   row and the asset provenance. No billing semantics beyond
   estimates.
5. UI: `/creative/video` (t2v/i2v submit with live estimate, job
   list, progress via the existing job detail), AR/RTL + mobile,
   role gates (owner/operator submit, reviewer decides, viewer
   reads), no publish control. Flags (`GENERATIVE_VIDEO_ENABLED`)
   default OFF.
6. Evaluation (`evaluation/creative-video-v1/`): corpus + runbook,
   LEDGER ONLY + EXTERNAL ACCEPTANCE PENDING (stubs only).

## Non-goals of this decision

No talking head, lipsync, avatar, voice/TTS, music, reference-video
inputs, audio tracks, credits/billing, or production deployment.
Vendor-pixel certification and result-CDN allowlist confirmation
require a separately authorized bounded run. Provider cancel
(undocumented) stays local-only by design. Terms recorded: as between
customer and MiniMax the customer retains ownership rights in input
and generated content, but MiniMax may use that input and content to
provide, maintain, develop, and improve the Services — enterprise/
customer-data policy must explicitly approve this improvement-use
clause before production credentials exist or any non-synthetic media
leaves the boundary. Real provider flags stay OFF until that
privacy/data-use acceptance is signed.
