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
