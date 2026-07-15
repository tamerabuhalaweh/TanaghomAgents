# Phase 5D supervisor ownership — controlled preparation

## Status

Production migration, dashboard deployment, alert sweeper activation, AI lease
claims, GHL provider operations, and message delivery remain unauthorized. This
package adds the supervised state machine, APIs, dashboard, recovery commands,
and evidence only. It does not activate an AI or human send path.

The reviewed existing-dashboard release procedure is maintained separately in
`deployment/phase5d-production-update/RUNBOOK.md`. Merging either package does
not authorize production execution.

## Validation gate

```sh
npm ci
npm run check
npm test
npm run typecheck:dashboard
npm run build:dashboard
npm run test:database
```

The database suite must prove simultaneous takeover exclusion, duplicate-click
idempotency, cross-organization assignment rejection, expired-lease recovery,
reconnect replay, dispatch-time authority loss, emergency pause, full rollback,
and clean reapply.

## Backup and restoration gate

Before any future migration, create the approved encrypted off-server backup
and restore it into a disposable database. Never print `DATABASE_URL`.

```sh
umask 077
backup_dir="/var/backups/tanaghom/phase5d-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl \
  --file="$backup_dir/tanaghom-before-phase5d.dump"
sha256sum "$backup_dir/tanaghom-before-phase5d.dump" \
  > "$backup_dir/tanaghom-before-phase5d.dump.sha256"
sha256sum -c "$backup_dir/tanaghom-before-phase5d.dump.sha256"
createdb tanaghom_phase5d_restore_test
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname=tanaghom_phase5d_restore_test "$backup_dir/tanaghom-before-phase5d.dump"
psql "postgresql:///tanaghom_phase5d_restore_test" -X -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM public.schema_migrations;"
dropdb tanaghom_phase5d_restore_test
```

## Controlled future order

1. Confirm GHL ingress and all provider messaging remain disabled, the platform
   emergency stop is active, and every organization conversation stop is active.
2. Complete encrypted backup, off-server copy, checksum, and disposable restore.
3. Apply migration `0014_supervised_conversation_ownership`.
4. Verify grants: the conversation worker has function execution only; n8n has
   no Phase 5D function or table privilege.
5. Deploy the reviewed dashboard image and verify `/api/health`.
6. Run read-only inbox verification, then controlled takeover/resolve tests on a
   synthetic `.test` conversation.
7. Keep alert sweeping, lease claims, and every provider send path inactive.

## Operating procedures

### Human takeover

Open Supervisor inbox, refresh if the stale-data warning appears, choose the
conversation, select **Take over**, and record a specific reason. A successful
transition changes the ownership epoch and invalidates any queued AI lease.

### Stuck ownership or lost lease

Do not update tables manually. Refresh the inbox. An owner/operator may take
over or pause the conversation with a recovery reason. For an expired AI lease,
the future worker must use a new command UUID; a reconnect retry with the same
UUID returns the original receipt. Provider dispatch must still call
`assert_conversation_ai_reply_authority()` immediately before sending.

### Emergency pause

The organization owner records the emergency reason and activates the stop in
the inbox. All non-resolved conversations lose reply authority and leases.
Clearing the stop leaves conversations paused. Resume each one explicitly after
review; never bulk-restore AI authority.

## Exact rollback

1. Disable the future conversation worker, alert sweeper, and every GHL message
   path. Activate the platform and organization emergency stops.
2. Export required ownership, draft, and notification evidence for audit.
3. While `0014` is the newest migration, run:

```sh
npm run db:rollback
```

4. Verify:

```sql
DO $$
BEGIN
  IF to_regclass('tanaghom.conversations') IS NOT NULL
     OR to_regprocedure('tanaghom.transition_supervised_conversation(uuid,text,uuid,uuid,text,bigint,uuid)') IS NOT NULL
     OR to_regprocedure('tanaghom.assert_conversation_ai_reply_authority(uuid,uuid,bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 5D rollback is incomplete';
  END IF;
END;
$$;
```

5. Restore the previously reviewed dashboard image. Verify Phase 5B ingress
   disabled state, Phase 5C proposal persistence, Supabase Auth, Postiz, and
   SmartLabs health. Restore the backup only if rollback validation or data
   reconciliation requires it.
