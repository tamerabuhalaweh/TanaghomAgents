# P2b Rendering Engine Decision (Phase 1 of #232)

Date: 2026-10-08. No external rendering library is integrated.

## Candidates evaluated (current commercial status)

| Candidate | License | Verdict |
|---|---|---|
| Polotno SDK / Studio | Commercial source-available SDK (paid plans, white-label terms) | Rejected: commercial lock + account/API dependency; violates ownership/control requirement without Tamer cost approval |
| OpenPolotno forks | Mixed MIT claims, immature, unclear maintenance/provenance | Rejected: provenance risk for a trust-critical renderer |
| Satori (Vercel OG renderer) | Apache-2.0 BUT no text shaping (Arabic renders disconnected) | Rejected: fails the core Arabic requirement technically |
| Remotion / Motion Canvas | Remotion needs commercial automation licensing; Motion Canvas is code-first animation, not a layout engine | Rejected: wrong tool / license cost for static design export |
| node-canvas | MIT BUT needs system Cairo/Pango/fontconfig + host Arabic fonts; fragile across CI/worker hosts | Rejected: operational fragility |
| resvg | Apache-2.0 BUT SVG text shaping for complex scripts is limited | Rejected: same Arabic risk as Satori without verification budget |
| Headless Chromium screenshot | Chromium (BSD-style) via pinned `playwright` devDependency (already audited); no new dependency | Selected as the export rasterizer only |

## Selected: in-house JSON→HTML builder + Chromium screenshot

- `packages/creative-runtime/render/document.mjs` (pure, zero dependencies):
  validates a design document, resolves brand/template/asset inputs, and
  emits one self-contained HTML string per page (inline styles from an
  allowlisted token set, `dir`/`lang` set, images as data URIs, fonts via
  local `@font-face`, zero `<script>`, zero external references).
- PNG export screenshots that exact HTML at 1080×1080, 1080×1350, or
  1080×1920 with animations disabled and network blocked (route abort +
  offline context). Preview and export share the builder: WYSIWYG by
  construction, and browser-native shaping makes Arabic correct.
- Fonts: bundled `Cairo[slnt,wght].ttf` (OFL 1.1, 599,548 bytes,
  sha256 `667c987182391c91f4e57a2f455b1794fb5e3ee6ca4ef3383e86bb690fa9c964` (lowercase canonical),
  source `github.com/google/fonts` `ofl/cairo/`) + system fallback stack.
  No downloads, no executable font processing of user uploads.

## Why this wins

- Zero new dependencies, zero license reviews, full source ownership.
- Arabic correctness comes from the browser shaper, not from reimplementing
  bidi/shaping.
- Determinism is testable: same document/version/assets/fonts → identical
  PNG bytes (asserted in tests).
- The render worker needs only Chromium (already the test browser) plus
  file-local inputs; the dashboard never orchestrates models.

## Fallback

If Chromium ever becomes unavailable in a worker tier, the HTML documents
remain valid standalone artifacts (openable in any browser), and PNG
export can move to any conformant screenshot service behind the same
`renderDesign()` interface without touching domain logic.

## Browser/server implications

- Server (dashboard) never renders: it validates, enqueues render jobs,
  and serves previews from stored HTML strings.
- Workers (test harness now, dedicated workers later) execute
  `renderDesign()` with leased claims, exactly like P2a lanes.
