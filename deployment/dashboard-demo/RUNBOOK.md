# Demo dashboard deployment runbook (#243)

> **Release blocked:** This document is historical and does not authorize deployment,
> activation, upgrade, rollback, or deletion on any host. Its original host and
> activation instructions have not been reconciled with the current CPU test VPS.
> Existing demo volumes and secrets must be preserved. A reviewed backup, restore,
> compatibility and activation procedure, plus a separate deployment GO, are required.

## Target contract

- Historical host: Astra `38.247.187.232`; **not an authorized target for this release**.
- Dashboard listener: only `127.0.0.1:3210`; access through a private SSH tunnel.
- Existing canary: `127.0.0.1:3200`; never stop, rewrite, reuse, or proxy it.
- Isolated project/volumes/networks are all prefixed `tanaghom-dashboard-demo`.
- Fresh demo database, private demo bucket, synthetic owner/reviewer accounts.
- No nginx, DNS, TLS, production flag, real provider, sending, or publishing change.
- Sol must not SSH or deploy. Astra executes only after package review and a separate deployment GO.

## Prerequisites on Astra

Docker Engine with Compose v2, `bash`, `openssl`, `python3`, `curl`, `ss`, at least 10 GB free
space, and port `3210` unused. Do not use host port `5432`; it belongs to an unrelated container.

Place the reviewed source and private runtime outside canary paths:

```sh
/opt/tanaghom-demo/source
/opt/tanaghom-demo/runtime/secrets
```

Check out the exact reviewed commit in `source`; the worktree must be clean.

## Prepare secrets

The deploy script creates these for a fresh demo only. If an existing runtime has missing or
partial secrets, stop and restore the matching secrets; do not regenerate them or reset volumes.

```sh
cd /opt/tanaghom-demo/source
bash deployment/dashboard-demo/scripts/prepare-runtime.sh /opt/tanaghom-demo/runtime/secrets
chmod 0700 /opt/tanaghom-demo/runtime/secrets
# The script makes shared secret files 0444 so non-root containers can read the bind mounts.
# demo-credentials.txt stays 0600. Do not chmod all files to 0600.
```

Read the private demo account passwords from
`/opt/tanaghom-demo/runtime/secrets/demo-credentials.txt`. Never copy that file into git,
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
Activation logs must contain no key material. Before a normal `deploy.sh`, stop the optional worker
and leave `AGENCY_WORKSPACE_ENABLED` unset/false so the default deployment remains inert:

```sh
TANAGHOM_DEMO_SECRETS_DIR=/opt/tanaghom-demo/runtime/secrets \
  docker compose -p tanaghom-dashboard-demo -f deployment/dashboard-demo/compose.yml \
  --profile workspace stop workspace-worker
```

The worker polls the internal dashboard endpoint with the 64-hex worker token. It has no host
port, no database credentials, no provider key, and no external-action capability. The Gemini
model (`gemini-3.8-flash`) is verified against the provider inventory (cached for ten minutes per
dashboard process) before specialist requests; failures are recorded as explicit workspace errors and stop further inference for human
review.

## Deploy

Run this as root from a clean checkout. Use the exact reviewed SHA for both values. The
authorization string is an explicit operator guard, not a production secret.

```sh
cd /opt/tanaghom-demo/source
TANAGHOM_DEMO_DEPLOY_AUTHORIZATION=GO-DEPLOY-TANAGHOM-243-DEMO \
EXPECTED_DEMO_RELEASE=<reviewed-sha> \
TANAGHOM_DEMO_ROOT=/opt/tanaghom-demo \
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
cd /opt/tanaghom-demo/source/deployment/dashboard-demo
TANAGHOM_DEMO_SECRETS_DIR=/opt/tanaghom-demo/runtime/secrets TANAGHOM_DEMO_RELEASE=<reviewed-sha> \
  SMOKE_WRITE=0 bash scripts/validate.sh
TANAGHOM_DEMO_SECRETS_DIR=/opt/tanaghom-demo/runtime/secrets TANAGHOM_DEMO_RELEASE=<reviewed-sha> \
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
ssh -N -L 3210:127.0.0.1:3210 <astra-user>@38.247.187.232
```

Open `http://127.0.0.1:3210` locally and sign in with the generated owner or reviewer account.
Do not add nginx/DNS/TLS or expose `0.0.0.0:3210`.

## UAT

Use `UAT.md`. Record pass/fail and any defect outside the private credentials.

## Logs and health

```sh
cd /opt/tanaghom-demo/source
TANAGHOM_DEMO_SECRETS_DIR=/opt/tanaghom-demo/runtime/secrets \
  docker compose -p tanaghom-dashboard-demo -f deployment/dashboard-demo/compose.yml ps -a
TANAGHOM_DEMO_SECRETS_DIR=/opt/tanaghom-demo/runtime/secrets \
  docker compose -p tanaghom-dashboard-demo -f deployment/dashboard-demo/compose.yml logs --no-color --tail=200
curl --fail --silent http://127.0.0.1:3210/api/health
```

Never paste auth tokens, passwords, private keys, or secret files into evidence.

## Data-preserving upgrade and restore (#259)

Both procedures require a verified snapshot and an explicit authorization marker, and neither
deletes a volume. Run them on the disposable demo host only.

```sh
cd <source>
export TANAGHOM_DEMO_ROOT=/opt/tanaghom-demo
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
