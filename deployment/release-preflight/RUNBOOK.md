# Release preflight kit: fresh deployed baseline and security

Purpose: earn the scorecard gate **"Fresh deployed baseline and security"** in
`docs/PRODUCTION_READINESS.md` with one repeatable, read-only command that proves
exactly what is running on the **certified production host** and that it is safe.
Evidence from the test VPS does not count for this gate (it remains useful as a
rehearsal).

## What it checks (12 checks, all required)

| Check | Proof |
| --- | --- |
| `running_commit_matches_release` | `git rev-parse HEAD` in the deployed source equals `RELEASE_COMMIT` |
| `tracked_source_unmodified` | no modified tracked files in the deployed source |
| `migration_level_matches_release` | latest/total `schema_migrations` equal the release's `*.up.sql` files |
| `api_role_least_privilege` | `tanaghom_api` has no superuser/createdb/createrole/bypassrls |
| `provider_and_model_stops` | automation, agent runtime, Agency pilot, workspace and notification stops all active (set `EXPECT_STOPS_ACTIVE=false` only for a release that has a recorded activation decision) |
| `dashboard_health` | `/api/health` 200 with database `connected` |
| `login_page_available` | `/login` 200 |
| `protected_routes_require_authentication` | 4 protected APIs return 401 anonymously |
| `n8n_and_webhooks_not_public` | every `PRIVATE_PROBE_URLS` entry is refused/blocked and never serves n8n |
| `tls_certificate_valid_14_days` | trusted certificate valid for at least 14 more days |
| `production_dependency_audit` | `npm audit --omit=dev` in the deployed source: zero high/critical |
| `backup_restore_drill` | `production-database-backup/test-disposable-backup.sh` dumps (read-only), encrypts, decrypts and restores into a network-isolated throwaway PostgreSQL and verifies the migration level |

## Authority and safety

- Read-only: database work runs in one `READ ONLY` transaction; HTTP probes are
  `GET` only; nothing is activated, stopped, restarted or reconfigured.
- The restore drill reads the database with `pg_dump` and restores only into a
  disposable container with `--network none`, removed on exit.
- Run by an operator already authorized for the certified host. This kit grants
  no new authority over SmartLabs, SmartCC, voice, Gemma, firewall or Nginx.
- No secret is printed. Do not paste connection strings into evidence or chat.

## Inputs

| Variable | Example |
| --- | --- |
| `RELEASE_COMMIT` | 40-char SHA approved for release |
| `SOURCE_DIR` | deployed source checkout on the host |
| `DASHBOARD_URL` | public `https://` dashboard origin |
| `DATABASE_URL` | administrator URL for read-only inspection (needed to read `schema_migrations` and for `pg_dump`) |
| `PRIVATE_PROBE_URLS` | comma list, e.g. `https://<host>:5678/,https://<host>/webhook/test,https://<host>/n8n/` |
| `EVIDENCE_HOST`, `EVIDENCE_OWNER` | host label and responsible person |
| `RESTORE_DRILL=true` | required for gate credit; needs Docker and 2× database size free disk |

Run the private probes from **outside** the host (e.g. the operator laptop) if
the host itself can reach loopback-only n8n; the HTTP part is valid from anywhere.

## Command

```sh
cd "$SOURCE_DIR"
RELEASE_COMMIT=<sha> SOURCE_DIR="$PWD" DASHBOARD_URL=https://<dashboard> \
DATABASE_URL='<admin url>' PRIVATE_PROBE_URLS='<urls>' RESTORE_DRILL=true \
EVIDENCE_HOST='certified production' EVIDENCE_OWNER='<name>' \
node deployment/release-preflight/preflight.mjs --out=/tmp/preflight-evidence.md
echo "exit=$?"   # 0 = pass, 1 = at least one check failed (no scorecard credit), 2 = missing input
```

Copy the evidence file into `docs/evidence/<date>-release-preflight.md` in a PR,
update the gate row to 5/5 with date, release, result and owner, and link it.

## Failure handling

Any `FAIL` row means **no scorecard credit**. Do not fix production from this
kit; open an issue with the evidence file, fix through a reviewed deployment
package, and re-run. A later failed or materially changed release loses credit.

## Rollback

The kit is read-only, so there is nothing to roll back on the host. To remove it
from source, revert its PR.
