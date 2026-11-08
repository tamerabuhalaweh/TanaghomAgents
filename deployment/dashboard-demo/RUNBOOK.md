# Dashboard deployment runbook (#243) — Phase 1 production host

> **Current target:** `13.60.253.82`, root `/home/ubuntu/tanaghom-demo`. This runbook
> documents the Phase 1 cutover that runs there today: dashboard, PostgreSQL 17,
> RustFS, the `gemini-3.6-flash` workspace worker and a draft-only Postiz stack.
> The historical Astra host is retired and is not a target for any step below.
> Take a verified backup (`demo-backup.sh`) before changing anything.

## Target contract

- Production host: `13.60.253.82`, operator `ubuntu`, root `/home/ubuntu/tanaghom-demo`.
- Dashboard listener: only `127.0.0.1:3210`; access through a private SSH tunnel.
- Postiz UI: only `127.0.0.1:5000`; the dashboard reaches its API internally at
  `http://postiz:5000/api/public/v1`.
- Existing canary: `127.0.0.1:3200`; never stop, rewrite, reuse, or proxy it.
- Isolated project/volumes/networks are all prefixed `tanaghom-dashboard-demo`.
- Fresh demo database, private demo bucket, synthetic owner/reviewer accounts.
- No nginx, DNS, TLS, production flag, real provider, sending, or publishing change.
- Only a reviewed release runs here, reached over SSH with the operator key.

## Prerequisites on the production host

Docker Engine with Compose v2, `bash`, `openssl`, `python3`, `curl`, `ss`, at least 10 GB free
space, and port `3210` unused. Do not use host port `5432`; it belongs to an unrelated container.

Place the reviewed source and private runtime outside canary paths:

```sh
/home/ubuntu/tanaghom-demo/source
/home/ubuntu/tanaghom-demo/runtime/secrets
```

Check out the exact reviewed commit in `source`; the worktree must be clean.

## Prepare secrets

The deploy script creates these for a fresh demo only. If an existing runtime has missing or
partial secrets, stop and restore the matching secrets; do not regenerate them or reset volumes.

```sh
cd /home/ubuntu/tanaghom-demo/source
bash deployment/dashboard-demo/scripts/prepare-runtime.sh /home/ubuntu/tanaghom-demo/runtime/secrets
chmod 0700 /home/ubuntu/tanaghom-demo/runtime/secrets
# The script makes shared secret files 0444 so non-root containers can read the bind mounts.
# demo-credentials.txt stays 0600. Do not chmod all files to 0600.
```

Read the private demo account passwords from
`/home/ubuntu/tanaghom-demo/runtime/secrets/demo-credentials.txt`. Never copy that file into git,
logs, issue comments, or chat.

The runtime also contains `workspace_password`, `workspace_database_url`,
`workspace_worker_token`, and an empty `gemini_api_key` placeholder. The deploy script can add the
workspace files to an existing #243 runtime without overwriting existing secrets. It never creates
a fake provider key.

## Gemini key and workspace activation

The workspace is disabled by default and makes no provider call until an operator explicitly
installs a key and activates the isolated worker. Keep the key outside the source tree and never
put it in an environment variable, image, log, or evidence file.

**Do not activate yet.** Starting the worker and setting the environment flag alone do not
enable the database workspace control or release the platform emergency stop. A reviewed,
audited, demo-only control procedure and a full-stack test are still required.

Activate only through the reviewed wrapper `scripts/workspace-control.sh enable --change-id <ref> --authorization APPROVED-ISOLATED-DEMO-CONTROL`, which runs `sql/workspace-control.sql` after proving no other compose project runs on the host. The transaction requires the exact demo database,
demo owner, migration baseline, a unique change reference, and the isolated-demo authorization
marker. It refuses activation when the independent pilot lane, Postiz stop, other runtime jobs,
or any queued or in-flight pilot/workspace task are unsafe. It atomically records before/after controls and
either enables the workspace or restores both stops. This is an operator audit record, not
tamper-proof evidence against the database administrator.

**Critical:** the global stop also covers other agent runtimes. Database checks alone cannot
prove other workers or gateways are stopped or prevent their concurrent activation. Before
this transaction can be used, the operator must prove the exact disposable host and Compose
project, verify all provider execution flags and unrelated workers are disabled, and confirm
the database is exclusive to this demo. The SQL has only been exercised on disposable PostgreSQL
18, not the pinned PostgreSQL 17 container. There is no authorization to run it on a server yet.
Stopping future claims does not cancel an in-flight provider request; wait for it to settle and
investigate unknown outcomes before taking further action.

