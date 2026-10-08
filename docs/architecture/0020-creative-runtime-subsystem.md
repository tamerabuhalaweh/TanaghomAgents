# ADR 0020: Creative Runtime bounded subsystem and provider abstraction

Date: 2026-10-08. Status: implemented for review under #225; not deployed.
Predecessors: RECONCILIATION.md §§2B/3/4, MASTER_PLAN.md (working branch
`plan/creative-platform-3aqel-parity`, merged as `1ab823f`).

## Decision and scope

Introduce a bounded internal subsystem called Creative Runtime that owns
durable creative jobs, versioned assets, brand-kit snapshots, and the
capability contracts every later creative feature builds on. Business code
resolves work by capability (`ImageGenerator`, `VideoGenerator`, …) through
a registry; provider implementations (today only the deterministic mock
adapter) sit behind that registry. No provider SDK, model ID, checkpoint,
or API call appears in dashboard server code, campaign/domain logic, or
workflow exports in this slice.

Flow: authenticated owner/operator JWT → `/api/creative/*` →
`lib/server/creative/*` → `create_creative_job()` and sibling controlled
functions → `creative_jobs` → worker claim → adapter execution →
artifact bytes to object storage → `create_creative_asset_version()` →
`complete_creative_job()` → human owner/reviewer decision →
existing governed publishing boundary (never Creative Runtime itself).

## Interfaces and authority

`/api/creative/jobs` (POST enqueue, owner/operator, idempotent),
`/api/creative/jobs/[id]` (GET, all roles, tenant-scoped),
`/api/creative/jobs/[id]/cancel` (POST, owner/operator, idempotent),
`/api/creative/assets` (GET list), `/api/creative/assets/versions/[id]`
(GET), `/api/creative/assets/versions/[id]/decision` (POST approve/reject,
owner/reviewer, feedback required on reject). All routes refuse with
`creative_studio_disabled` (503) unless `CREATIVE_STUDIO_ENABLED=true`;
reads and mutations share `authenticate()`/`authorize()` and the
`api_idempotency_keys` replay discipline. Mutations append
`agent_actions_log` rows alongside `creative_events`.

`packages/creative-runtime` exposes capability vocabularies, the adapter
registry, a pg-agnostic repository over the controlled functions, pure
retry/cancellation policy helpers, the mock adapter, and the storage
key/checksum/preview helpers plus an in-memory test adapter. Swapping a
provider later means registering a new adapter; campaign, approval, and
publishing code does not change.

## Non-goals of this decision

No real provider, GPU, billing, landing, gallery, affiliate, managed-social,
or production-storage selection. The S3-compatible backend choice stays a
later decision record with its own license/cost review.
