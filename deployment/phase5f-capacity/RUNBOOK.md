# Phase 5F capacity and backpressure — disposable validation

## Status

Production execution is unauthorized. This package does not apply migration
`0018`, activate ingress or n8n, clear an emergency stop, use customer
credentials, call a provider/model, run a shared-GPU benchmark, or touch any
SmartLabs file, container, firewall rule, volume, or voice path.

## Disposable gate

Use a fresh PostgreSQL database containing no customer data:

```sh
npm ci
npm run db:migrate
psql "$DATABASE_TEST_URL" -X -v ON_ERROR_STOP=1 \
  -f packages/database/seeds/staging.sql
GHL_CAPACITY_LOAD_EVENTS=10000 \
GHL_CAPACITY_WORKERS=16 \
GHL_CAPACITY_EVIDENCE_PATH=tmp/conversation-capacity-evidence.json \
  npm run test:phase5-capacity
```

Acceptance requires:

- exactly 10,000 synthetic load events accepted and succeeded;
- zero duplicate deliveries, dead letters, tenant mismatches, provider calls,
  model calls, and remaining accepted work;
- the four-claim contention probe never exceeds four running jobs;
- Gemma pressure blocks new claims and automatically recovers;
- a stale running claim returns to the same durable job identity;
- evidence validates against
  `conversation-capacity-evidence.v1.schema.json`.

The resulting throughput and latency describe that disposable runner only.
Do not copy them into a customer SLA or extrapolate them to 75,000 leads.

## Capacity states

```sql
SELECT * FROM tanaghom.conversation_capacity_status
ORDER BY organization_id;
```

Interpretation:

- `normal`: no configured threshold is active;
- `protecting_interactive`: interactive backlog reached the organization guard;
- `conversation_saturated`: all conversation claim slots are occupied;
- `dependency_cooldown`: Gemma or GHL supplied/triggered a bounded retry delay;
- `queue_age_warning`: the oldest accepted event exceeded its warning target;
- `indeterminate_block`: a possible provider action requires human
  reconciliation.

The versioned alert rules are in
`alerts/conversation-capacity-alerts.v1.json`. They are a monitoring contract,
not evidence that production alert delivery is configured.

## Disk and retention

The evidence reports database bytes before and after the synthetic load and
measured bytes per event. CI retains the secret-free artifact for 30 days.
No production execution-data or event-retention value is changed by this
package. Customer retention and safe pruning remain blocked until staging
traffic, audit obligations, backup restoration, and disk headroom are reviewed.

## Controlled future order

1. Keep ingress, action runtime, workflows, and platform/organization emergency
   stops in their currently approved safe state.
2. Create the encrypted off-server backup and prove restoration into a uniquely
   named disposable database.
3. Apply migration `0018` only after verifying `0017` is the current latest
   migration.
4. Verify policy/status grants, both worker roles' function-only access, default
   limits, priority annotations, and alert queries.
5. Run the 10,000-event disposable test and archive the evidence.
6. Run a separately approved staging test with test contacts and customer quota
   headers; do not enable unrelated contacts or proactive messaging.
7. Any SmartLabs-adjacent Gemma benchmark requires a separate written plan,
   read-only SmartLabs baseline, stop conditions, and Tamer approval.

## Exact rollback

1. Activate the GHL platform and organization emergency stops and disable GHL
   ingress/action runtimes before schema work.
2. Export capacity policy/status and any incident evidence required for review.
3. Confirm `0018_conversation_capacity_backpressure` is the newest migration,
   then run exactly once:

```sh
npm run db:rollback
```

4. Verify package objects and job annotations are gone while the Phase 5B/5E
   claim and failure functions remain:

```sql
DO $$
BEGIN
  IF to_regclass('tanaghom.conversation_capacity_policies') IS NOT NULL
     OR to_regclass('tanaghom.conversation_dependency_cooldowns') IS NOT NULL
     OR to_regclass('tanaghom.conversation_capacity_status') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.schema_migrations
       WHERE version='0018_conversation_capacity_backpressure')
     OR EXISTS (SELECT 1 FROM tanaghom.agent_jobs
       WHERE job_type='conversation.ghl.inbound_event'
         AND input ?| array['workload_class','priority_score'])
     OR to_regprocedure('tanaghom.claim_ghl_inbound_event_job()') IS NULL
     OR to_regprocedure('tanaghom.claim_ghl_action_job()') IS NULL THEN
    RAISE EXCEPTION 'Phase 5F capacity rollback is incomplete';
  END IF;
END;
$$;
```

5. Re-run the Phase 5B and Phase 5E simulated gates. Do not restore production
   traffic merely because rollback succeeded.
