# Phase 5F n8n/PostgreSQL/Redis retention — disposable evidence

## Authorization and SmartLabs boundary

This package is repository and disposable-CI work only. It does **not**
authorize a GPU-server connection, production Compose change, container
restart, volume operation, firewall change, provider call, model call, or any
inspection or modification of a SmartLabs file, service, container, volume,
network, port, model, prompt, or real-time voice path.

The harness creates a uniquely named local Compose project, uses an internal
network with no published ports, generates temporary secrets, performs only
synthetic executions, and removes only that project and its volumes. Never run
its `docker compose down --volumes` command against any installed n8n or
SmartLabs project.

## Evidence objective

The gate measures the storage shape that was still missing from Issue #55:

1. PostgreSQL database and logical execution-data growth;
2. Redis memory and AOF growth while real n8n queue work is waiting;
3. n8n's own count-based soft/hard execution pruning;
4. ordinary PostgreSQL vacuum after pruning;
5. Redis AOF compaction without deleting queue keys; and
6. encrypted pre-prune backup restoration into a uniquely named disposable
   database with execution count and digest verification.

The test uses the same immutable n8n 2.26.8, PostgreSQL 16.14, and Redis 7.2.14
images as the prior Phase 5F runtime gate. The retention overlay starts with
pruning disabled, captures its pre-prune backup, drains queued work, and only
then recreates the disposable n8n main/worker with pruning enabled. It never
issues SQL `DELETE`, Redis `DEL`, `FLUSHDB`, or `FLUSHALL`.

Official behavior references:

- <https://docs.n8n.io/hosting/scaling/execution-data/>
- <https://docs.n8n.io/hosting/configuration/environment-variables/executions/>
- <https://docs.n8n.io/hosting/scaling/queue-mode/>
- <https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/>
- <https://redis.io/docs/latest/commands/bgrewriteaof/>

## Run the disposable gate

Prerequisites are Node 22+, Docker Engine, Docker Compose v2, and space for the
pinned images and uniquely scoped temporary volumes.

```sh
npm ci
N8N_RETENTION_EVIDENCE_PATH=tmp/n8n-retention-pruning-evidence.json \
  npm run test:phase5-retention
```

Defaults are 60 completed executions, 40 executions accepted while the worker
is stopped, a 16 KiB synthetic incompressible request payload, and a 20-row
test retention cap. These are evidence settings, not production limits.

## Proposed policy — inert until separately approved

`retention-policy.env` proposes:

```dotenv
EXECUTIONS_DATA_SAVE_ON_ERROR=all
EXECUTIONS_DATA_SAVE_ON_SUCCESS=all
EXECUTIONS_DATA_SAVE_ON_PROGRESS=false
EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=true
EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=168
EXECUTIONS_DATA_PRUNE_MAX_COUNT=10000
EXECUTIONS_DATA_HARD_DELETE_BUFFER=1
```

This retains successful/error/manual execution evidence for debugging, avoids
per-node progress writes, and bounds finished history by both seven days and
10,000 rows. Running/waiting executions and annotated executions have separate
n8n protections. Tanaghom's PostgreSQL audit trail remains the authoritative
business record; n8n history is operational evidence, not the approval ledger.

The proposed values are not applied to production by this package. Before a
future canary, remeasure with representative customer payloads, compare the
projection with actual free space, take an encrypted off-server backup, test
that restore, and review an exact server-specific Compose diff and rollback.

## Interpreting disk evidence honestly

- The artifact projects only the tested payload shape. Large binary files,
  unusually large model responses, verbose node progress, or different
  workflows require a new measurement.
- PostgreSQL ordinary `VACUUM` makes deleted space reusable inside the database
  but does not promise that the database files shrink. The evidence therefore
  records `physical_file_shrink_claimed=false`.
- `VACUUM FULL` is deliberately excluded because it rewrites and locks tables.
  Any physical shrink operation requires a separate maintenance-window design.
- Redis AOF rewrite compacts historical commands while preserving the logical
  keyspace. It can temporarily consume CPU, memory, and disk I/O; production
  use requires headroom, a verified backup, and monitoring.
- The illustrative 75,000-item burst is a projection only and never a capacity
  or production SLA claim.

## Rollback model

Pruned execution data cannot be undeleted in place. The only honest rollback
is restoration from the encrypted pre-prune backup:

1. keep production paused and emergency stops active;
2. restore the backup into a new, uniquely named PostgreSQL database or volume;
3. verify schema, execution count, workflow count, and content digests before
   any switch;
4. point only the reviewed n8n services at the verified recovery database in a
   separate transaction; and
5. retain the old database untouched until acceptance completes.

The disposable harness proves steps 2–3 and then removes its recovery database.
It does not include or authorize production service-switch commands. Reverting
the policy itself means restoring the exact pre-change environment values and
recreating only the separately approved n8n main/worker services; never remove
or recreate PostgreSQL/Redis volumes as a configuration rollback.

## Future production gate

A future server transaction must be separately approved by Tamer and must name
the merged commit, exact n8n Compose files/services, backup destination,
preflight free-space threshold, health checks, stop conditions, validation,
and rollback commands. It must explicitly exclude every SmartLabs resource.