The dashboard reads `/run/secrets/gemini_api_key` on each request; `cp` updates the existing bind
mount in place. If the key is replaced with a new inode, recreate only the demo dashboard.
Activation logs must contain no key material. This host keeps the workspace enabled through
`deployment/dashboard-demo/.env`; `deploy.sh` refuses an existing database, so data changes go
through the backup-verified upgrade. To quiesce the worker by hand for an inspection:

```sh
TANAGHOM_DEMO_SECRETS_DIR=/home/ubuntu/tanaghom-demo/runtime/secrets \
  docker compose -p tanaghom-dashboard-demo -f deployment/dashboard-demo/compose.yml \
  --profile workspace stop workspace-worker
```

The worker polls the internal dashboard endpoint with the 64-hex worker token. It has no host
port, no database credentials, no provider key, and no external-action capability. The Gemini
model (`gemini-3.6-flash`) is verified against the provider inventory (cached for ten minutes per
dashboard process) before specialist requests; failures are recorded as explicit workspace errors and stop further inference for human
review.

## Host configuration contract (`deployment/dashboard-demo/.env`)

`compose.yml` defaults every Phase 1 switch to its inert value, so an unset key
silently disables a feature instead of failing. The live host state therefore
lives in an untracked `.env` beside the compose file (mode `0600`, git-ignored).
`deploy.sh`, `demo-backup.sh`, `demo-upgrade.sh`, `demo-restore.sh` and
`workspace-control.sh` all pass it with `--env-file` when it exists, so a rebuild
keeps the same behaviour. Start from the tracked template:

```sh
cp deployment/dashboard-demo/.env.example deployment/dashboard-demo/.env
chmod 0600 deployment/dashboard-demo/.env
```

| Key | This host | Meaning |
| --- | --- | --- |
| `AGENCY_WORKSPACE_ENABLED` | `true` | Offer the Agency workspace and let the worker run |
| `INTEGRATION_CREDENTIAL_KEY` | generated, kept | Base64 of 32 random bytes (`openssl rand -base64 32`); losing it makes stored provider credentials undecryptable |
| `INTEGRATION_CREDENTIAL_KEY_VERSION` | `1` | Version bound to each encrypted credential row |
| `POSTIZ_ALLOWED_BASE_URLS` | `http://postiz:5000/api/public/v1` | Exact plain-http exception for the private Postiz API |
| `POSTIZ_HANDOFF_ENABLED` | `true` | Queue approved content as Postiz drafts only |
| `POSTIZ_AUTOMATION_RUNTIME_READY` | `false` | Keeps automatic draft mode unavailable |
| `POSTIZ_PERFORMANCE_SYNC_ENABLED` | `false` | Analytics sync stays off for Phase 1 |

## Workspace worker lifecycle

`AGENCY_WORKSPACE_ENABLED=true` is only half the contract: the worker container
must be running too, and it lives in the `workspace` compose profile, so a plain
`up -d` does not start it. `demo-upgrade.sh` and `demo-restore.sh` stop it to
quiesce the stack and now restart it after the dashboard is healthy whenever the
flag is `true`, printing `WORKSPACE_WORKER_STARTED enabled` (or
`WORKSPACE_WORKER_SKIPPED disabled`). Start it by hand with:

```sh
docker compose -p tanaghom-dashboard-demo -f deployment/dashboard-demo/compose.yml \
  --env-file deployment/dashboard-demo/.env --profile workspace up -d workspace-worker
```

A healthy worker logs `workspace_task_finished status=succeeded` and then
`workspace_worker_waiting_for_activation`.

## Deploy

Run this as root from a clean checkout. Use the exact reviewed SHA for both values. The
authorization string is an explicit operator guard, not a production secret.

```sh
cd /home/ubuntu/tanaghom-demo/source
TANAGHOM_DEMO_DEPLOY_AUTHORIZATION=GO-DEPLOY-TANAGHOM-243-DEMO \
EXPECTED_DEMO_RELEASE=<reviewed-sha> \
TANAGHOM_DEMO_ROOT=/home/ubuntu/tanaghom-demo \
bash deployment/dashboard-demo/scripts/deploy.sh
```

The script validates compose boundaries, refuses a dirty/short check out, builds the dashboard,
starts only the isolated project, waits for health, and runs the non-mutating smoke. It does not
remove or modify the canary.

