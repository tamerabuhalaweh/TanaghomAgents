# Task 234 — motion render-engine decision

Date: 2026-10-09. Status: decided, for review under #234.
Predecessors: `tasks/232-render-engine.md` (P2b engine decision), ADR 0026.

## Candidates evaluated

### 1. Remotion — REJECTED (proprietary commercial terms)

Verified 2026-10-09 via remotion.dev / remotion.pro: Remotion is free
only for individuals, non-profits, and for-profit organisations up to
3 employees. Our use — an automated video-creation product embedded for
end users — falls under "Remotion for Automators": **$0.01 per render
with a $100/month minimum**, plus per-seat creator pricing and an
enterprise tier from $500/month. A per-render metered dependency is
incompatible with the no-billing slice and the commercial-clean bar set
in P2a (cf. MinIO/AGPL and non-commercial-model rejections). No
escalation needed: rejected on verified terms, not unclear terms.

### 2. Motion Canvas — NOT SELECTED (MIT, but wrong architecture)

Verified: MIT License, copyright motion-canvas 2022
(github.com/motion-canvas/motion-canvas, core 3.17.2). License-clean,
but architecturally wrong for this slice:

- It executes developer-written TypeScript generator scenes (Canvas 2D
  API) through Vite + its own editor/preview pipeline. Our boundary
  forbids arbitrary JS execution; a scene-code layer would punch
  through the structured-JSON-only source rule.
- It does not consume our design documents; we would need a
  design-JSON→scene-code translator whose output is itself executable
  code — unauditable motion semantics.
- Dependency weight (vite plugin with known CJS/ESM friction, editor
  stack) for capabilities we can derive deterministically from CSS.

### 3. Browser-native CSS/Web Animations + Chromium + FFmpeg — SELECTED

In-house deterministic timeline, zero new runtime dependencies:

- Motion documents are structured JSON (presets, per-element motion,
  durations) referencing a pinned design template id+version.
- Frame builder emits the design page HTML plus generated CSS keyframes
  for the requested presets; each frame is frozen deterministically by
  rendering with `animation-delay: -t` and `animation-play-state:
  paused` — no JavaScript in the render context (JS stays disabled, as
  in P2b), no timing flakiness, byte-deterministic HTML per frame.
- Chromium captures PNG frames through the existing route-abort
  capture (`render/chromium.mjs`); attempted-external counting is
  asserted zero per render.
- FFmpeg encodes `rawvideo` pipe → MP4 with a FIXED argv allowlist
  (no user-controlled strings, no shell, no filter graphs).
- MP4 validation is pure JS (ftyp/moov/mvhd/trak walk: container,
  dimensions, duration/timescale) — no ffprobe dependency.

### 4. `motion` (Motion One, MIT) — NOT NEEDED

MIT and clean, but it is a client-side JS animation runtime. Our
frames are frozen server-side CSS; no runtime animation library is
required in the render path. The interactive preview uses plain CSS
animations directly (no dependency).

## FFmpeg licensing and commercial position

Verified 2026-10-09: the environment provides
`ffmpeg 9.0.2-full_build-www.gyan.dev` (ffprobe present). That build
is configured `--enable-gpl` (libx264/libx265). Position:

- FFmpeg is a **deployment-provided binary, never bundled or vendored**
  by this repo. The worker locates it via `FFMPEG_PATH` or `PATH`
  `ffmpeg` and fails closed (`deterministic`) when absent. Shelling a
  system binary with fixed arguments keeps FFmpeg's license where it
  belongs (the deployment), not in our source tree.
- **Codec allowlist is `mpeg4` only** (MPEG-4 Part 2, FFmpeg-native
  encoder — no external GPL encoder library is invoked), container
  `mp4`, `yuv420p`, `+faststart`, no audio track. `libx264`/`libx265`
  stay rejected: they are GPL-licensed encoder libraries, and enabling
  them is a legal decision, not an engineering one.
- Known trade-off (stated, not hidden): MPEG-4 Part 2 MP4s play in VLC
  and most native players but not in Chrome/Firefox `<video>`. The
  dashboard preview therefore plays the **animated HTML timeline**
  (pixel-identical motion semantics), while the MP4 file is the
  downloadable/reviewable export. H.264 upgrade is deferred pending
  legal sign-off and would only widen the codec allowlist, never the
  argv shape.
- The gyan full build above is **E2E evidence only**; production
  guidance (recorded in the worker module header) is an LGPL-configured
  FFmpeg build. Nothing in the repo downloads, installs, or pins an
  FFmpeg binary.

## Decision

Selected: in-house deterministic timeline + Chromium frames + fixed-argv
FFmpeg (`mpeg4`/mp4) + pure-JS MP4 validation. No new dependencies. No
unclear-license component integrated, so no escalation is triggered.
