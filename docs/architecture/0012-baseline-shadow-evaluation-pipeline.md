# 0012 — Baseline and shadow evaluation pipeline

Status: accepted design; production deployment remains separately authorized.

## Decision

Tanaghom compares reviewed human work with AI proposals before enabling assisted
or autonomous messaging. An owner first approves versioned metric formulas and
thresholds, then imports a bounded JSON dataset of reviewed, de-identified
conversations using the published schema and template.

The database rejects imports without a positive PII-removal attestation and
rejects common email, phone, bearer-token, and connection-string patterns. This
is a guardrail, not a substitute for the customer's source-data review.

Human baseline metrics are aggregated into the append-only quality snapshot
ledger. Only after the owner promotes the policy to `shadow` can Tanaghom queue
one offline evaluation job per imported case.

The Quality Shadow Evaluator is an inactive n8n export with a disabled schedule.
It may claim jobs only through `claim_quality_shadow_job()`, call the approved
Gemma boundary, and persist through controlled result or failure functions. It
has no table-write permission. Its result contract requires
`external_action_count: 0`; it has no GHL, Postiz, channel, publishing, or
messaging node.

## Evidence lifecycle

1. Owner approves metric program vN.
2. Owner imports a reviewed, de-identified human dataset.
3. Owner records the human baseline snapshot.
4. Owner separately authorizes the shadow stage.
5. Platform operator runs the inactive evaluator under controlled execution.
6. Owner records the completed AI shadow comparison.
7. Existing quality gates decide whether assisted mode is eligible for review.

No step activates a workflow, sends a message, publishes content, changes a
provider credential, or clears an emergency stop.

## Verification

- Disposable migration, invariants, rollback, and clean reapply.
- Pinned n8n with disposable PostgreSQL and simulated Gemma.
- Contract, inactive-trigger, retry, least-privilege, and zero-action assertions.
- Dashboard TypeScript, build, API, repository, and secret-shape checks.