Expected database marker:

```text
DEMO_DATABASE_READY migrations=45
```

There are 45 up migrations, ending at `0048_gemini_workspace_model`; numbering gaps `0041`-`0043` are
intentional. The role/ledger guard requires exactly that chain.

## Validate

```sh
cd /home/ubuntu/tanaghom-demo/source/deployment/dashboard-demo
TANAGHOM_DEMO_SECRETS_DIR=/home/ubuntu/tanaghom-demo/runtime/secrets TANAGHOM_DEMO_RELEASE=<reviewed-sha> \
  SMOKE_WRITE=0 bash scripts/validate.sh
TANAGHOM_DEMO_SECRETS_DIR=/home/ubuntu/tanaghom-demo/runtime/secrets TANAGHOM_DEMO_RELEASE=<reviewed-sha> \
  SMOKE_WRITE=1 SMOKE_REJECT=1 bash scripts/validate.sh
```

Expected markers: `PARSED_DEMO_COMPOSE_BOUNDARIES_PASSED`, `PASS private S3 upload and preview`,
`PASS reviewer approval decision`, `PASS reviewer rejection decision`, and `DEMO_VALIDATION_PASSED`
(the write run also ends with `DEMO_SMOKE_PASSED`).

The write run consumes two seeded approval fixtures and intentionally fails if they are already
decided. Do not reset retained volumes to repeat it; use an isolated disposable test environment.

Only `127.0.0.1:3210` may be published. Postgres, auth, storage, migration, and bucket-init must
have no host port bindings.

## Private access

Use the SSH identity supplied by Astra:

```sh
ssh -N -i <operator-key> -L 3210:127.0.0.1:3210 -L 5000:127.0.0.1:5000 ubuntu@13.60.253.82
```

Open `http://127.0.0.1:3210` locally and sign in with the generated owner or reviewer account.
Do not add nginx/DNS/TLS or expose `0.0.0.0:3210`.

## UAT

Use `UAT.md`. Record pass/fail and any defect outside the private credentials.

## Logs and health

```sh
cd /home/ubuntu/tanaghom-demo/source
TANAGHOM_DEMO_SECRETS_DIR=/home/ubuntu/tanaghom-demo/runtime/secrets \
  docker compose -p tanaghom-dashboard-demo -f deployment/dashboard-demo/compose.yml ps -a
TANAGHOM_DEMO_SECRETS_DIR=/home/ubuntu/tanaghom-demo/runtime/secrets \
  docker compose -p tanaghom-dashboard-demo -f deployment/dashboard-demo/compose.yml logs --no-color --tail=200
curl --fail --silent http://127.0.0.1:3210/api/health
```

Never paste auth tokens, passwords, private keys, or secret files into evidence.

## Data-preserving upgrade and restore (#259)

Both procedures require a verified snapshot and an explicit authorization marker, and neither
deletes a volume. Run them on the disposable demo host only.

```sh
cd <source>
export TANAGHOM_DEMO_ROOT=/home/ubuntu/tanaghom-demo
bash deployment/dashboard-demo/scripts/demo-backup.sh
TANAGHOM_DEMO_UPGRADE_AUTHORIZATION=GO-UPGRADE-TANAGHOM-259-DEMO \
  bash deployment/dashboard-demo/scripts/demo-upgrade.sh
TANAGHOM_DEMO_RESTORE_AUTHORIZATION=GO-RESTORE-TANAGHOM-259-DEMO \
  bash deployment/dashboard-demo/scripts/demo-restore.sh
```

`demo-backup.sh` writes a custom-format dump, a RustFS archive, per-table row counts and a
checksum manifest, then verifies all three before linking `runtime/backups/latest`.
`demo-upgrade.sh` refuses unless the ledger is exactly `0047_smartlabs_audio`, applies the pending
migrations in place, and fails if any table's row count changes other than `schema_migrations`
(+1) and `agent_runtime_profiles` (+1). `demo-restore.sh` restores the dump and the object archive
and re-proves every row count and the object inventory against the manifest.

## Rollback

The old script stopped the application instead of restoring a previous release; it now refuses
to run. Use `scripts/demo-restore.sh`; it re-proves row counts and object inventory against the snapshot. Never delete volumes or run global Docker prune
commands as a recovery step.

## Troubleshooting

- Missing/partial runtime secrets: stop and restore the matching secrets. Never reset retained data.
- Workspace reports `workspace_model_not_configured`: confirm `AGENCY_WORKSPACE_ENABLED=true`, the
  worker profile is running, and `gemini_api_key` is non-empty. No retry loop is created by a
  missing key.
