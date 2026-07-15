# 0009 — Governed GoHighLevel actions

## Decision

Tanaghom treats every CRM mutation as a versioned action job, never as an
unbounded tool call. Supported actions are message, qualification, tag,
assignment, appointment, opportunity, nurture, won, and lost. An organization
selects one of four policies: manual, shadow, assisted, or bounded autonomous.
Manual and an active emergency stop are the defaults.

Message actions additionally enforce channel consent/DND, approved proactive
template versions, allowed channels, quiet hours, a 24-hour contact frequency
cap, current conversation ownership, and the current ownership epoch. The same
authority and emergency conditions are checked again immediately before the
provider boundary. A human takeover or expired AI lease therefore invalidates
already queued message work.

## Execution boundary

n8n receives function execution only. It claims and prepares a database-owned
job, then calls the private dashboard integration gateway. It cannot read the
customer's GHL credential or write action, approval, outcome, conversation, or
lead tables. The gateway validates an exact v1 dispatch contract, locks the
matching operation, rechecks its fingerprint and ownership authority, marks
the dispatch receipt, and only then decrypts the customer-owned credential.

Qualification and nurture are internal state transitions. Provider operations
are allowlisted for messages, tags, contact assignment, appointments, and
opportunity/status updates. Arbitrary URLs, methods, paths, bodies, and customer
tokens never enter the workflow export.

## Failure and approval model

The organization emergency stop and platform emergency stop block queueing,
approval, claiming, preparation, and gateway dispatch. Opt-out or DND cancels
queued proactive messages. Assisted or sensitive AI actions wait for an
immutable human approval; shadow work records a zero-external-action outcome.

Idempotency keys and request fingerprints make retries replay-safe. A timeout,
connection loss, HTTP 408, or provider 5xx after dispatch is indeterminate and
blocks further organization action claims until a human reconciles it. Tanaghom
does not blindly retry an operation whose external result is unknown. Outcome
rows are append-only so approvals, dispatch, failure, delivery, and future
reconciliation remain auditable.
