# Creative design evaluation v1 (acceptance set, not a quality certificate)

Status: LEDGER ONLY until bounded human visual review signs the renders.
Unit assertions cannot see Arabic shaping; screenshots can.

## Corpus

`corpus.json` pins the acceptance set: long Arabic headlines, mixed
Arabic/English with prices, English controls, 6-slide carousels in both
directions, mobile preview, all three aspect ratios, and negative cases
(overflow, font fallback, dangling assets, malicious input).

## What runs without credentials

Everything in this lane is credential-free by design:

- HTML builder validation + escaping unit tests (malicious inputs).
- Determinism: same document/version/assets/fonts render byte-identical
  PNGs twice; any drift fails the run.
- Chromium screenshots of every corpus case at desktop and mobile
  viewports, stored as CI artifacts for human visual review (Arabic
  connected shaping, RTL order, mixed-bidi, wrapping, alignment).
- No-network proof: the render context aborts all requests and runs
  offline; a counter asserts zero http(s) requests per render.
- Ledger lines per case: `{case_id, template, format, output_sha256,
  bytes, latency_ms, result}` printed to stdout (captured in CI logs).

## Human gates

Screenshots require human visual sign-off for Arabic correctness before
any claim beyond "deterministic and structurally valid". Fidelity review
(product variants) stays on the asset review path per ADR 0025.
