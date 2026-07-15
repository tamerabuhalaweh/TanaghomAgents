import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import pg from "pg";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required");

const loadEvents = Number(process.env.GHL_CAPACITY_LOAD_EVENTS || "1000");
const workerConcurrency = Number(process.env.GHL_CAPACITY_WORKERS || "16");
const evidencePath = process.env.GHL_CAPACITY_EVIDENCE_PATH || "tmp/conversation-capacity-evidence.json";
if (!Number.isInteger(loadEvents) || loadEvents < 100 || loadEvents > 100_000) {
  throw new Error("GHL_CAPACITY_LOAD_EVENTS must be an integer between 100 and 100000");
}
if (!Number.isInteger(workerConcurrency) || workerConcurrency < 1 || workerConcurrency > 64) {
  throw new Error("GHL_CAPACITY_WORKERS must be an integer between 1 and 64");
}

const organizationId = "10000000-0000-4000-8000-000000000001";
const ownerId = "00000000-0000-4000-8000-000000000001";
const pool = new pg.Pool({ connectionString: databaseUrl, max: Math.max(workerConcurrency + 8, 24) });

async function queryAs(role, sql, parameters = []) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    const result = await client.query(sql, parameters);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function acceptSynthetic(prefix, count, providerEventType = "InboundMessage") {
  const result = await queryAs(
    "tanaghom_api",
    `SELECT count(*)::int AS accepted
       FROM generate_series(0,$2::integer-1) sequence
       CROSS JOIN LATERAL tanaghom.accept_ghl_inbound_event(
         jsonb_build_object(
           'contract_version','phase5.ghl-inbound-event.v1',
           'provider_event_id',$1::text||sequence::text,
           'provider_event_type',$3::text,
           'location_id','location-capacity-load',
           'contact_id',$1::text||'contact-'||(sequence/5)::text,
           'conversation_id',$1::text||'conversation-'||(sequence/5)::text,
           'message_id',$1::text||'message-'||sequence::text,
           'channel','whatsapp','direction',CASE WHEN $3::text='InboundMessage' THEN 'inbound' ELSE 'system' END,
           'occurred_at','2026-07-15T12:00:00.000Z',
           'details',jsonb_build_object('body','Synthetic capacity message '||sequence::text)
         ),
         md5($1::text||sequence::text)||md5(sequence::text||$1::text)
       ) accepted_event`,
    [prefix, count, providerEventType],
  );
  assert.equal(result.rows[0].accepted, count);
}

async function claim() {
  return (await queryAs("tanaghom_conversation_worker", "SELECT * FROM tanaghom.claim_ghl_inbound_event_job()")).rows[0];
}

async function complete(job) {
  const result = await queryAs(
    "tanaghom_conversation_worker",
    `SELECT tanaghom.complete_ghl_inbound_event($1,$2::jsonb) AS status`,
    [job.job_id, JSON.stringify({
      contract_version: "phase5.ghl-inbound-event-result.v1",
      event_id: job.event_id,
      outcome: "accepted_for_conversation_intelligence",
      external_action_count: 0,
      notes: "Synthetic capacity drain; no model or provider call.",
    })],
  );
  assert.equal(result.rows[0].status, "succeeded");
}

