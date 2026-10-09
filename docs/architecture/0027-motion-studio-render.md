# ADR 0027: P3 motion lane — deterministic timeline, offline MP4 export

Date: 2026-10-09. Status: implemented for review under #234; not deployed.
Predecessors: `tasks/234-motion-engine.md`, `tasks/234.md`,
RECONCILIATION.md §§9/14, ADRs 0020–0026.

## Decision and scope

Motion graphics (never generative video) animate existing pinned design
documents into MP4 private assets through a deterministic timeline:

1. Contracts (`packages/contracts/schemas/creative/motion-document.v1`):
   motion JSON references a design template id+version (never copied
   source) and declares fps (24/30), 1–10 scenes bound to design page
   ids with durations and transitions (none/fade/slide/scale),
   per-element entrances (none/fade/slide/scale/reveal, logical
   up/down/start/end directions, bounded delays/durations, fixed easing
   keywords), and optional timed captions. Totals are capped (30s,
   900 frames). No HTML/JS/CSS/URL fields exist.
2. Timeline (`packages/creative-runtime/render/motion.mjs`): pure
   validation plus per-frame frozen HTML. Each frame shifts every CSS
   animation to `animation-delay: -t` with `animation-play-state:
   paused`, so frames are byte-deterministic without JavaScript (which
   stays disabled in capture). Logical start/end resolve against
   document direction, keeping Arabic entrances RTL-correct. Arabic
   stays browser-shaped Unicode text; captions are escaped.
3. Capture/encode/validate: Chromium PNG frames through the existing
   route-abort capture (zero attempted external requests asserted per
   render), FFmpeg `rawvideo`-free path (`image2pipe` PNG in, MP4 out)
   with a FROZEN argv allowlist (no shell, no filters, no user strings;
   output is a worker-generated temp path), codec allowlist `mpeg4`
   only (native encoder — no GPL encoder library invoked), container
   `mp4`, `yuv420p`, `+faststart`, no audio. MP4 validation is pure JS
   (ftyp brand, moov/mvhd duration, trak/tkhd dimensions).
4. Worker (`render/motion-worker.mjs`, CLI
   `scripts/creative-motion-worker.mjs --once`): filtered
   `claim_creative_motion_job()`, pinned input with embedded
   tenant-checked sources via `get_creative_motion_input()`, duplicate
   guard via `count_creative_render_outputs()`, cooperative cancel
   polling via `get_creative_motion_state()`, one asset with one MP4
   version per job, full provenance (motion/design refs, frames, fps,
   codec, font, brand, sources, correlation). One carousel motion may
   span scenes; each requested format is an explicit job. The worker
   role stays EXECUTE-only; the worker never calls the preview route.
5. Storage/UI: exports persist under tenant-scoped immutable keys;
   reviewer approve/reject reuses the existing decision path; Motion
   Studio UI (list/create/editor, live CSS preview, render, job
   progress polling) carries no publish control. Flags
   (`MOTION_STUDIO_ENABLED`) default OFF.
6. Migration resequencing: `0040_creative_motion_render` carries the
   three motion functions (function-only, no tables); P0's credits slot
   moves to 0043 (voice 0041, web/growth 0042 hold).
7. Evaluation (`evaluation/creative-motion-v1/`): corpus + runbook,
   LEDGER ONLY until bounded human visual review signs the MP4s.

## Non-goals of this decision

No generative video, no talking head, no voice/TTS, no music, no
billing/credits semantics, no production deployment or FFmpeg
bundling, no H.264 (stays rejected pending legal sign-off), no P4
work. Diffusion text stays forbidden. Choosing the native `mpeg4`
encoder does not by itself clear all distribution or patent
obligations: deployment-specific legal review of FFmpeg remains
required before production use.
