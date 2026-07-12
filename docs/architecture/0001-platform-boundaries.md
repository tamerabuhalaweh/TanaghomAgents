# ADR 0001: Platform boundaries

- Status: Accepted
- Date: 2026-07-12

## Context

Tanaghom Agents needs a polished business interface, durable multi-agent state,
safe external integrations, and a private automation engine. Treating the n8n
editor as the product UI would expose implementation details and make approval,
authorization, and reporting harder to enforce consistently.

## Decision

Use four explicit platform boundaries:

1. A dedicated web dashboard for business users.
2. An authenticated application API that owns authorization and business-state
   transitions.
3. PostgreSQL as the source of truth, event ledger, and audit record.
4. Private n8n workflows that claim durable jobs and call approved integrations.

Agents communicate through database records and transactional events. They do
not call one another directly. External calls are performed only from durable
jobs with idempotency keys. Approval is a database fact attributed to a human,
not trust placed in an inbound webhook.

## Consequences

- The n8n editor remains an engineering tool and may stay behind SSH access.
- The public product can evolve independently of workflow implementation.
- A workflow retry cannot silently invent state or bypass API authorization.
- Database migration and event contracts become core versioned artifacts.
- The application requires explicit authentication and authorization before a
  public link is delivered.
