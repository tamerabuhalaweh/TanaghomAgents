# Contributing

Read [current status](docs/STATUS.md) and the
[developer context contract](docs/PROJECT_CONTEXT.md) before taking a task.
Issue state, deployed state, activation and customer acceptance are distinct.

## Branch and review flow

1. Work from an issue on a short-lived branch.
2. Keep credentials, customer data, and production endpoints out of commits.
3. Run `npm run check` and `npm test` before pushing.
4. Open a draft pull request with validation evidence and rollback notes.
5. Merge only after the phase acceptance criteria are satisfied.

## Repository boundaries

- `apps/dashboard`: the human-facing UI, implemented authenticated API routes,
  and server-side business rules in `lib/server`.
- `services/api`: a reserved/documentary boundary, not a separate implemented
  service in the current deployment.
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

## Durable project context

Update `docs/STATUS.md`, affected decisions/catalog entries, and the relevant
versioned issue snapshot with each material delivery. Link exact source and
test/deployment evidence and identify untested limitations. Do not close an
issue merely because its PR merged if its acceptance includes remaining UAT.

Issues/comments and branch names are editable. Pin accepted artifacts by
commit/content hash and record actor, timestamp and scope; do not describe an
editable issue as immutable authorization. Never include secrets or raw
customer data in evidence. GitHub source recovery is not database recovery.

Only TanaghomAgents is in scope. Never infer permission to modify SmartLabs,
SmartCC, voice or Gemma service administration from an agent capability or a
linked future-department issue.
