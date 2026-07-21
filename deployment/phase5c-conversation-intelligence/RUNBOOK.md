# Phase 5C knowledge and Conversation Intelligence worker

## Status

The schema and dashboard foundation are already versioned. The dedicated n8n
Conversation Intelligence workflow is now prepared for controlled import, but
production credential creation, workflow import or activation, GHL subscription
changes, and auto-reply remain unauthorized. The workflow is inactive, its
schedule is disabled, and it can only persist grounded proposals or bounded
failure state through reviewed database functions.

## Required evidence

```sh
npm ci
npm run check
npm test
npm run typecheck:dashboard
npm run build:dashboard
npm run test:database
npm run test:phase5-intelligence
npm run test:phase5-conversation-workflow
```

The evaluation writes `tmp/conversation-intelligence-evaluation.json`; CI
uploads it as `phase5-conversation-intelligence-evidence`.

The workflow integration test uses disposable PostgreSQL, a pinned n8n image,
and a local Gemma simulator. It proves cited English output, safe Arabic
escalation when approved knowledge is missing, bounded retry after malformed or
contract-invalid model output, HTTP 429/503 handling, a dedicated inherited
runtime login with no direct table writes, duplicate-event safety, and zero
external actions.

## Runtime credential boundary

The workflow references `Tanaghom Conversation PostgreSQL` separately from the
general n8n worker credential. A future production package must create a login
that is only a member of `tanaghom_conversation_worker`, import its encrypted n8n
credential without printing it, and verify that it has function execution but no
direct table writes. The Gemma header credential remains a separate encrypted
n8n credential. Neither credential is committed to Git.

## Backup and restoration gate

Before a future production migration, create an encrypted off-server PostgreSQL
backup under the approved retention policy and restore it into a disposable
database. Do not print `DATABASE_URL`.

```sh
umask 077
backup_dir="/var/backups/tanaghom/phase5c-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl \
  --file="$backup_dir/tanaghom-before-phase5c.dump"
sha256sum "$backup_dir/tanaghom-before-phase5c.dump" \
  > "$backup_dir/tanaghom-before-phase5c.dump.sha256"
sha256sum -c "$backup_dir/tanaghom-before-phase5c.dump.sha256"
createdb tanaghom_phase5c_restore_test
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname=tanaghom_phase5c_restore_test \
  "$backup_dir/tanaghom-before-phase5c.dump"
psql "postgresql:///tanaghom_phase5c_restore_test" -X -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM public.schema_migrations;"
dropdb tanaghom_phase5c_restore_test
```

## Controlled future order

1. Confirm Phase 5B ingress is disabled, every organization is paused, and the
   GHL emergency stop is active.
2. Complete the backup, encrypted off-server copy, and disposable restoration.
3. Apply migration `0013_sales_knowledge_intelligence`.
4. Verify table, function, view, and grant boundaries.
5. Deploy only the reviewed Tanaghom dashboard image.
6. Have the customer enter, review, approve, and activate a test catalog. Do not
   scrape or import unreviewed material.
7. Run the reference evaluation and a separately approved live-Gemma shadow
   evaluation with no sends or tools.
8. Import the reviewed workflow inactive, confirm the polling trigger remains
   disabled, and verify it has zero executions.
9. Keep proposals invisible to external channels until later Phase 5 gates.

## Exact rollback

1. Deactivate and delete only the package-owned Conversation Intelligence
   workflow if it was imported; preserve its audit and proposal records.
2. Confirm Phase 5B ingress is disabled, processing is paused, and the emergency
   stop is active.
3. Export any proposal evidence required for audit retention.
4. While `0013` is the latest migration, run:

```sh
npm run db:rollback
```

5. Verify:

```sql
DO $$
BEGIN
  IF to_regclass('tanaghom.sales_knowledge_versions') IS NOT NULL
     OR to_regprocedure('tanaghom.prepare_conversation_intelligence(uuid)') IS NOT NULL
     OR to_regprocedure('tanaghom.persist_conversation_intelligence_proposal(uuid,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 5C rollback is incomplete';
  END IF;
END;
$$;
```

6. Restore the prior dashboard image and verify dashboard, Phase 5A contact sync,
   Phase 5B ingress-disabled state, Postiz, Supabase Auth, and SmartLabs health.
