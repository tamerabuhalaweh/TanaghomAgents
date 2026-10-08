# ADR 0025: P2a image lane — provider boundary, local pipeline, fidelity policy

Date: 2026-10-08. Status: implemented for review under #229; not deployed.
Predecessors: Phase A decision record (`tasks/229-provider-decision.md`),
RECONCILIATION.md §§9/14, ADRs 0020–0024.

## Decision and scope

The first real generation lane proves the Creative Runtime contracts with
two executable paths and one explicitly pending path:

1. HTTP image provider adapter (`packages/creative-runtime/adapters/
   http-image.mjs`): config-allowlisted endpoints only (seed:
   `fal-ai/flux/schnell`, Apache-2.0 weights, $0.003/MP). Normalized
   requests, bounded sizes, timeouts, classified errors (429→capacity,
   5xx→transient, 4xx→deterministic, timeout/abort→indeterminate),
   artifact download caps, checksum verification. No key in repo; the
   lane is stub-proven and reports **external acceptance pending**
   until credentials + cost authority exist.
2. Local sharp pipeline (`adapters/local-sharp.mjs`): real CPU pixel
   work (scene composite over versioned presets, relight-lite
   modulation, lanczos enhance) with bounded inputs and provenance on
   every output. Executes in CI today.
3. S3-compatible storage (`storage/s3.mjs`): hand-rolled SigV4
   (zero new dependencies), private buckets, tenant-scoped immutable
   keys, exclusive create, presigned reads. MinIO is excluded everywhere
   (AGPLv3); no production credentials exist.

Segmentation stays interface-only: BiRefNet is MIT-verified but needs a
GPU/python host decision, so P2a product scenes compose from
alpha/mask-bearing sources. RMBG/BRIA (non-commercial) and FLUX.1-dev
(non-commercial) are never integrated.

Migration resequencing: `0038_creative_image_lane` carries provider-call
metering (`creative_provider_calls`, one row per attempt) and fidelity
history (`creative_fidelity_reviews` + derived `fidelity_status`).
Credits move to 0040, voice consent to 0041, web/growth to 0042.

Fidelity policy: reviews are append-only; the version row derives the
latest status. A `failed` variant cannot become `approved` without an
explicit owner override reason, which is audited on the same job trace.
`not_reviewed` variants may still be approved by reviewer judgment.
Approval never publishes anything.

## Non-goals of this decision

No video/voice/music, no billing semantics, no production storage
selection, no Studio-wide changes beyond the image/product surfaces.
Vendor-pixel certification stays a separately authorized bounded run.
