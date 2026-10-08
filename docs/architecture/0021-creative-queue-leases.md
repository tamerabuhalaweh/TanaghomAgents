# ADR 0021: PostgreSQL SKIP LOCKED queue with leases and heartbeats

Date: 2026-10-08. Status: implemented for review under #225; not deployed.
Predecessors: RECONCILIATION.md §10, `claim_agent_job` (0005),
`claim_agency_pilot`/`claim_agency_workspace_task` (0034/0035).

## Decision and scope

Creative Runtime reuses the repository's proven PostgreSQL queue pattern
instead of introducing Redis, BullMQ, Temporal, or SQS. Jobs live in
`tanaghom.creative_jobs` with a constrained status machine
(`queued → claimed → running → succeeded | failed | cancelled | expired`);
workers claim exactly one row per lane via `FOR UPDATE ... SKIP LOCKED`
ordered by priority and creation time, hold a bounded lease
(30–3600s, default 120s), renew it with heartbeats, and lose expired
leases to the `expire_creative_leases()` reaper, which moves them to
`expired` (never silently back to queued). Retry-after backoff is bounded
(0–86400s) following `record_agent_job_failure`; failures are classified
(`transient`, `deterministic`, `capacity`, `cancelled`, `policy`,
`indeterminate`) and only `transient`/`capacity`/`indeterminate` requeue
while attempts remain. Cancellation is cooperative: queued jobs cancel
immediately, active jobs set `cancel_requested` and convert at the next
worker checkpoint. Lanes (`cpu`, `gpu_image`, `gpu_video`, `gpu_audio`)
are a column value with per-lane claim filtering, not separate systems,
so long video jobs cannot starve CPU renders.

## Revisit criteria (measured, not hypothetical)

A second queue technology is justified only with disposable-load evidence
of sustained p95 claim latency above 2s at target concurrency, or worker
throughput capped by row-lock contention with queue-depth metrics
attached. Until then it is rejected as unjustified complexity: Redis
exists only in disposable phase5f test packages, never in a deployable
compose file, and would add persistence, HA, backup, secrets, and
network-surface obligations for no proven need.

## Non-goals of this decision

No worker deployment, schedule activation, or capacity claim. The pattern
is proven on disposable databases only until P8 certifies envelopes.
