# Creative motion evaluation v1 (acceptance set, not a quality certificate)

Status: LEDGER ONLY until bounded human visual review signs the MP4s.
Unit assertions cannot see Arabic shaping or motion aesthetics; encoded
MP4s and frame screenshots can.

## Corpus

`corpus.json` pins the acceptance set: Arabic 1:1 presets, English LTR
control, 9:16 Arabic story with captions, multi-scene carousel motion,
cancel lifecycle, and negative cases (malicious motion JSON, codec
refusal, network attempt).

## What runs without credentials

Everything in this lane is credential-free by design:

- Motion contract + timeline validation unit tests (malicious inputs).
- Frozen-frame determinism: same motion/t/design renders byte-identical
  frame HTML twice.
- Real worker renders of every motion case with offline Chromium frames
  and fixed-argv FFmpeg encode; MP4s validated (container, dims,
  duration) and stored as CI artifacts for human visual review.
- Zero-network proof: route-abort capture asserts zero attempted
  external requests per render.
- Ledger lines per case: `{case_id, motion, format, fps, frames,
  output_sha256, bytes, duration_ms, latency_ms, result}`.

## Human gates

MP4s require human visual sign-off for Arabic correctness and motion
quality before any claim beyond "deterministic and structurally
valid". No generative video is claimed or tested anywhere in this lane.
