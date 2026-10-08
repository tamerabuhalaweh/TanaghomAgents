# ADR 0023: Creative worker least-privilege database role

Date: 2026-10-08. Status: implemented for review under #225; not deployed.
Predecessors: ADR 0003 (database role boundaries), 0004 roles,
0030/0034 worker roles, RECONCILIATION.md §9.4.

## Decision and scope

Create `tanaghom_creative_worker` (`NOLOGIN … NOBYPASSRLS`, same stanza as
all package roles) with `USAGE ON SCHEMA tanaghom` and `EXECUTE` on
exactly seven controlled functions: `claim_creative_job`,
`mark_creative_job_running`, `heartbeat_creative_job`,
`complete_creative_job`, `fail_creative_job`, `expire_creative_leases`,
and `create_creative_asset_version`. The role receives no table
privileges at all — not even `SELECT` — so every worker read and write
passes through `SECURITY DEFINER` functions that enforce tenancy,
worker-identity match, lease validity, state-machine legality, and audit
writes in one transaction. `tanaghom_api` keeps `SELECT` on the nine new
tables plus `EXECUTE` on the four human-path functions (`create`,
`request_cancel`, `decide`, `set_control`); in particular the worker
cannot enqueue, decide, or change controls, and the API cannot silently
rewrite jobs (no `UPDATE` grant — all mutations are function calls).
`PUBLIC` is revoked from all new objects, consistent with 0004.

## Non-goals of this decision

No worker deployment, no separate worker database connection, no vault
reads for the worker role. Provider credentials, when they exist in a
later phase, are decrypted only inside the private gateway, never
granted to this role.
