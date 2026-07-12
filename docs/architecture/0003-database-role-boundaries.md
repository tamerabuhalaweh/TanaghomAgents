# ADR 0003: Least-privilege database role boundaries

- Status: Accepted for Phase 3 readiness
- Date: 2026-07-12

## Context

The dashboard and n8n currently use administrative connection material during
foundation work. Phase 3 cannot activate agent workflows while an n8n
credential could insert human approvals or directly advance protected content
state.

## Decision

Create three package-owned, non-login group roles:

| Role | Direct access |
| --- | --- |
| `tanaghom_api` | All authoritative reads; inserts for approval, API idempotency, audit, and outbox records; column-level updates only for content status and API idempotency responses |
| `tanaghom_n8n_worker` | Phase 3 context reads for campaigns, strategies, agents, jobs, content, and outbox; no direct table writes and no approval-table access |
| `tanaghom_readonly` | Select-only access to authoritative tables |

PUBLIC receives no Tanaghom schema/table/sequence access and cannot execute
Tanaghom functions by default. Future objects receive no implicit PUBLIC
function execution.

The group roles have `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`,
`NOINHERIT`, `NOREPLICATION`, and `NOBYPASSRLS`. Environment-specific login
roles and passwords are operational secrets and are not created by source
migrations. A later reviewed operation may grant one group role to each login
identity.

## Agent mutation rule

n8n receives no table-level insert, update, or delete privilege. Phase 3 agent
mutations will be exposed through narrow `SECURITY DEFINER` functions that:

- set a fixed safe `search_path`;
- validate job ownership, state, correlation, and attempt;
- accept versioned payloads;
- perform one bounded transaction;
- emit correlated audit/outbox evidence;
- never insert `content_approvals` or impersonate a human actor.

Phase 3 worker mutations are exposed only through explicitly granted,
transactional `SECURITY DEFINER` functions with a fixed `pg_catalog, pg_temp`
search path. The functions validate contract versions and state transitions,
write correlated audit/outbox evidence, and cannot complete a content job while
any generated item still lacks a protected human decision. Direct n8n table
writes remain denied.

Each function must explicitly revoke PUBLIC execution and grant execution only
to `tanaghom_n8n_worker`.

## Consequences

- The application and worker require separate login credentials before Phase 3
  runtime activation.
- Adding a new agent capability requires an explicit forward grant or bounded
  function; tables are not granted automatically.
- Phase 4 publishing will read approval eligibility through a controlled
  function rather than direct approval-table access.
- Administrative migration credentials remain separate and must not be stored
  in n8n.

## Rollback

Migration `0004_least_privilege_roles.down.sql` restores the prior function
execution default, revokes package-owned grants, and drops only the three
package roles. It must run before environment-specific login-role membership is
introduced or after those memberships are explicitly removed.
