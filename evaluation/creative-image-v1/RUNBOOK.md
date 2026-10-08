# Creative image evaluation v1 (acceptance set, not a quality certificate)

Status: LEDGER ONLY until a bounded provider run is authorized.
No model quality may be claimed from synthetic/mock runs alone.

## Corpus

`corpus.json` pins the acceptance set: English + Arabic text-to-image
prompts, three product complexities, relight, scene replacement, and five
negative/provider-fault cases.

## What runs without credentials

- Local sharp pipeline cases (`prd-*`, `relight-01`, `scene-swap-01`):
  execute for real in the P2a integration harness; record output sha256,
  bytes, latency, preset, and `fidelity: not_reviewed`.
- Negative cases (`neg-*`): execute against the in-repo stub provider;
  record the error classification. Timeouts must classify
  `indeterminate`, never transient-blind-retry.
- Provider cases (`img-*`): recorded as `external_acceptance_pending`
  until `FAL_API_KEY` (or equivalent) plus cost authority exists. Never
  fabricate vendor pixels, latency, or cost.

## Ledger

Each run appends `{case_id, kind, provider, model, model_version,
output_sha256, bytes, latency_ms, cost_usd_or_null, result,
fidelity, at}` lines. The harness prints the ledger to stdout (captured
in CI logs as evidence); no binaries are committed.

## Human gates

Product cases require a fidelity review (logo, package text, shape,
proportions, colors, markings) before any approval claim. A technically
succeeded artifact with failed fidelity stays unapproved unless an
owner override with reason is recorded.
