# Live least-privilege role migration — 2026-07-12

## Result

Migration `0004_least_privilege_roles` was applied successfully to the live
Supabase PostgreSQL project after PR #20 passed all GitHub quality gates,
including disposable PostgreSQL migration, denial, rollback, and clean-reapply
tests.

No login role, password, role membership, workflow, seed, legacy object, or
external integration was created or changed.

## Preflight

An explicit read-only transaction confirmed:

- the migration connection uses the `postgres` project role;
- it is not a superuser;
- it has `CREATEROLE` for the package migration;
- none of `tanaghom_api`, `tanaghom_n8n_worker`, or `tanaghom_readonly`
  existed;
- the existing `public` and `tanaghom` schema/table inventory was unchanged.

## Migration evidence

The runner skipped previously applied versions `0001` through `0003`, applied
only `0004`, and committed:

- three non-login, non-superuser, non-owner group roles;
- PUBLIC revocation for the Tanaghom schema objects and default function
  execution;
- current API read and bounded approval/idempotency/audit/outbox writes;
- Phase 3 n8n context reads with no direct table writes;
- select-only authoritative access for the read-only role.

Post-migration read-only inspection confirmed the three roles and ledger entry.
The schema, table, view, and extension inventory matched the preflight.

## Live privilege proof

The catalog returned:

| Assertion | Result |
| --- | --- |
| `0004` ledger entry exists | true |
| n8n can select campaigns | true |
| n8n can select approvals | false |
| n8n can insert approvals | false |
| n8n can update content | false |
| API can insert approvals | true |
| API can update content status | true |
| read-only can select campaigns | true |
| read-only can insert notifications | false |

All checks ran inside `BEGIN TRANSACTION READ ONLY` and were rolled back.

## Runtime regression check

After the migration:

- the Tanaghom dashboard health endpoint reported API ready, authentication
  configured, and database connected;
- all nine protected SmartLabs systemd services remained active;
- no n8n workflow or credential was activated.

## Rollback

`0004_least_privilege_roles.down.sql` restores the prior function-execution
default, revokes package-owned grants, and drops only the three package roles.
Disposable CI proved role removal and clean reapply. Live rollback was not run
because the forward migration and post-migration health checks succeeded.

## Remaining Issue #12 scope

Issue #12 remains open for separately reviewed environment login roles and
membership, narrow Phase 3 worker functions, missing forward schema contracts,
and legacy data mapping/cutover evidence.
