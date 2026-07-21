# Controlled content-job reconciliation runbook

## Outcome and boundary

The package reconciles one content-generation job that remains
`waiting_approval` after every generated draft has a final decision from an
active human in the campaign organization.

The only business mutation is:

```sql
SET LOCAL ROLE tanaghom_n8n_worker;
SELECT tanaghom.complete_content_job('<reviewed-job-id>'::uuid);
```

Supabase intentionally stores the operator-to-worker membership as
`ADMIN TRUE, INHERIT FALSE, SET FALSE`. The same serializable transaction
temporarily changes only `SET` to `TRUE`, assumes the worker role, invokes the
function, revokes only its temporary self-granted membership row, verifies the
original grantor's row remains exactly `ADMIN TRUE, INHERIT FALSE, SET FALSE`,
and then commits. The uncommitted role-option change is not a durable privilege
expansion. A failure before commit rolls back both changes.

The controlled function changes that job to `succeeded`, populates
`finished_at`, returns its Content Producer agent to `idle`, and appends one
immutable `content.review_completed` audit action. The package makes no direct
table write.

## Preconditions

- The package PR is approved and merged.
- The production dashboard checkout remains at the reviewed baseline commit.
- A separate clean checkout contains the approved reconciliation source.
- Migration `0022_agent_registry` is current.
- The original canary evidence checksum and human-approval marker are valid.
- The exact campaign and job are still zero-budget `.test` records.
- Every generated item is `approved` or `rejected` with a matching decision
  from an accepted, active human in the same organization.
- The target job is `campaign.content.generate / waiting_approval`, has no
  prior completion audit, and its Content Producer is `waiting_approval`.
- The operator is non-superuser with `CREATEROLE` and exactly
  `ADMIN TRUE, INHERIT FALSE, SET FALSE` membership in
  `tanaghom_n8n_worker`.
- Both core workflows and registry entries are inactive.
- No provider job, post, lead, external operation, or unrelated canary job
  exists.
- Provider and CRM emergency stops remain active.

## Environment

Set these only in the authorized operator shell. Do not place passwords or
database URLs in shell history.

```sh
export TANAGHOM_JOB_RECONCILIATION_AUTHORIZATION='YES-I-AM-THE-AUTHORIZED-OWNER'
export TANAGHOM_JOB_RECONCILIATION_ID='jobreconcile-YYYYMMDDTHHMMSSZ'
export TANAGHOM_CANARY_ID='corecanary-20260719T144142Z'
export TANAGHOM_CANARY_CAMPAIGN='Tanaghom controlled core canary corecanary-20260719T144142Z.test'
export TANAGHOM_CONTENT_JOB_ID='49333772-19e9-4e00-8ef3-ae85e91f619f'
export TANAGHOM_EXPECTED_PRODUCTION_COMMIT='<current 40-character production commit>'
export TANAGHOM_RECONCILIATION_SOURCE_COMMIT='<approved merged package commit>'
export TANAGHOM_CANARY_SOURCE_COMMIT='76b79e79865dee4e8c77770359941c7bfdb5c1a8'
export TANAGHOM_PRODUCTION_ROOT='/opt/tanaghom-dashboard'
export TANAGHOM_RELEASE_SOURCE_ROOT='<clean approved checkout>'
```

## Read-only preflight

```sh
sudo -E deployment/phase6-content-job-reconciliation/scripts/preflight.sh
```

It must print `PASS`. It locks nothing persistently and changes no database,
workflow, evidence, service, or firewall state.

## Controlled execution

This is a separate authorization point after preflight review:

```sh
export TANAGHOM_JOB_RECONCILIATION_EXECUTE='YES-COMPLETE-THE-REVIEWED-CONTENT-JOB'
sudo -E deployment/phase6-content-job-reconciliation/scripts/reconcile-job.sh
```

The operator opens a serializable transaction, locks the target context,
repeats every decision and side-effect check, switches locally to
`tanaghom_n8n_worker` through the transaction-local membership option, invokes
the controlled function once, resets the role, revokes only the temporary
self-grant, verifies the exact result and original membership, and commits. The
role switch and transaction role are captured in secret-free JSON evidence. It
never exports or decrypts the n8n PostgreSQL credential.

Evidence is written with mode `0700/0600` under
`/var/backups/tanaghom-$TANAGHOM_JOB_RECONCILIATION_ID`.

## Failure and rollback semantics

Before commit, any error rolls the serializable transaction back completely.
After the function commits, the job completion and immutable audit action are
intentional final facts and must not be reversed by direct SQL.

If the client disconnects or a later validation fails:

1. Do not retry the function blindly.
2. Preserve the evidence directory unchanged.
3. Run the read-only preflight again.
4. If the job is `succeeded` with exactly one completion audit, treat the
   mutation as committed and investigate only the failed validation.
5. If the job is still `waiting_approval` with zero completion audits, a new
   execution requires a new reconciliation ID and separate authorization.
6. Any other state is indeterminate and requires a reviewed incident procedure.

There is intentionally no command that changes a succeeded job back to
`waiting_approval` or deletes its audit record.

## Success gate

- The controlled function returns `true` exactly once under
  `tanaghom_n8n_worker`.
- The job is `succeeded` with `finished_at` populated.
- The Content Producer is `idle`.
- Exactly one `content.review_completed` audit action exists.
- Both core workflows remain inactive and execution counts do not change.
- Every unrelated n8n workflow remains unchanged.
- Provider jobs, posts, leads, and external operations remain zero for the
  canary.
- Protected containers, services, public boundary, and firewall policy remain
  unchanged.
- Evidence checksums verify.

Passing this gate performs job-state bookkeeping only. It does not authorize
workflow activation, automatic publishing, Postiz/GHL dispatch, or broader
agent rollout.
