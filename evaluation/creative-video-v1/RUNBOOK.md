# Creative video evaluation v1 (acceptance set, not a quality certificate)

Status: LEDGER ONLY + EXTERNAL ACCEPTANCE PENDING. No credentials
exist; every provider interaction below runs against a
provider-shaped localhost stub. Unit assertions prove request
shaping, classification, cost math, and validation; the stub proves
the async lifecycle end to end. Nothing here certifies vendor pixels.

## Corpus

`corpus.json` pins the acceptance set: EN/AR text-to-video,
image-to-video from a private upload, cancel lifecycle, indeterminate
no-blind-retry lifecycle, moderated rejection, SSRF negatives, and
codec negatives.

## What runs without credentials

- Adapter unit tests (normalization, 402/422/429/5xx/timeout
  classification, task lifecycle mapping, cost estimates).
- Disposable E2E with a stub MiniMax-shaped provider (fault modes:
  success, slow, rate_limit, rejected/moderated, malformed, empty) and
  loopback artifact delivery through the SSRF-safe download boundary
  (DNS-pinned in P2a fashion with loopback test-mode gating).
- Real MP4 validation of stub-served bytes (container/track/codec/
  duration/dims) and private storage + asset/version persistence.
- Ledger lines per case: `{case_id, operation, provider_task_id,
  output_sha256, bytes, duration, cost_usd, result}`.

## Human gates

Vendor-pixel certification, ToS ownership/training verification, and
result-CDN allowlist confirmation all require a separately authorized
bounded run with credentials + explicit cost authority.
