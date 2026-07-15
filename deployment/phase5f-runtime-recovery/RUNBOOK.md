# Phase 5F n8n/Redis runtime recovery — disposable gate

## Authorization boundary

This package is CI/disposable only. It does not authorize a GPU-server test,
production deployment, live workflow activation, customer credential, provider
call, Gemma call, or any SmartLabs file, container, network, firewall, volume,
service, model, or voice-path change.

The Compose project uses uniquely scoped volumes, an internal Docker network,
no published host ports, generated disposable secrets, and the same immutable
n8n, PostgreSQL, and Redis image digests as the installed canary. Its workflow
has no credential and no external-action node.

## Why this test is representative

n8n queue mode persists execution information in PostgreSQL, passes execution
IDs through Redis, and lets workers read and update those executions. Worker
readiness checks both PostgreSQL and Redis. The shortened lock/stalled-job
values use n8n's documented queue controls. The 30-second CI lease is twice the
probe's absolute 15-second work limit; these are test values, not proposed
production values:

- <https://docs.n8n.io/hosting/scaling/queue-mode/>
- <https://docs.n8n.io/hosting/configuration/environment-variables/queue-mode/>
- <https://docs.n8n.io/hosting/logging-monitoring/monitoring/>

## Run

Prerequisites are Node 22+, Docker Engine with Compose v2, and enough disposable
space for the three pinned images and project-scoped volumes.

```sh
npm ci
N8N_RUNTIME_RECOVERY_EVIDENCE_PATH=tmp/n8n-runtime-recovery-evidence.json \
  npm run test:phase5-runtime-recovery
```

The harness:

1. generates three non-production secret files in a private temporary directory
   (the bind-mounted files are container-readable because n8n runs as non-root);
2. expands and pulls the pinned Compose stack;
3. starts disposable PostgreSQL and Redis with AOF/no-eviction;
4. imports and activates only the disposable webhook probe before starting n8n;
5. verifies main/worker readiness and metrics from inside the internal network;
6. accepts one synthetic execution, kills its active worker with `SIGKILL`,
   delivers one critical alert to a disposable HTTP sink running beside n8n on
   container loopback, records n8n's expected terminal interruption, and proves
   the same logical correlation succeeds when replayed under a new execution ID;
7. stops the worker, accepts eight more executions, records the Redis key count,
   gracefully restarts Redis, verifies AOF and preserved queue keys, restarts the
   worker, and requires every queued execution to succeed; and
8. validates the evidence contract, removes only the uniquely named disposable
   Compose project and volumes, and deletes temporary secrets.

Acceptance is nine logical work items recovered, eight queued executions
surviving Redis restart, one deliberate active execution interruption, one
successful correlation replay, zero unexpected failures, and zero unfinished
executions. The degraded alert and recovered healthy observation are required,
but `production_destination_configured` must remain false.

## Honest limits

- n8n does not resume the active interrupted execution under the same execution
  ID. Recovery requires Tanaghom's durable correlation/idempotency boundary to
  replay the logical work; the disposable probe demonstrates that behavior but
  performs no customer action. The Redis test uses a graceful stop so AOF can
  flush and does not claim sudden Redis host-loss durability.
- The workflow contains no provider/model action. Tanaghom's database-owned
  idempotency boundary remains the protection against duplicate customer
  actions in real workflows.
- The local alert sink proves payload generation and HTTP delivery only. The
  customer must choose email, Slack, WhatsApp, or another production destination
  before production monitoring can be declared configured.
- The disposable stack does not include SmartLabs, the GPU, public webhooks, or
  the production Tanaghom database.

## Controlled future server gate

A later server test requires a new explicit authorization naming the merged
commit and exact transaction. It must capture protected SmartLabs baselines,
activate all Tanaghom emergency stops, take and restore-test encrypted n8n
PostgreSQL/Redis backups, use only `.test` synthetic work, record container IDs,
apply stop conditions, and provide exact rollback. Never run this package's
`docker compose down --volumes` command against `smartlabs-n8n`; it is permitted
only for the uniquely named disposable CI project created by the harness.
