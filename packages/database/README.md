# Database package

This package is the durable system of record for the dashboard and agents.

## Commands

Set `DATABASE_URL` for operator migrations or `DATABASE_TEST_URL` for acceptance
tests.

```bash
npm run db:migrate
npm run db:rollback
npm run test:database
```

Migrations are ordered, transactional SQL pairs. Rollback removes only the
objects owned by the migration. `test:database` applies the schema, loads safe
fixtures, executes database-level safety assertions, rolls back, proves removal,
then reapplies to prove recovery.

## Enforced invariants

- Approved content requires an attributable decision by an active human user.
- Rejection decisions require a reason.
- Agent action logs cannot be updated or deleted.
- External side effects have unique provider-scoped idempotency keys.
- Agent jobs and events carry correlation IDs.
- Leads can be explicitly retained for future campaigns.
- GHL actions require current conversation ownership, organization policy, and
  platform readiness at queue, claim, preparation, and dispatch boundaries.
- Proactive messages require explicit channel consent, an approved versioned
  template, allowed hours, and remaining frequency capacity.
- GHL worker roles execute controlled functions only; they cannot write action,
  approval, outcome, conversation, lead, or credential tables.
- Unknown post-dispatch outcomes become indeterminate and block further action
  claims until reconciled; action outcomes are append-only.
- Human reconciliation is tenant-bound, append-only, reasoned, and idempotent
  by command ID; it updates the job and matching provider operation together.
- Service-agent GHL queue and completion audit rows retain their organization
  service actor; anonymous action audit records remain invalid.
