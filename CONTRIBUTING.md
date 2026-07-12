# Contributing

## Branch and review flow

1. Work from an issue on a short-lived branch.
2. Keep credentials, customer data, and production endpoints out of commits.
3. Run `npm run check` and `npm test` before pushing.
4. Open a draft pull request with validation evidence and rollback notes.
5. Merge only after the phase acceptance criteria are satisfied.

## Repository boundaries

- `apps/dashboard`: the human-facing product UI.
- `services/api`: authenticated application API and business rules.
- `packages/database`: migrations, database contracts, and tests.
- `packages/contracts`: shared event and API schemas.
- `n8n/workflows`: secret-free workflow exports.
- `docs`: architecture decisions, product plans, runbooks, and evidence.

The dashboard must not depend on the n8n editor. n8n workflows and the API
coordinate through durable PostgreSQL records and events.

## Safety rules

- No workflow may publish content without re-reading a persisted human approval.
- No outbound sales message may use an unapproved template.
- Every external write requires an idempotency key.
- Every meaningful action requires a correlation ID and audit record.
- Tests use fixtures and local services only.
- Production credentials are entered into their runtime secret stores, never Git.
