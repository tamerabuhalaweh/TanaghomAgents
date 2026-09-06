# Authenticated Agency pilot integration evidence

Scope: Issue #176. Date: 2026-09-06. Accepted predecessor: PR #195,
`ec0058e48a3b64d3c43a94e25638b4d569d82ba8` (38/38 checks); reviewed and merged
under Tamer's scoped GO. This successor is an implementation-review slice, not
a production deployment or model certification.

## Implemented

- Migration 0034: six immutable profile mappings, Studio-version bindings,
  owner-approved typed evidence/revocations, bounded leased tasks and append-only
  audit; separate no-table-access worker role and default-stopped controls.
- Owner-authenticated `/api/admin/agents/pilot`, isolated internal gateway,
  canonical tenant/policy/evidence resolver and fresh completion validation.
- Real inactive n8n pilot export connecting the four existing proposal identities
  plus Brand Guardian and deterministic Executive Summary adapters.
- Standalone Docker packaging for the pinned source kernel and locked runtime
  dependencies; no existing published skill/export has been overwritten.

Architecture, authority, storage limitations and rollback:
[ADR 0019](../architecture/0019-authenticated-agency-pilot.md).

## Local validation

| Check | Result |
| --- | --- |
| `npm test` | 148/148 tests passed |
| `npm run check` | Passed |
| Dashboard typecheck and root-launched production build | Passed |
| Standalone Docker build and network-disabled native runtime import | Passed |
| Full disposable PostgreSQL database contract | Passed, including all 34 migrations, rollback and clean reapply |
| `npm run test:agency-integration` | 26 check groups; 12 actual n8n manual executions; 10 simulated-model HTTP requests |
| Actual model / Postiz / GHL calls | 0 / 0 / 0 |
| Production/server connections or changes | 0 |

The twelve journeys are all six profiles × English/Arabic. They exercise actual
JWT authentication, owner/tenant checks, database resolution, an imported n8n
workflow, HTTP transport, schema validation and durable completion. Executive
Summary runs locally; the other five use an authored-response Gemma stub.

Negative controls cover wrong/multibyte worker tokens, absent session, cross-site
cookie mutation, cross-tenant bindings, unknown command fields, restricted-role
table/control access, stopped queueing, duplicate/conflicting queue keys,
exclusive/wrong/expired leases, duplicate/conflicting completion, immutable
terminal evidence, edited campaigns, revoked evidence, human takeover, DND,
emergency stops, invalid JSON and exhausted retries. The actual exported n8n
database still shows the workflow inactive and schedule disabled after the runs.
Used-state rollback is rejected without deleting evidence. No external-action
jobs are created; all test controls are restored before disposable cleanup.

Machine-readable output is generated at
`tmp/agency-pilot-integration-evidence.json`; CI uploads its own run artifact.
The retained sanitized copy accompanying this change contains timestamps,
per-journey response/result hashes, pinned tool images and explicit limitations.
It contains no credentials, raw prompts, customer data or session tokens.

## Regression fixes found during integration

Real tests exposed and fixed exact-version knowledge-key resolution, repeated
report-schema compilation, immutable source loading in a standalone Next image,
and the new trigger function's default PUBLIC execution grant. The tests also
verify retry exhaustion and distinguish an audit event named `prepared` from
leaking prepared request contents. No failed run is presented as acceptance.

## What this does not prove

No live Gemma output, Arabic linguistic quality, semantic brand judgment,
performance/load envelope, customer approval, provider handoff, deployment or
customer-facing Studio availability is certified here. Reports consume typed
owner-approved observations, not automatic provider analytics. The one-event
conversation pilot is not long-history memory. #176 remains open, with #177
owning paired model/quality comparison and #125/#137 the separate customer UAT.

Next best move: review this integration PR, then prepare the version-pinned
English/Arabic comparison and corrected-schema model-probe package under #177.
Real-model execution and later installation require bounded authorization.

Production-release evidence score stays **60/100** under the unchanged
[20-gate rubric](../PRODUCTION_READINESS.md). This is current evidenced gate
coverage, not feature completion. No production points are added for more
source/disposable tests; the eight runtime/customer gates still need evidence.