- Workspace reports `provider_quota_exceeded` or `provider_request_rejected`: preserve the evidence
  and wait for an operator decision; the database emergency stop blocks further inference.
- `schema_migrations does not exist`: the fresh-database runner must check
  `to_regclass('public.schema_migrations')` before querying the ledger; rebuild from reviewed source.
- `demo database must be at exact migration 0048 ledger`: confirm the runtime has all 45 up
  migrations and no extra/missing ledger rows.
- Login `401`: read the synthetic credentials file again; do not rotate production credentials.
- Login `503` or health not ready: check `auth` health and the dashboard secret mounts.
- Upload failure: check `storage`/`storage-init` completed and `DEMO_S3_BUCKET_READY` appears in logs.
- Port already in use: stop only the conflicting demo project; never touch the canary on `3200`.

## Postiz coexistence (production host)

Postiz runs as its own compose project beside this stack, with the operator UI on
`127.0.0.1:5000` and its public API reachable from the dashboard at
`http://postiz:5000/api` over `tanaghom-dashboard-demo-backend`. Bring it up with:

```
cd deployment/postiz
POSTIZ_SECRETS_DIR=/home/ubuntu/tanaghom-demo/runtime/secrets \
  docker compose -p postiz up -d
```

`postiz.env` must exist next to that compose file (mode 600, untracked) and hold
`JWT_SECRET`. The Postiz database and Redis listen only on the private
`postiz-internal` bridge.

The workspace control deliberately allows Postiz to be running, but not to be
executing: `workspace-control.sql` requires the Postiz control row to exist, no
Postiz job in `queued`, `running` or `waiting_approval`, and no organization with
`postiz_draft_mode='automatic'`. Enable the workspace while Postiz is up by
naming its compose project once:

```
TANAGHOM_DEMO_ALLOWED_PROJECTS=postiz \
  scripts/workspace-control.sh enable \
  --change-id <ref> --authorization APPROVED-ISOLATED-DEMO-CONTROL
```

Any other running compose project still refuses activation. Publishing stays
human-gated: `POSTIZ_HANDOFF_ENABLED` only queues approved drafts, and
`POSTIZ_AUTOMATION_RUNTIME_READY` stays `false` so automatic mode cannot be
selected.

The stack is reproducible from source. Images are pinned by digest in
`deployment/postiz/compose.yml`; `deployment/postiz/postiz.env.example` documents
the `JWT_SECRET` this host needs in `postiz.env`; and the owner organization,
user and API key are seeded idempotently by:

```sh
POSTIZ_SECRETS_DIR=/home/ubuntu/tanaghom-demo/runtime/secrets \
  bash deployment/postiz/scripts/postiz-bootstrap.sh
```

It prints `POSTIZ_BOOTSTRAP_OK ... role=ADMIN`, never rotates an existing key,
never resets an existing password and never prints a secret.

## Scheduled backups

`demo-backup.sh` is the verified snapshot; `scheduled-backup.sh` wraps it, adds a
`postiz-postgres` dump (checksummed and re-listed with `pg_restore -l`) and prunes
old snapshots while keeping the newest `TANAGHOM_BACKUP_RETENTION` (default 7) and
every `latest` target. Run it by hand:

```sh
TANAGHOM_DEMO_ROOT=/home/ubuntu/tanaghom-demo \
  bash deployment/dashboard-demo/scripts/scheduled-backup.sh
```

Install the daily cron entry as the operator (no privilege escalation needed;
the user is in the `docker` group):

```sh
mkdir -p /home/ubuntu/tanaghom-demo/runtime/backups
(crontab -l 2>/dev/null; echo '15 3 * * * TANAGHOM_DEMO_ROOT=/home/ubuntu/tanaghom-demo bash /home/ubuntu/tanaghom-demo/source/deployment/dashboard-demo/scripts/scheduled-backup.sh >> /home/ubuntu/tanaghom-demo/runtime/backups/scheduled.log 2>&1') | crontab -
crontab -l | tail -1
```

Expected markers: `BACKUP_VERIFIED`, `POSTIZ_BACKUP_VERIFIED`,
`RETENTION_KEPT` and `SCHEDULED_BACKUP_COMPLETE`. Restore remains deliberate:
`demo-restore.sh` refuses without its authorization marker and re-proves row
counts and the object inventory.
