# Task 231 — segmentation model decision (fresh, 2026-10-09)

Status: decided with an explicit legal gate; weights never bundled.
Predecessors: `tasks/229-provider-decision.md`, `tasks/236-provider-decision.md`.

Rule followed: nothing trusted from previous research. All rows below
re-verified 2026-10-09 against official sources.

## BiRefNet facts (refreshed)

- Exact repository: `ZhengPeng7/BiRefNet` (GitHub, CAAI AIR 2024,
  arxiv:2401.03407). Weights: `ZhengPeng7/BiRefNet` (Hugging Face,
  `model.safetensors`, 885MB, safetensors format).
- Code license: MIT (LICENSE file on main, verified
  2026-10-09, Copyright (c) 2024 ZhengPeng).
- Weights license tag: `mit` (Hugging Face model card, verified).
- Model: Swin-Large backbone dichotomous image segmentation;
  general-use weights trained on DIS5K-TR + DUTS + HRSOD + UHRSD +
  HRS10K + P3M + human sets; 1024x1024 inference input.
- Dependencies (requirements.txt): Python 3.9–3.11, PyTorch
  2.0.1–2.5.x, torchvision, timm (Swin backbone), einops, kornia,
  Pillow, transformers (hub loading). All are BSD/MIT/Apache-2.0
  licensed libraries; no copyleft runtime dependency found in the
  inference path.
- CUDA: 11.8 / 12.4 builds documented. VRAM: 5.5GB @1024² PyTorch
  (Swin-L), 3.45GB FP16 on RTX 4090 @~17fps. Reported latency:
  ~150ms avg PyTorch (RTX 4080S), ~0.7s first / 0.15s steady.
- CPU: viable but slow (Swin-L ~200M params; expect tens of seconds
  per 1024² image on desktop CPU — test/development profile only,
  never claimed production-ready).
- Preprocessing: resize 1024², ImageNet normalize. Postprocessing:
  sigmoid → resize to source size → alpha composite. No transparency
  awareness in DIS training (binary masks only).
- Redistribution: code MIT permits bundling with notice; weights are
  NOT bundled by this repo under any profile (deployment-provisioned
  from Hugging Face or vendored store, hash-pinned).

## Commercial-use position (explicit, not hidden)

- Code: MIT, commercial use permitted. Weights: tagged MIT.
- HOWEVER, the author publicly notes (issue #306 and model zoo) that
  the DIS5K training set carries its own strict license distinct
  from Apache-2.0, and third-party BiRefNet-derived weights
  (notably briaai/RMBG-2.0) are explicitly NON-commercial.
- Position: the MIT tags satisfy the repo's code-dependency bar, but
  training-data encumbrance is a legal question, not an engineering
  one. Therefore: **legal sign-off on DIS5K-derived weights is a
  blocking acceptance gate before production weights load or any
  customer media is segmented by BiRefNet**. This lane ships with
  the gate documented, weights unbundled, and E2E evidence from
  synthetic fixtures + the deterministic local engine. This is the
  same escalation-by-gate posture as P4's MiniMax privacy gate.

## Alternatives recorded (not selected)

- briaai/RMBG-2.0 (BiRefNet-derived): explicitly non-commercial —
  REJECTED on license (this is also why the adapter boundary must
  not hardwire RMBG weights).
- fal.ai/birefnet (hosted API): third-party terms + per-call billing
  + customer media leaves boundary — REJECTED for this slice (no
  provider lane for segmentation; local-first per issue scope).
- U²-Net / U2Net (Apache-2.0 weights, Xuebin Qin): older, weaker
  edges, smaller community maintenance — noted as the fallback if
  BiRefNet legal gate fails. Not integrated now.
- ONNX/TensorRT conversions: deployment optimizations, explicitly
  out of this slice (documented profiles only).

## Deployment profiles

### GPU profile (preferred production direction, vendor-published values)

- CUDA ≥ 11.8 (12.4 recommended), PyTorch ≥ 2.0.1.
- VRAM: ≥6GB for 1024² Swin-L inference (5.5GB measured); FP16
  halves bandwidth with ~0 quality loss per author.
- Latency: ~150ms steady-state (4080S-class) at 1024²; first
  inference slower (model/cuDNN warm-up — deployment must warm up
  before serving).
- Concurrency 1 per worker process in this slice (no batching).
- Max input: 2048px long edge (downscaled to 1024² model input;
  mask upscaled to source size). Larger inputs rejected.
- Memory caps enforced by the worker (see adapter limits).

### CPU profile (test/development only)

- Runs anywhere PyTorch CPU runs; expect 30–180s per 1024² image
  depending on host. NEVER production; the worker records
  `device: cpu` in provenance so slow runs are auditable.
- This environment (no CUDA device) is CPU-only: E2E uses the
  deterministic local engine; any real-CPU BiRefNet evidence is
  reported with measured latency, never extrapolated.

## Adapter/operation design

- Operation `segment` through existing provider-call metering
  (vocabulary already includes it) and the adapter/capability
  boundary (`adapters/segmentation.mjs` with named engines:
  `birefnet` + `local-deterministic`). Product Studio calls
  `segment`, never BiRefNet directly.
- BiRefNet engine: fixed argv to a pinned Python bridge
  (`BIREFNET_PYTHON`, `BIREFNET_CODE_DIR`, `BIREFNET_WEIGHTS`
  configured at deployment; validated at startup), bounded JSON
  protocol over stdio, no shell, no network after provisioning,
  per-call timeout, output mask validation before persistence.
  The bridge never executes arbitrary code: fixed entry point,
  fixed model id, numeric-only parameters.
- Local engine: sharp-based deterministic segmentation for
  fixtures/tests (chroma + luminance + threshold + cleanup) plus
  bounded refinement primitives (feather/erode/threshold).
