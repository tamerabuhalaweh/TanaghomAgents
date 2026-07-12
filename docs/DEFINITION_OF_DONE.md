# Definition of done

A feature is complete only when all applicable items below are satisfied.

## Product behavior

- Acceptance criteria are demonstrated from the user interface or public API.
- Loading, empty, blocked, error, retry, and recovery states are handled.
- Human approval cannot be bypassed by retries, forged events, or direct workflow
  execution.

## Engineering

- Database changes are versioned and reversible.
- External writes are idempotent.
- Structured inputs and model outputs are schema-validated.
- Automated tests cover the success path and safety guards.
- Relevant checks pass from a clean checkout.

## Operations and security

- Credentials and personal data are absent from source, fixtures, and logs.
- Every meaningful action emits a correlated audit record.
- Resource, network, ingress, and egress implications are documented.
- Monitoring and operator-visible failure behavior are defined.
- Backup, restoration, and rollback effects are documented and tested in
  proportion to risk.

## Review evidence

Every pull request records:

- What changed and why.
- Commands used for validation and their results.
- Any untested or deferred behavior.
- Required operator actions.
- Exact rollback scope.
