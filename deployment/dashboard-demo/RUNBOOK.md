# Demo dashboard deployment runbook (#243)

## Target contract

- Host: Astra `38.247.187.232`.
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

The deploy script creates these if absent. To recover an empty/partial directory, move it aside
and rerun `prepare-runtime.sh`; it refuses to overwrite existing files. If the demo database volume
already exists, reset the disposable volumes too: Postgres applies its password only on first init.

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

```sh
# Operator-supplied key file; replace the path with the private local handoff path.
test -s /path/to/private/gemini_api_key
cp /path/to/private/gemini_api_key /opt/tanaghom-demo/runtime/secrets/gemini_api_key
chmod 0444 /opt/tanaghom-demo/runtime/secrets/gemini_api_key

cd /opt/tanaghom-demo/source
TANAGHOM_DEMO_SECRETS_DIR=/opt/tanaghom-demo/runtime/secrets \
AGENCY_WORKSPACE_ENABLED=true \
  docker compose -p tanaghom-dashboard-demo -f deployment/dashboard-demo/compose.yml \
  --profile workspace up -d dashboard workspace-worker
```

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
model (`gemini-2.5-flash`) is verified against the provider inventory (cached for ten minutes per
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
decided. Before rerunning it, reset only the disposable demo volumes, with the reviewed release exported:

```sh
export TANAGHOM_DEMO_SECRETS_DIR=/opt/tanaghom-demo/runtime/secrets
export TANAGHOM_DEMO_RELEASE=<reviewed-sha>
docker compose -p tanaghom-dashboard-demo -f compose.yml down --volumes
docker compose -p tanaghom-dashboard-demo -f compose.yml up -d
```

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

## Rollback

This removes the demo containers/networks but preserves demo volumes and the canary:

```sh
cd /opt/tanaghom-demo/source/deployment/dashboard-demo
TANAGHOM_DEMO_SECRETS_DIR=/opt/tanaghom-demo/runtime/secrets \
TANAGHOM_DEMO_ROLLBACK_AUTHORIZATION=ROLLBACK-TANAGHOM-243-DEMO \
  bash scripts/rollback.sh
```

For a disposable reset, add `TANAGHOM_DEMO_REMOVE_VOLUMES=1`; this deletes demo database and
bucket data only. Never run global Docker prune commands.

## Troubleshooting

- Missing/partial runtime secrets: move the directory aside, rerun `prepare-runtime.sh`, and verify
  the shared files are mode `0444` inside a mode `0700` directory. On an existing runtime, rerun
  `deploy.sh`; it adds only the missing workspace files and the empty Gemini placeholder.
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
