# ADR 0029: P2a segmentation follow-up — governed product cutouts

Date: 2026-10-09. Status: implemented for review under #231; not deployed.
Predecessors: `tasks/231-segmentation-decision.md`, `tasks/231.md`,
RECONCILIATION.md §§9/14, ADRs 0020–0028.

## Decision and scope

Automatic product-background removal inside the Creative Runtime
(product_shoot/cpu, `params.operation='segment'` — no new capability;
`segment` was already in the provider-call vocabulary):

1. Engines (`packages/creative-runtime/adapters/segmentation.mjs`):
   named `birefnet` + `local-deterministic` behind one `segment`
   operation so Product Studio never hardwires a model. BiRefNet code
   is MIT and weights are HF-tagged MIT (both re-verified
   2026-10-09), but the author's DIS5K dataset-license note makes
   commercial cleanliness a legal question: production weights load
   only after explicit legal sign-off, and weights are never bundled.
   The BiRefNet path runs through a fixed, audited Python bridge
   (scalar-only validated argv, no shell, no network after
   provisioning, timeout + AbortSignal kill, single-JSON-line report,
   output validation). The local engine is sharp-based deterministic
   segmentation (auto background, threshold, bounded erode/feather)
   for fixtures, tests, and refinement.
2. Jobs (`0045_creative_segmentation`, tables unchanged):
   filtered `claim_creative_segment_job()` (product_shoot/cpu/
   segment only — compose jobs never touched), pinned input and
   tenant-checked sources via controlled readers, cancel polling,
   EXECUTE-only worker role. Method vocabulary widened additively
   (`segment`; monotonic, never narrowed on rollback).
3. Worker (`render/segment-worker.mjs`, CLI
   `scripts/creative-segment-worker.mjs --once`): mark running,
   duplicate guard, source resolution, engine execution with cancel
   polling during long inference, mask + cutout PNG validation,
   private storage under tenant-scoped keys, ONE asset lineage
   (v1 original mask always preserved, v2 transparent cutout),
   full provenance (engine, model/version, refine params, coverage,
   source/dims/device/inference time, correlation), controlled
   completion. Sources are never mutated; cutouts change alpha
   only, so product RGB (logos, text, colors) is preserved by
   construction.
4. Product Studio: Remove Background section (source select, engine
   select, feather bound) with cutout preview on transparency
   checkerboard and one-click "use as product source" into the
   existing scene flow. Fidelity system reused (checklist review +
   approve/reject with existing gates). Flags
   (`ML_SEGMENTATION_ENABLED`) default OFF.
5. Evaluation (`evaluation/creative-segmentation-v1/`): 12-category
   corpus with a deterministic fixture generator + runbook, LEDGER
   ONLY until human visual review. One real BiRefNet CPU inference
   measured (torch 2.14.1+cpu, weights snapshot e2bf8e44: 5.2s load,
   72.1s infer @1024², clean cutout) — CPU is test/dev-only, never
   claimed production-ready.
6. Deployment profiles documented in the decision record (GPU
   preferred with vendor-published values; CPU test-only).

## Non-goals of this decision

No talking head, lipsync, avatar, voice/TTS, music,
billing/credits, or production deployment. No virtual-studio parity
claim (pipeline completion only). No ONNX/TensorRT conversion work.
P4 stays source-complete / MiniMax acceptance pending — untouched.
