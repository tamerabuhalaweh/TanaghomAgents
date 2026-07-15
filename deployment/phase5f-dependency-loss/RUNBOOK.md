# Phase 5F sudden dependency loss — disposable gate

## Authorization boundary

This package is local/CI disposable evidence only. It does **not** authorize a
GPU-server connection, production deployment, customer credential, provider or
Gemma call, or inspection/modification of any SmartLabs file, container,
network, firewall, volume, service, model, or voice path.

The harness creates a unique Compose project, unique PostgreSQL/Redis/n8n
volumes, generated temporary secrets, an internal-only network, and no host
ports. Cleanup targets only that generated project name.

## What the drill proves

n8n queue mode stores execution state in PostgreSQL and uses Redis as the job
broker. The worker is deliberately stopped while each synthetic batch is
accepted, so every execution is durable before dependency failure. The harness:

1. validates and pulls the immutable n8n 2.26.8, PostgreSQL 16.14, and Redis
   7.2.14 images;
2. imports/publishes only the credential-free disposable recovery probe;
3. accepts 20 `redis-loss-*` executions, records Redis keys, and sends
   `SIGKILL` to Redis;
4. requires container exit code 137 and an independent `redis_unavailable`
   alert, restarts Redis, verifies equal key counts and completed AOF replay,
   then drains all 20 correlations exactly once;
5. accepts 20 `postgres-loss-*` executions, records a digest of accepted n8n
   execution rows, and sends `SIGKILL` to PostgreSQL;
6. requires exit code 137 and `postgres_unavailable`, restarts PostgreSQL,
   requires WAL crash-recovery logs plus an unchanged accepted-row digest and
   unchanged Redis key count, then drains all 20 correlations exactly once;
7. validates the strict evidence schema and removes only the disposable project.

The test contains no external-action node. `provider_calls`, `gemma_calls`, and
`external_actions` must all remain zero.

Docker sends `SIGKILL` by default when no signal is specified, and exit 137 is
the observable killed-container state. PostgreSQL WAL is the recovery mechanism
after an abrupt process failure. Redis uses AOF with `appendfsync always` for
this deliberately strict disposable durability profile:

- <https://docs.docker.com/reference/cli/docker/container/kill/>
- <https://docs.docker.com/reference/cli/docker/container/ls/>
- <https://www.postgresql.org/docs/16/wal-intro.html>
- <https://www.postgresql.org/docs/16/wal-reliability.html>
- <https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/>
- <https://docs.n8n.io/hosting/scaling/queue-mode/>

## Run

Prerequisites are Node 22+, Docker Engine, Compose v2, and disposable disk space
for the already pinned images and unique volumes.

```sh
npm ci
N8N_DEPENDENCY_LOSS_EVIDENCE_PATH=tmp/n8n-dependency-loss-evidence.json \
  npm run test:phase5-dependency-loss
```

The defaults are 20 Redis-loss and 20 PostgreSQL-loss executions. CI may set
`N8N_DEPENDENCY_REDIS_EXECUTIONS` and
`N8N_DEPENDENCY_POSTGRES_EXECUTIONS`, but the schema refuses fewer than five
for either loss.

## Acceptance

- both dependency containers exit 137 after explicit `SIGKILL`;
- all accepted Redis and PostgreSQL batches recover;
- each submitted logical correlation succeeds exactly once;
- zero unexpected failed or unfinished executions;
- zero lost correlations or duplicate external actions;
- Redis key count and PostgreSQL accepted-state digest survive their respective
  crashes;
- exactly one independent alert is recorded for each dependency loss;
- final dependency observation is healthy; and
- schema validation preserves the no-server/no-SmartLabs/no-provider boundary.

## Observed monitoring behavior

The July 15, 2026 default local run recovered all 40/40 correlations. n8n's
native main readiness detected PostgreSQL loss but remained ready while its
Redis client was reconnecting. Therefore native readiness is recorded as
evidence, not treated as the sole dependency alarm. The independent raw
PostgreSQL socket and authenticated Redis PING observer is mandatory.

## Honest limits

- Exactly-once here means one successful n8n result per synthetic correlation.
  Real provider safety still requires Tanaghom's database-owned idempotency and
  indeterminate-operation controls.
- The observer writes to a disposable NDJSON sink. A customer-selected
  production notification destination is not configured or tested.
- This is process/container loss on one Docker host, not host-disk loss,
  corrupted storage, network partition, multi-node failover, or a production
  SLA.
- `appendfsync always` is the tested safety profile; its production latency and
  throughput must be measured before any separately approved configuration
  change.
- Never point this harness at another Compose project and never run its
  `down --volumes` cleanup against the installed Tanaghom or SmartLabs stacks.
