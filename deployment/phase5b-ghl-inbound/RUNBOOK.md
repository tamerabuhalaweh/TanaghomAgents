# Phase 5B GHL inbound gateway — preparation and recovery

## Status

This package is source and disposable-test preparation only. Production
deployment, migration, nginx installation, public webhook subscription, and
conversation-worker activation are unauthorized until Tamer approves the
complete production diff and rollback.

The committed runtime defaults are safe:

- `GHL_WEBHOOK_INGRESS_ENABLED=false`;
- organization conversation processing defaults to `paused`;
- the GHL platform emergency stop defaults/remains active;
- no conversation worker login, container, or scheduler is deployed;
- no GHL message/action endpoint is called.

## Prepared endpoint

Future URL:

`https://tanaghom.38-247-187-232.sslip.io/api/webhooks/ghl`

Do not place this URL in GHL until the migration, nginx rate boundary, runtime
secrets/configuration, health checks, canary, and rollback are approved.

## Pre-deployment evidence

From a clean checkout with a disposable PostgreSQL database:

```sh
npm ci
npm run check
npm test
npm run typecheck:dashboard
npm run build:dashboard
npm run test:database
GHL_INBOUND_LOAD_EVENTS=10000 npm run test:phase5-inbound
```

The load command writes `tmp/ghl-inbound-load-evidence.json`. GitHub Actions
uploads it as `phase5-ghl-inbound-load-evidence`.

## Required backup before any live migration

Use a protected operator shell. Do not echo `DATABASE_URL`.

```sh
umask 077
backup_dir="/var/backups/tanaghom/phase5b-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl \
  --file="$backup_dir/tanaghom-before-phase5b.dump"
sha256sum "$backup_dir/tanaghom-before-phase5b.dump" \
  > "$backup_dir/tanaghom-before-phase5b.dump.sha256"
sha256sum -c "$backup_dir/tanaghom-before-phase5b.dump.sha256"
```

Copy the encrypted backup to the approved off-server destination under the
existing backup retention policy. A production migration is blocked until a
disposable restoration succeeds:

```sh
createdb tanaghom_phase5b_restore_test
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname=tanaghom_phase5b_restore_test \
  "$backup_dir/tanaghom-before-phase5b.dump"
psql "postgresql:///tanaghom_phase5b_restore_test" -X -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM public.schema_migrations;"
dropdb tanaghom_phase5b_restore_test
```

## Controlled future activation order

1. Confirm SmartLabs/voice health and record the baseline; do not modify it.
2. Create and verify the database backup and off-server copy.
3. Apply migration `0012_ghl_inbound_event_inbox` with ingress still disabled.
4. Verify tables, functions, grants, the conversation-worker NOLOGIN role, and
   rollback on a disposable database.
5. Build and stage the dashboard image with
   `GHL_WEBHOOK_INGRESS_ENABLED=false`.
6. Install the reviewed nginx rate/body-size location transactionally and run
   `nginx -t` before reload.
7. Recreate only the Tanaghom dashboard container with ingress still disabled.
8. Verify invalid signatures cannot create events and the dashboard is healthy.
9. Enable ingress for a canary window while organization processing remains
   `paused` and the GHL emergency stop remains active.
10. Subscribe only the reviewed GHL test-location events.
11. Send one signed test-contact event and verify one event/one job/zero claims.
12. Only after separate approval, change the test organization to `shadow` and
    clear the platform emergency stop for a zero-action worker canary.

## Validation queries

```sql
SELECT * FROM tanaghom.ghl_inbound_event_metrics ORDER BY last_received_at DESC;
SELECT status, count(*) FROM tanaghom.ghl_inbound_events GROUP BY status;
SELECT job_type, status, count(*) FROM tanaghom.agent_jobs
 WHERE job_type='conversation.ghl.inbound_event' GROUP BY job_type, status;
SELECT bucket_minute, reason, rejection_count
 FROM tanaghom.ghl_webhook_rejection_metrics
 ORDER BY bucket_minute DESC, reason LIMIT 100;
```

No validation may print message bodies, customer credentials, raw signatures,
or full provider payloads.

## Exact rollback order

1. Remove/disable the GHL webhook subscription at GHL.
2. Set `GHL_WEBHOOK_INGRESS_ENABLED=false` and recreate only the Tanaghom
   dashboard container.
3. Confirm the endpoint returns `503 ghl_webhook_ingress_disabled`.
4. Set the GHL platform emergency stop active and all organization conversation
   modes to `paused`.
5. Export any accepted inbox evidence required for incident/audit retention.
6. Run exactly one package rollback while `0012` is the latest migration:

```sh
npm run db:rollback
```

7. Verify removal:

```sql
DO $$
BEGIN
  IF to_regclass('tanaghom.ghl_inbound_events') IS NOT NULL
     OR to_regprocedure('tanaghom.claim_ghl_inbound_event_job()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tanaghom_conversation_worker') THEN
    RAISE EXCEPTION 'Phase 5B rollback is incomplete';
  END IF;
END;
$$;
```

8. Restore the previously deployed dashboard image and nginx configuration,
   run `nginx -t`, reload nginx, and verify dashboard health.

The down migration removes the Phase 5B inbox, executable functions, metrics
view, worker role, and conversation-mode column. Historical agent-job and
immutable audit rows remain as non-executable evidence; deleting them would
violate the platform audit guarantee. It does not alter Phase 5A contact sync,
Postiz, Supabase authentication, n8n, Gemma, or SmartLabs.
