# Phase 5E governed GHL actions — controlled preparation

## Status

Production is unauthorized. This package does not apply migration `0015`,
enable `GHL_ACTION_RUNTIME_ENABLED`, import or activate an n8n workflow, use a
customer credential, call GoHighLevel, or deliver a message. The committed
workflow and its polling trigger are inactive. SmartLabs and the server's
500GB drive are outside this package.

## Validation gate

```sh
npm ci
npm run generate:phase5-workflows
git diff --exit-code -- n8n/workflows/phase5
npm run check
npm test
npm run typecheck:dashboard
npm run build:dashboard
npm run test:database
```

The database suite must prove consent and DND enforcement, approved-template
enforcement, quiet hours and frequency caps, idempotent replay, ownership
rechecks, emergency stops, append-only outcomes, indeterminate-operation
blocking, least-privilege grants, rollback, and clean reapply.

The n8n integration acceptance must use disposable PostgreSQL and a simulated
provider gateway. It must never load a real GHL credential or external base URL.

## Backup and restoration gate

Before any future authorized migration, create the approved encrypted
off-server backup and prove restoration into a uniquely named disposable
database. GitHub is the code recovery source; this database backup protects
customer state. Never print `DATABASE_URL`.

```sh
umask 077
backup_dir="/var/backups/tanaghom/phase5e-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl \
  --file="$backup_dir/tanaghom-before-phase5e.dump"
sha256sum "$backup_dir/tanaghom-before-phase5e.dump" \
  > "$backup_dir/tanaghom-before-phase5e.dump.sha256"
sha256sum -c "$backup_dir/tanaghom-before-phase5e.dump.sha256"
restore_db="tanaghom_phase5e_restore_$(date -u +%Y%m%d%H%M%S)"
createdb "$restore_db"
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname="$restore_db" "$backup_dir/tanaghom-before-phase5e.dump"
psql "postgresql:///$restore_db" -X -v ON_ERROR_STOP=1 \
  -c "SELECT version FROM public.schema_migrations ORDER BY applied_at;"
dropdb "$restore_db"
```

Copy the encrypted archive and checksum to the approved off-server destination,
apply its retention policy, and record the restore evidence before deployment.

## Controlled future order

1. Confirm platform and organization GHL emergency stops are active and the
   existing Phase 5D ownership package is healthy.
2. Complete and review backup, off-server copy, checksum, and restoration test.
3. Apply migration `0015_governed_ghl_actions` and verify worker grants are
   function-only.
4. Deploy the reviewed dashboard with both runtime flags false. Verify health,
   Supabase Auth, Postiz, GHL ingress, and the Supervisor inbox.
5. Import the matching workflow inactive; confirm its schedule remains disabled
   and it has zero executions.
6. With a simulated provider, run manual, shadow, approval, DND, takeover,
   duplicate, timeout, and emergency-stop cases using `.test` records.
7. Review evidence. A separate written authorization is required to set runtime
   readiness, enable the gateway, or activate polling. Real messaging remains
   disabled until customer templates, channel consent policy, and staging
   acceptance are approved.

## Exact rollback

1. Activate the platform and organization GHL emergency stops. Disable the n8n
   workflow and `GHL_ACTION_RUNTIME_ENABLED` before changing the schema.
2. Export action jobs, approvals, outcomes, external operations, and audit rows
   needed for investigation. Reconcile every indeterminate operation first.
3. While `0015` is the newest applied migration, run:

```sh
npm run db:rollback
```

4. Verify package objects are gone:

```sql
DO $$
BEGIN
  IF to_regclass('tanaghom.ghl_action_jobs') IS NOT NULL
     OR to_regclass('tanaghom.ghl_action_outcomes') IS NOT NULL
     OR to_regprocedure('tanaghom.claim_ghl_action_job()') IS NOT NULL
     OR to_regprocedure('tanaghom.prepare_ghl_action_dispatch(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 5E rollback is incomplete';
  END IF;
END;
$$;
```

5. Restore the previously reviewed dashboard and workflow exports. Verify Phase
   5B ingress and Phase 5D supervision remain healthy and inactive for outbound
   messaging. Use `pg_restore --exit-on-error` only if rollback validation or
   data reconciliation requires restoring the reviewed backup.
