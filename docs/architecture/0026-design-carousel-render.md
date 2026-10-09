# ADR 0026: P2b design/carousel lane — deterministic local render, no diffusion text

Date: 2026-10-08. Status: implemented for review under #232; not deployed.
Predecessors: `tasks/232-render-engine.md`, `tasks/232.md`, RECONCILIATION.md
§§9/14, ADRs 0020–0025.

## Decision and scope

Arabic creative text is never generated as diffusion pixels. Designs are
structured, editable JSON documents rendered deterministically to local-only
HTML, screenshotted by Chromium for export:

1. Contracts (`packages/contracts/schemas/creative/ad-document.v1` and
   `carousel-document.v1`): semantic node types only — `text`, `image`,
   `shape`, `badge` (exactly what `render/document.mjs` implements; no
   `divider`, `spacer`, or `container` types exist in this slice). No
   arbitrary HTML/JS/CSS fields exist, so there is nothing to smuggle
   through. Canvas is one of 1080x1080 / 1080x1350 / 1080x1920; carousel
   is 2–10 ordered pages (cover/body/end), each node inside exactly one
   page.
2. Renderer (`packages/creative-runtime/render/document.mjs`): pure
   validation + HTML builder, zero dependencies, no network. Defense in
   depth: contract validation at write, renderer validation at build,
   Node `fetch` disabled in the render context, CSP with no remote
   sources, bundled font only. Text nodes render with zero letter-spacing
   (Arabic script shaping breaks otherwise); Arabic copy stays selectable
   Unicode text, never baked pixels.
3. Fonts (`config/creative-fonts.v1.json`): Cairo OFL 1.1 bundled in-repo
   (sha256 pinned, verified by unit test); no remote font loading, no
   system-font dependence.
4. Storage: designs live in `creative_templates` (kind `ad`/`carousel`),
   versioned rows, same RLS/RBAC/audit/idempotency boundary as every
   Studio surface. Render jobs reuse `create_creative_job` with
   capability `design` + lane `cpu`; the worker input resolver
   `get_creative_render_input(job, worker)` returns the version-pinned
   template, brand snapshot, asset allowlist, and params only to the
   claiming worker. Resequencing holds: `0039_creative_design_render`
   adds the function only; credits stay 0040, voice 0041, web/growth 0042.
5. Evaluation (`evaluation/creative-design-v1/`): corpus + runbook. Unit
   assertions prove structure, determinism, escaping, and no-network;
   Chromium screenshots of every corpus case are CI artifacts for
   bounded human visual review of Arabic shaping. Status stays LEDGER
   ONLY until that review signs.
6. Export worker (`packages/creative-runtime/render/worker.mjs` with
   `render/chromium.mjs` capture and `storage/local-fs.mjs` backend,
   operated via `scripts/creative-design-worker.mjs --once`): claims one
   queued design|carousel cpu job, marks it running, resolves the pinned
   input through `get_creative_render_input()`, loads tenant-checked
   private source assets, captures each page in order through a
   JavaScript-disabled Chromium context that aborts every routable
   request, validates PNG magic/dimensions/checksum, stores immutable
   tenant-scoped keys, registers one version per output (`render`
   method, page_index/page_count/correlation/font/brand/source
   provenance), and completes the job through the controlled lifecycle.
   Carousels persist as one asset with N ordered versions under one
   correlation; failures classify deterministic (bad document, missing
   source, network attempt, duplicate execution) vs transient retry.
   The worker never calls the authenticated preview HTTP route; the
   preview route additionally carries a restrictive CSP
   (`default-src 'none'`, data-only images/fonts, no frames/forms).

## Non-goals of this decision

No video/voice/music, no billing semantics, no provider or credential
changes, no publish path (render approval never publishes), no virtual
studio, no P3 work. Diffusion text rendering stays rejected: it cannot
shape Arabic reliably, and pixel-baked Arabic cannot be edited, searched,
or audited as text.
