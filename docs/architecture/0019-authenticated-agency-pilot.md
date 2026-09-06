# ADR 0019: authenticated Agency pilot certification lane

Date: 2026-09-06. Status: implemented for review under #176; not deployed.
Predecessors: ADR 0017/0018, PR #194/#195. Accepted source baseline:
`ec0058e48a3b64d3c43a94e25638b4d569d82ba8` (PR #195, 38 checks green).

## Decision and scope

Connect the six reviewed procedures to authenticated canonical data and an
inactive n8n simulation workflow. Keep the frozen v1 candidate/runtime manifests,
published skill identities and existing business/shared-runtime queues unchanged.
This is a bounded certification task lane linked by foreign key to a validated
or simulation Agent Studio version, not a replacement production agent queue.
It records pilot tasks, not fictional rows in `organization_agent_runs`.

Flow: accepted owner JWT → ID-only API command → tenant-bound database task →
leased private gateway claim → fixed model request or deterministic report →
fresh database resolution → schema/policy validation → immutable completion.
No simulation result writes campaign strategy, content approval, conversation
reply, Postiz or GHL action tables. Customer promotion remains a separate gate.

## Interfaces and authority

`/api/admin/agents/pilot` requires an accepted active human owner. POST accepts
closed `bind`, `approve_evidence`, `revoke_evidence` and `queue` commands. Tenant
identity is derived from the verified session; cookie mutations require same
origin. GET returns bounded tenant-only bindings, task results and audit events,
never leases, prepared model requests or secrets. There is no new UI in this PR.

`/api/internal/agency-pilot` requires its own constant-time-checked worker token,
at least 32 bytes, and `AGENCY_PILOT_GATEWAY_ENABLED=true`. It uses only
`AGENCY_PILOT_DATABASE_URL`, not the dashboard/admin database connection. The
new `tanaghom_agency_pilot_worker` is NOLOGIN until a separately reviewed
installation; it receives five claim/resolve/seal/complete/replay RPCs, no raw
table privileges, control writes, vault reads or human-approval rights.

Gateway and database switches default off/stopped. The existing shared-runtime
stop is also honored. Model execution has an additional operator-only switch.
The workflow has one manual trigger and one disabled schedule, imports inactive,
and has exactly three fixed HTTP nodes: claim, approved Gemma path, completion.
It has no publishing, CRM, file, shell, SSH, MCP or arbitrary URL node. Token
references in the export contain no credential values. Real-model access still
requires separate model/canary approval; the harness rewrites URLs to local stubs.

## Source resolution and honest limitations

- Strategist/Content Creator use the owner's current zero-budget campaign and
  latest strategy. Selecting the pilot task authorizes that brief for simulation;
  it does not assert a separate human strategy approval that never occurred.
- Discovery/Support use a stored inbound event, live ownership/consent state,
  active conversation policy and exact approved `knowledge/<key>/v<N>` versions
  assigned in Studio. In this slice the context is one inbound event plus up to
  eight knowledge versions; it is **not** a certified long-conversation memory.
- Brand Guardian uses the exact stored content generation/text. For the existing
  single `media_url` attachment, the content UUID is its asset-evidence key. The
  full database basis also includes the URL, so attachment edits invalidate
  inference. Owner-approved typed rights observations are not a legal clearance.
- Executive Summary consumes immutable **owner-approved metric observations**,
  not automatic provider analytics or invented live aggregation. Units, windows,
  currencies and ratio denominators remain strict; missing/conflicting facts are
  gaps. Attribution, autonomous analysis and recommendations remain #153.
- New evidence records are version identities: replacing an observation means a
  new UUID and approval, with an append-only revocation for the previous record.
  A hash detects drift; it does not prove that an owner-supplied claim is true.

PostgreSQL's `basis_hash` binds canonical rows, assignment, policy and model
profile. The kernel's `input_hash`/`snapshot_hash` use their original canonical
JavaScript format. They serve different purposes and are never compared as
interchangeable hashes. Results record both lineage and zero-action/no-approval
assertions. Profile JSON must match the pinned source manifest exactly.

## Concurrency and failure behavior

Serializable gateway transactions resolve immediately before preparation and
completion. Changes to campaign, evidence, policy, ownership or model admission
invalidate stale work. Stops, DND and revoked actors fail closed. Lease tokens
are checked and never accepted from customer commands. Tenant queue admission is
serialized (maximum 20 pending tasks); worker admission is globally serialized,
respects global/per-agent concurrency, and leases respect the lower of 300
seconds and the agent runtime limit. Retries respect the lower of three attempts
and the agent retry policy. Exhaustion produces an immutable failure audit.

Identical queue keys return the original task; different payloads conflict.
The same terminal response hash returns the original completion without a new
audit; a different result or old lease is rejected. Malformed/truncated models,
tool requests, wrong model identity and exceeded token budgets cannot succeed.
Raw exception/model/SQL payloads are not logged by the gateway. New model
execution data is not saved in n8n success/error/manual history by this export.

## Packaging and validation

The original kernel loads pinned files through native Node. Next's workspace
bundling currently does not reliably honor `serverExternalPackages` for local
workspace packages ([upstream issue](https://github.com/vercel/next.js/issues/84388)).
The server-only bridge therefore uses Node's native module loader; the Docker
image explicitly includes the workspace package, its locked Ajv dependencies and
the fixed config/schema/skill/prompt/export files. No root `.env` is copied.
The standalone image must pass a native import check in addition to the build.

Run `npm test`, `npm run check`, the dashboard build, full database regression
and `npm run test:agency-integration`. The latter creates uniquely named owned
PostgreSQL/n8n resources, synthetic JWTs and a simulated Gemma HTTP service.
It never reads `.env` or accepts an external `DATABASE_URL`. Its temporary
SSRF relaxation and host networking are **test-only**, never deployment settings.
It destroys only its own containers/volume/temp directory in `finally`.
Evidence lists real n8n manual executions separately from real model/provider
calls, which remain zero. These authored responses are not bilingual quality
certification or customer signoff. #177 owns that later comparison.

The core database job tests all 34 migrations and rollback/reapply. Historical
controlled-package CI jobs retain their explicit 0033 baseline through
`DATABASE_MIGRATION_TARGET`; they are not rewritten to pretend their production
packages authorize 0034. The new integration job independently uses every file.

## Installation and rollback boundaries

No deployment/activation command is authorized by this PR. Future installation
must approve exact source, migration 0034, restricted role credential handling,
private gateway/egress and model window, then validate before starting a worker.
Do not clear stops as part of an ordinary code deployment.

An unused installation can run `0034_agency_pilot_integration.down.sql` in a
controlled transaction. It refuses if bindings, evidence, tasks or audit records
exist, or either new control is enabled. It does not erase evidence to make a
rollback pass. For a used installation: stop new claims/model execution, disable
the gateway, keep the workflow inactive, revert the application through review
if needed and retain additive tables/role state for a forward fix. Any cleanup,
retention or rollback beyond this requires a reviewed package. Never drop another
project's role, data, network, service or image.
