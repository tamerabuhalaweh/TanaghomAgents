# Groky v0 reconciliation audit

- Status: accepted as the Phase 2 reconciliation baseline
- Date: 2026-07-12
- Scope: local Groky database, dashboard/backend, n8n workflows, prompts, and
  environment contract compared with TanaghomAgents Phase 1 and PR #11
- Safety: source-only audit plus read-only connection checks; no migrations,
  workflow imports, external calls, or UI changes

## Decision

TanaghomAgents is the authoritative implementation. Preserve Phase 1's
database-enforced approvals, state transitions, correlated jobs/events,
idempotency reservations, and immutable audit log. Preserve PR #11's approved
Direction 1 dashboard. Reimplement the useful legacy behavior behind the
application API; do not mechanically connect the legacy Express server or n8n
SQL to the Phase 1 schema.

The exact secret-free legacy source is retained under `archive/legacy-v0` so
requirements and working ideas are recoverable without creating a second live
implementation.

## What was found

The legacy source contains 12 public tables, three operational views, six
message-template fixtures, an Express approval API, eleven inactive n8n exports,
three agent prompt documents, and shared code snippets. It demonstrates:

- campaign intake and strategy generation;
- content generation and rejection-aware regeneration;
- human content and sales-template approvals;
- Postiz publishing and performance synchronization;
- lead capture, GoHighLevel handoff, follow-up, reporting, and requeue;
- pipeline, audit, report, and approval views.

None of those workflows has runtime acceptance evidence. The shared n8n
sub-workflows are not called by the main agents, and prompt text is duplicated
inside workflow JSON instead of loaded from one versioned source.

PR #11 is a substantially stronger product shell but remains fixture-only. The
legacy dashboard has real database mutations and webhook feedback, while the
new dashboard has better information architecture, accessibility, responsive
behavior, and review context.

## Compatibility blockers

| Area | Legacy contract | Authoritative Phase 1 contract |
| --- | --- | --- |
| Namespace | Unqualified `public` objects | Domain objects in `tanaghom` |
| Campaign creation | No actor required | Required `created_by` human/service identity |
| Approval | Status plus text username | Separate approval record tied to an active human UUID |
| Strategies | One row and `raw_strategy` | Versioned strategy plus model and prompt versions |
| Regeneration | `parent_item_id` and pillar | `parent_content_id` and generation number |
| Publishing | Check, call, then record | Reserve `external_operations` before side effect |
| Audit | Agent name and optional entity | Correlation plus agent/user actor UUID |
| Delivery | Direct workflow webhooks | Durable jobs and outbox events |
| Templates/CRM | Rich sequence fields | Smaller Phase 1 model requiring forward migration |
| Reports/channels | Legacy tables/views | Missing authoritative Phase migration |

Concrete failures include missing required campaign creator, incompatible
strategy and post inserts, audit rows without correlations or actors, approval
updates that cannot satisfy the human-decision trigger, absent dashboard views,
and a legacy campaign transition rejected by the Phase 1 state machine.

## Security and correctness findings

The legacy code is not safe to activate unchanged:

- receiving webhooks do not verify the internal-secret header;
- Postiz and GoHighLevel calls use race-prone check-then-call idempotency;
- staging lead processing can create a real GoHighLevel contact;
- the public form and lead webhook lack application authentication/rate limits;
- shared Basic Auth cannot provide durable human approval identity;
- direct n8n database writes have no least-privilege role boundary;
- several HTTP nodes can hide failure and still advance delivery state;
- `n8nio/n8n:latest` and fallback passwords make the old compose unsuitable;
- repair/manual SQL files compete with the numbered migration history.

## Reuse policy

Reuse directly:

- Phase 1 invariants and database tests;
- PR #11 design system, shell, routes, and approval composition;
- prompt policy concepts and structured-output expectations;
- legacy endpoint inventory as application API requirements;
- integration payloads only as research fixtures.

Reimplement:

- authenticated server-side sessions and role authorization;
- approval/rejection API transactions and webhook/outbox feedback;
- all workflows against jobs, outbox events, external-operation reservations,
  correlated audit records, and versioned contracts/prompts;
- Postiz/GHL ingress, replay protection, staging isolation, and retries;
- live dashboard adapters and truthful loading/empty/error/health states.

Retire after parity:

- the Express dashboard;
- manual/repair SQL as executable migrations;
- direct workflow-to-workflow delivery as the primary orchestration path;
- duplicated embedded prompts and unused shared workflow exports.

## UI decision boundary

No approved dashboard visual was changed by this reconciliation. Live adapters,
query selection, persistence, real counts, polling/subscriptions, correct
navigation handlers, focus containment, and ARIA announcements can be added
without replacing Direction 1.

These material additions require desktop and mobile screenshots before work:

- Sales Templates, Audit Evidence, and Requeue information architecture;
- saved, webhook-warning, and failed decision feedback compositions;
- any sticky mobile approval action bar;
- any visual campaign-card/index redesign.

The legacy dark palette and top-tab shell will not be restored.

## Supabase evidence

The existing local environment is populated, and no value was copied or
committed. Read-only checks found:

- the configured project/JWKS endpoint responds;
- the legacy anon token identifies a different project than the configured URL;
- the initial publishable-key check queried the protected Data API schema root
  and was therefore inconclusive; later Auth settings verification confirmed
  that the current publishable key is accepted by the configured project;
- the configured PostgreSQL endpoint refuses the connection.

Therefore the live schema cannot yet be treated as verified. No migration may
run until current credentials are installed locally and
`npm run db:inspect:readonly` succeeds. The inspection command opens an explicit
read-only transaction and returns catalog metadata only.

## Safe migration sequence

1. Rotate stale credentials and place current values only in an untracked local
   environment or secret store.
2. Take encrypted off-server schema and data backups and record checksums.
3. Run the read-only catalog inspection; compare actual objects, constraints,
   grants, extensions, and migration state with committed evidence.
4. Add forward-only roles and grants so n8n cannot create approval decisions.
5. Apply `tanaghom` alongside legacy public objects; never run a down migration
   or overwrite public data during reconciliation.
6. Add forward migrations for channels, template sequences, CRM cadence,
   reporting, and failure operations.
7. Copy through staging tables with deterministic identity mapping. Treat old
   text approvals as untrusted and require human reapproval unless identity can
   be proven.
8. Run rewritten API/workflows in read-only or shadow mode, with every external
   integration disabled.
9. Complete a zero-budget `.test` campaign against staging services, reconcile
   counts and provider IDs, then perform a separately approved cutover.

## Current gate

PR #11 must remain draft and unmerged. Reconciliation source and planning are
now preserved, but Phase 2 is not complete until authentication, live API/data
adapters, operational states, RTL/browser QA, and a verified read-only database
connection are proven.
