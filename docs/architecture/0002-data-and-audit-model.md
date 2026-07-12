# ADR 0002: Data, approvals, events, and audit model

- Status: Accepted
- Date: 2026-07-12

## Decision

PostgreSQL is the authoritative state machine for campaigns and agent work.
Phase 1 introduces four enforcement mechanisms:

1. Content cannot enter `approved` or `rejected` without a matching decision by
   an active human owner or reviewer.
2. `agent_actions_log` is append-only through database triggers.
3. Each external side effect is reserved by a provider-scoped idempotency key.
4. Durable outbox events and agent jobs carry correlation IDs for replay,
   observability, and incident reconstruction.
5. Campaign, content, and agent-job transitions are checked by database triggers.
6. A post row cannot be created unless its content has a valid human approval.

Staging fixtures use `.test` identities, zero budgets, and no external account
references.

## Trust boundary

n8n workflows are database clients, not policy authorities. They may claim jobs
and propose outputs, but the application API and PostgreSQL constraints own
human decisions and protected state transitions. Later phases will use separate
least-privilege roles so workflow credentials cannot write approval records.

## Migration and rollback

`0001_shared_foundation.up.sql` creates only the `tanaghom` schema plus the
shared migration ledger. Its paired down migration removes the owned schema and
its ledger entry. Operators must back up persistent data before applying a down
migration outside disposable test databases.