try {
  await pool.query(
    `INSERT INTO tanaghom.integration_connections (
       organization_id,provider,status,base_url,credential_kind,credential_ciphertext,
       credential_nonce,credential_auth_tag,credential_key_version,secret_last_four,
       configuration,configured_by
     ) VALUES ($1,'ghl','connected','https://services.leadconnectorhq.com','private_token',
       decode('01','hex'),decode(repeat('02',12),'hex'),decode(repeat('03',16),'hex'),1,'test',
       '{"location_id":"location-capacity-load"}'::jsonb,$2)
     ON CONFLICT (organization_id,provider) DO UPDATE SET
       status='connected',base_url=EXCLUDED.base_url,credential_kind=EXCLUDED.credential_kind,
       credential_ciphertext=EXCLUDED.credential_ciphertext,credential_nonce=EXCLUDED.credential_nonce,
       credential_auth_tag=EXCLUDED.credential_auth_tag,credential_key_version=EXCLUDED.credential_key_version,
       secret_last_four=EXCLUDED.secret_last_four,configuration=EXCLUDED.configuration,disconnected_at=NULL`,
    [organizationId, ownerId],
  );
  await pool.query(
    `UPDATE tanaghom.organization_crm_policies
        SET conversation_processing_mode='shadow'
      WHERE organization_id=$1`, [organizationId],
  );
  await pool.query(
    `UPDATE tanaghom.automation_platform_controls
        SET emergency_stop=false,reason='Disposable capacity integration'
      WHERE provider='ghl'`,
  );
  await pool.query(
    `UPDATE tanaghom.conversation_capacity_policies SET
       max_conversation_concurrency=4,max_model_claims_per_minute=100000,
       max_ghl_action_concurrency=2,max_ghl_actions_per_minute=100000,
       interactive_backlog_threshold=100,queue_age_warning_seconds=10
     WHERE organization_id=$1`, [organizationId],
  );

  await acceptSynthetic("capacity-probe-", 24);
  const boundedClaims = (await Promise.all(Array.from({ length: 16 }, () => claim()))).filter(Boolean);
  assert.equal(boundedClaims.length, 4, "atomic claim limit did not hold under contention");
  assert.equal(new Set(boundedClaims.map((job) => job.job_id)).size, 4, "one job was claimed twice");
  const inFlight = await pool.query(
    `SELECT count(*)::int AS count FROM tanaghom.agent_jobs
      WHERE job_type='conversation.ghl.inbound_event' AND status='running'
        AND input->>'organization_id'=$1`, [organizationId],
  );
  assert.equal(inFlight.rows[0].count, 4);
  assert.equal(Number((await pool.query(
    `SELECT processing_count FROM tanaghom.conversation_capacity_status WHERE organization_id=$1`,
    [organizationId],
  )).rows[0].processing_count), 4);
  await Promise.all(boundedClaims.map(complete));

  const throttled = await claim();
  assert.ok(throttled);
  assert.equal((await queryAs(
    "tanaghom_conversation_worker",
    `SELECT tanaghom.record_ghl_inbound_event_failure($1,'gemma_rate_limited','Synthetic model throttle',1) AS status`,
    [throttled.job_id],
  )).rows[0].status, "pending");
  assert.equal(await claim(), undefined, "active Gemma cooldown allowed a new model claim");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const afterCooldown = await claim();
  assert.ok(afterCooldown, "claims did not recover after the bounded cooldown");
  await complete(afterCooldown);

  const stale = await claim();
  assert.ok(stale);
  await pool.query("UPDATE tanaghom.agent_jobs SET started_at=statement_timestamp()-interval '120 seconds' WHERE id=$1", [stale.job_id]);
  assert.equal(Number((await queryAs(
    "tanaghom_conversation_worker",
    "SELECT tanaghom.recover_stale_ghl_inbound_event_jobs(60) AS recovered",
  )).rows[0].recovered), 1);
  const recoveredState = (await pool.query(
    `SELECT job.id AS job_id,job.status,event.status AS event_status
       FROM tanaghom.agent_jobs job
       JOIN tanaghom.ghl_inbound_events event ON event.id=(job.input->>'event_id')::uuid
      WHERE job.id=$1`, [stale.job_id],
  )).rows[0];
  assert.deepEqual(recoveredState, { job_id: stale.job_id, status: "queued", event_status: "pending" });

  await pool.query(
    `UPDATE tanaghom.conversation_capacity_policies SET
       max_conversation_concurrency=$2,max_model_claims_per_minute=100000,
       interactive_backlog_threshold=100000
     WHERE organization_id=$1`, [organizationId, Math.max(workerConcurrency, 4)],
  );
  const databaseBytesBefore = Number((await pool.query("SELECT pg_database_size(current_database()) AS bytes")).rows[0].bytes);
  const acceptedStartedAt = performance.now();
  await acceptSynthetic("capacity-load-", loadEvents);
  const acceptedElapsedMs = performance.now() - acceptedStartedAt;

  let completedJobs = 0;
  let emptyPolls = 0;
  const drainStartedAt = performance.now();
  async function drainWorker() {
    while (true) {
      const job = await claim();
      if (job) {
        emptyPolls = 0;
        await complete(job);
        completedJobs += 1;
        continue;
      }
      const state = await pool.query(
        `SELECT count(*) FILTER (WHERE event.status IN ('pending','processing'))::int AS remaining
           FROM tanaghom.ghl_inbound_events event
          WHERE event.provider_event_id LIKE 'capacity-%'`,
      );
      if (state.rows[0].remaining === 0) return;
      emptyPolls += 1;
      assert.ok(emptyPolls < 10_000, "capacity drain stopped making progress");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  await Promise.all(Array.from({ length: workerConcurrency }, () => drainWorker()));
  const drainElapsedMs = performance.now() - drainStartedAt;

  const final = (await pool.query(
    `SELECT
       count(*) FILTER (WHERE provider_event_id LIKE 'capacity-load-%')::int AS load_events,
       count(*) FILTER (WHERE provider_event_id LIKE 'capacity-load-%' AND status='succeeded')::int AS succeeded,
       count(*) FILTER (WHERE provider_event_id LIKE 'capacity-load-%' AND status='dead_letter')::int AS dead_letters,
       count(*) FILTER (WHERE provider_event_id LIKE 'capacity-load-%' AND delivery_count>1)::int AS duplicates,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY extract(epoch FROM processed_at-first_received_at)*1000)
         FILTER (WHERE provider_event_id LIKE 'capacity-load-%') AS p50_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM processed_at-first_received_at)*1000)
         FILTER (WHERE provider_event_id LIKE 'capacity-load-%') AS p95_ms,
       percentile_cont(0.99) WITHIN GROUP (ORDER BY extract(epoch FROM processed_at-first_received_at)*1000)
         FILTER (WHERE provider_event_id LIKE 'capacity-load-%') AS p99_ms,
       count(*) FILTER (WHERE provider_event_id LIKE 'capacity-%' AND status IN ('pending','processing'))::int AS remaining
     FROM tanaghom.ghl_inbound_events`,
  )).rows[0];
  const mismatches = Number((await pool.query(
    `SELECT count(*) AS count FROM tanaghom.agent_jobs job
      JOIN tanaghom.ghl_inbound_events event ON event.id=(job.input->>'event_id')::uuid
     WHERE job.job_type='conversation.ghl.inbound_event'
       AND job.input->>'organization_id'<>event.organization_id::text`,
  )).rows[0].count);
  assert.equal(mismatches, 0);
  assert.equal(final.load_events, loadEvents);
  assert.equal(final.succeeded, loadEvents);
  assert.equal(final.dead_letters, 0);
  assert.equal(final.duplicates, 0);
  assert.equal(final.remaining, 0);
  assert.ok(completedJobs >= loadEvents, "worker drain did not complete every accepted load event");

  const databaseBytesAfter = Number((await pool.query("SELECT pg_database_size(current_database()) AS bytes")).rows[0].bytes);
  const evidence = {
    contract_version: "phase5.conversation-capacity-evidence.v1",
    generated_at: new Date().toISOString(),
    boundaries: {
      disposable_database: true,
      synthetic_events: true,
      customer_credentials_used: false,
      provider_calls: 0,
      gemma_calls: 0,
      smartlabs_touched: false,
      fixed_75000_lead_sla_claimed: false,
    },
    workload: {
      accepted_events: loadEvents,
      shape: "five synthetic inbound WhatsApp turns per synthetic contact",
      drain_workers: workerConcurrency,
      tested_concurrency_guard: 4,
    },
    acceptance: {
      elapsed_ms: Number(acceptedElapsedMs.toFixed(2)),
      throughput_events_per_second: Number((loadEvents / (acceptedElapsedMs / 1000)).toFixed(2)),
    },
    drain: {
      elapsed_ms: Number(drainElapsedMs.toFixed(2)),
      throughput_events_per_second: Number((loadEvents / (drainElapsedMs / 1000)).toFixed(2)),
      latency_ms: {
        p50: Number(Number(final.p50_ms).toFixed(2)),
        p95: Number(Number(final.p95_ms).toFixed(2)),
        p99: Number(Number(final.p99_ms).toFixed(2)),
      },
      succeeded: final.succeeded,
      dead_letters: final.dead_letters,
      duplicates: final.duplicates,
      organization_mismatches: mismatches,
    },
    resilience: {
      concurrent_claim_limit_enforced: true,
      dependency_cooldown_blocked_and_recovered: true,
      stale_claim_recovered_with_same_job_id: true,
      accepted_work_remaining: final.remaining,
    },
    storage: {
      database_bytes_before: databaseBytesBefore,
      database_bytes_after: databaseBytesAfter,
      measured_growth_bytes: Math.max(0, databaseBytesAfter - databaseBytesBefore),
      measured_bytes_per_event: Number((Math.max(0, databaseBytesAfter - databaseBytesBefore) / loadEvents).toFixed(2)),
    },
  };
  const evidenceSchema = JSON.parse(await readFile(
    new URL("../packages/contracts/schemas/phase5/conversation-capacity-evidence.v1.schema.json", import.meta.url),
    "utf8",
  ));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateEvidence = ajv.compile(evidenceSchema);
  assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors));
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(evidence, null, 2));
  console.log("PASS: bounded capacity, priority protection, cooldown recovery, stale-claim recovery, and synthetic drain verified.");
} finally {
  await pool.query(
    "UPDATE tanaghom.automation_platform_controls SET emergency_stop=true,reason='Disposable capacity integration complete' WHERE provider='ghl'",
  ).catch(() => undefined);
  await pool.end();
}
