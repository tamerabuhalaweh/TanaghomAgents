# Live controlled worker functions — 2026-07-12

## Result

Migration `0005_controlled_worker_functions` was applied successfully to the
existing Supabase `tanaghom` schema after PR #25 passed all five CI jobs. The
merged recovery-source commit is
`17a82b3ebb78e1f4a53f02967cc25344b09957d0`.

The migration created five transactional `SECURITY DEFINER` functions:

- `claim_agent_job`;
- `persist_strategy_result`;
- `persist_content_result`;
- `record_agent_job_failure`; and
- `complete_content_job`.

No workflow was imported or activated. No job, campaign, strategy, content,
approval, audit, or outbox fixture was written to the live database during
verification.

## Disposable database evidence

GitHub Actions run `29203605476` passed migration idempotency, worker success
paths, missing-information blocking, bounded retries, retry exhaustion,
strategy provenance, content persistence, audit/outbox creation, direct-write
denials, protected human approval, post-decision completion, `0005` rollback,
complete schema rollback, and clean reapplication.

The content completion function returned false before a protected API-role
human decision and succeeded only after the database-enforced approval fact and
content transition existed.

## Live read-only verification

An explicit read-only transaction returned:

| Assertion | Result |
| --- | --- |
| Migration ledger contains `0005` | true |
| Controlled function count | 5 |
| n8n can execute job claim | true |
| n8n can execute protected completion check | true |
| readonly role can execute job claim | false |
| n8n can read approvals | false |
| n8n can insert approvals | false |
| n8n can update content directly | false |
| PUBLIC execute grants on the five functions | 0 |

The private dashboard continued to report API `ready`, authentication
`configured`, and database `connected`. All nine protected GPU, voice-agent,
SmartLabs, SmartCC, and Nginx units remained active.

## Remaining gate

The live functions are inert until a dedicated n8n login receives membership
in `tanaghom_n8n_worker` and inactive Phase 3 workflows are imported. Those
steps require the next credential and shadow-mode validation package; this
migration does not activate them.
