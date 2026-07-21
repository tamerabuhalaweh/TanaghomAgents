import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import pg from "pg";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required");

const burstEvents = Number(process.env.GHL_RESILIENCE_BURST_EVENTS || "500");
const soakSeconds = Number(process.env.GHL_RESILIENCE_SOAK_SECONDS || "6");
const soakWaveEvents = Number(process.env.GHL_RESILIENCE_SOAK_WAVE_EVENTS || "25");
const workerConcurrency = Number(process.env.GHL_RESILIENCE_WORKERS || "8");
const modelLatencyMs = Number(process.env.GHL_RESILIENCE_MODEL_LATENCY_MS || "10");
const evidencePath = process.env.GHL_RESILIENCE_EVIDENCE_PATH || "tmp/conversation-resilience-evidence.json";
for (const [name, value, minimum, maximum] of [
  ["GHL_RESILIENCE_BURST_EVENTS", burstEvents, 100, 10_000],
  ["GHL_RESILIENCE_SOAK_SECONDS", soakSeconds, 2, 120],
  ["GHL_RESILIENCE_SOAK_WAVE_EVENTS", soakWaveEvents, 5, 500],
  ["GHL_RESILIENCE_WORKERS", workerConcurrency, 2, 32],
  ["GHL_RESILIENCE_MODEL_LATENCY_MS", modelLatencyMs, 1, 1000],
]) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

const organizationId = "10000000-0000-4000-8000-000000000001";
const ownerId = "00000000-0000-4000-8000-000000000001";
let pool = createPool(databaseUrl);
let restorePool;
let restoreDatabaseName;
let archiveDirectory;

function createPool(connectionString) {
  const created = new pg.Pool({ connectionString, max: Math.max(workerConcurrency + 6, 16) });
  created.on("error", () => undefined);
  return created;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function queryAs(role, sql, parameters = [], targetPool = pool) {
  const client = await targetPool.connect();
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

async function acceptSynthetic(prefix, count, providerEventType = "InboundMessage", targetPool = pool) {
  const result = await queryAs(
    "tanaghom_api",
    `SELECT count(*)::int AS accepted
       FROM generate_series(0,$2::integer-1) sequence
       CROSS JOIN LATERAL tanaghom.accept_ghl_inbound_event(
         jsonb_build_object(
           'contract_version','phase5.ghl-inbound-event.v1',
           'provider_event_id',$1::text||sequence::text,
           'provider_event_type',$3::text,
           'location_id','location-resilience-test',
           'contact_id',$1::text||'contact-'||(sequence/5)::text,
           'conversation_id',$1::text||'conversation-'||(sequence/5)::text,
           'message_id',$1::text||'message-'||sequence::text,
           'channel','whatsapp','direction',CASE WHEN $3::text='InboundMessage' THEN 'inbound' ELSE 'system' END,
           'occurred_at',statement_timestamp(),
           'details',jsonb_build_object('body','Synthetic resilience message '||sequence::text)
         ), md5($1::text||sequence::text)||md5(sequence::text||$1::text)
       ) accepted_event`,
    [prefix, count, providerEventType], targetPool,
  );
  assert.equal(result.rows[0].accepted, count);
}

async function claim(targetPool = pool) {
  return (await queryAs("tanaghom_conversation_worker", "SELECT * FROM tanaghom.claim_ghl_inbound_event_job()", [], targetPool)).rows[0];
}

async function complete(job, targetPool = pool, delayMs = 0) {
  if (delayMs) await sleep(delayMs);
  const result = await queryAs(
    "tanaghom_conversation_worker",
    "SELECT tanaghom.complete_ghl_inbound_event($1,$2::jsonb) AS status",
    [job.job_id, JSON.stringify({
      contract_version: "phase5.ghl-inbound-event-result.v1",
      event_id: job.event_id,
      outcome: "accepted_for_conversation_intelligence",
      external_action_count: 0,
      notes: "Synthetic resilience drain; no model or provider call.",
    })], targetPool,
  );
  assert.equal(result.rows[0].status, "succeeded");
}

async function remaining(prefix, targetPool = pool) {
  return Number((await targetPool.query(
    "SELECT count(*) AS count FROM tanaghom.ghl_inbound_events WHERE provider_event_id LIKE $1 AND status IN ('pending','processing')",
    [`${prefix}%`],
  )).rows[0].count);
}

async function drain(prefix, targetPool = pool, delayMs = 0) {
  let completed = 0;
  let idlePolls = 0;
  async function worker() {
    while (true) {
      const job = await claim(targetPool);
      if (job) {
        idlePolls = 0;
        await complete(job, targetPool, delayMs);
        completed += 1;
        continue;
      }
      if (await remaining(prefix, targetPool) === 0) return;
      idlePolls += 1;
      assert.ok(idlePolls < 20_000, `drain stopped making progress for ${prefix}`);
      await sleep(5);
    }
  }
  await Promise.all(Array.from({ length: workerConcurrency }, () => worker()));
  return completed;
}

async function fingerprint(prefix, targetPool = pool) {
  const result = await targetPool.query(
    `SELECT count(*)::int AS count,
            md5(string_agg(event.id::text||':'||event.status||':'||job.id::text||':'||job.status,',' ORDER BY event.id)) AS digest
       FROM tanaghom.ghl_inbound_events event
       JOIN tanaghom.agent_jobs job ON job.input->>'event_id'=event.id::text
      WHERE event.provider_event_id LIKE $1`, [`${prefix}%`],
  );
  return { count: result.rows[0].count, digest: result.rows[0].digest };
}

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

function databaseUrlFor(name) {
  const value = new URL(databaseUrl);
  value.pathname = `/${name}`;
  return value.toString();
}

async function encryptedBacklogRestore(prefix) {
  archiveDirectory = await mkdtemp(join(tmpdir(), "tanaghom-resilience-"));
  const rawPath = join(archiveDirectory, "backlog.dump");
  const encryptedPath = join(archiveDirectory, "backlog.dump.enc");
  const restoredPath = join(archiveDirectory, "backlog.restored.dump");
  const sourceFingerprint = await fingerprint(prefix);
  assert.ok(sourceFingerprint.count > 0);

  run("pg_dump", [databaseUrl, "--format=custom", "--no-owner", "--schema=public", "--schema=tanaghom", `--file=${rawPath}`]);
  const raw = await readFile(rawPath);
  assert.ok(raw.length > 0);
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([iv, cipher.update(raw), cipher.final(), cipher.getAuthTag()]);
  await writeFile(encryptedPath, encrypted);
  assert.notEqual(createHash("sha256").update(raw).digest("hex"), createHash("sha256").update(encrypted).digest("hex"));
  const encryptedRoundTrip = await readFile(encryptedPath);
  const decipher = createDecipheriv("aes-256-gcm", key, encryptedRoundTrip.subarray(0, 12));
  decipher.setAuthTag(encryptedRoundTrip.subarray(encryptedRoundTrip.length - 16));
  const decrypted = Buffer.concat([decipher.update(encryptedRoundTrip.subarray(12, -16)), decipher.final()]);
  assert.equal(createHash("sha256").update(decrypted).digest("hex"), createHash("sha256").update(raw).digest("hex"));
  await writeFile(restoredPath, decrypted);

  restoreDatabaseName = `tanaghom_resilience_restore_${process.pid}_${Date.now()}`;
  const adminPool = createPool(databaseUrlFor("postgres"));
  await adminPool.query(`CREATE DATABASE ${restoreDatabaseName}`);
  await adminPool.end();
  const restoreUrl = databaseUrlFor(restoreDatabaseName);
  run("pg_restore", ["--dbname", restoreUrl, "--no-owner", "--clean", "--if-exists", "--exit-on-error", restoredPath]);
  restorePool = createPool(restoreUrl);
  const restoredFingerprint = await fingerprint(prefix, restorePool);
  assert.deepEqual(restoredFingerprint, sourceFingerprint);
  assert.equal((await restorePool.query("SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1")).rows[0].version, "0024_conversation_intelligence_worker_registry");

  await restorePool.query(
    `UPDATE tanaghom.agent_jobs SET started_at=statement_timestamp()-interval '120 seconds'
      WHERE job_type='conversation.ghl.inbound_event' AND status='running'
        AND input->>'event_id' IN (SELECT id::text FROM tanaghom.ghl_inbound_events WHERE provider_event_id LIKE $1)`,
    [`${prefix}%`],
  );
  await queryAs("tanaghom_conversation_worker", "SELECT tanaghom.recover_stale_ghl_inbound_event_jobs(60)", [], restorePool);
  await drain(prefix, restorePool);
  assert.equal(await remaining(prefix, restorePool), 0);
  return { sourceFingerprint, restoredFingerprint };
}

try {
  await pool.query(
    `INSERT INTO tanaghom.integration_connections (
       organization_id,provider,status,base_url,credential_kind,credential_ciphertext,
       credential_nonce,credential_auth_tag,credential_key_version,secret_last_four,configuration,configured_by
     ) VALUES ($1,'ghl','connected','https://services.leadconnectorhq.com','private_token',
       decode('01','hex'),decode(repeat('02',12),'hex'),decode(repeat('03',16),'hex'),1,'test',
       '{"location_id":"location-resilience-test"}'::jsonb,$2)
     ON CONFLICT (organization_id,provider) DO UPDATE SET status='connected',configuration=EXCLUDED.configuration,disconnected_at=NULL`,
    [organizationId, ownerId],
  );
  await pool.query("UPDATE tanaghom.organization_crm_policies SET conversation_processing_mode='shadow' WHERE organization_id=$1", [organizationId]);
  await pool.query("UPDATE tanaghom.automation_platform_controls SET emergency_stop=false,reason='Disposable resilience integration' WHERE provider='ghl'");
  await pool.query(
    `UPDATE tanaghom.conversation_capacity_policies SET
       max_conversation_concurrency=$2,max_model_claims_per_minute=100000,
       interactive_backlog_threshold=100000,queue_age_warning_seconds=10
     WHERE organization_id=$1`, [organizationId, workerConcurrency],
  );

  await acceptSynthetic("resilience-priority-background-", 24, "ContactUpdate");
  await acceptSynthetic("resilience-priority-interactive-", 8);
  const priorityClaims = (await Promise.all(Array.from({ length: workerConcurrency }, () => claim()))).filter(Boolean);
  assert.equal(priorityClaims.length, workerConcurrency);
  assert.ok(priorityClaims.every((job) => job.provider_event_type === "InboundMessage"));
  await Promise.all(priorityClaims.map((job) => complete(job)));
  await drain("resilience-priority-");

  await acceptSynthetic("resilience-cooldown-", 2);
  const throttled = await claim();
  assert.ok(throttled);
  assert.equal((await queryAs(
    "tanaghom_conversation_worker",
    "SELECT tanaghom.record_ghl_inbound_event_failure($1,'gemma_rate_limited','Synthetic dependency throttle',1) AS status",
    [throttled.job_id],
  )).rows[0].status, "pending");
  assert.equal(await claim(), undefined);
  assert.equal(await remaining("resilience-cooldown-"), 2);
  await sleep(1100);
  assert.ok(await claim());
  await pool.query("UPDATE tanaghom.agent_jobs SET started_at=statement_timestamp()-interval '120 seconds' WHERE job_type='conversation.ghl.inbound_event' AND status='running'");
  await queryAs("tanaghom_conversation_worker", "SELECT tanaghom.recover_stale_ghl_inbound_event_jobs(60)");
  await drain("resilience-cooldown-");

  await acceptSynthetic("resilience-dead-letter-", 1);
  let deadLetterJob;
  const deadLetterMaxAttempts = Number((await pool.query(
    `SELECT job.max_attempts FROM tanaghom.agent_jobs job
      JOIN tanaghom.ghl_inbound_events event ON event.id=(job.input->>'event_id')::uuid
     WHERE event.provider_event_id='resilience-dead-letter-0'`,
  )).rows[0].max_attempts);
  assert.ok(deadLetterMaxAttempts > 0 && deadLetterMaxAttempts <= 10);
  for (let attempt = 1; attempt <= deadLetterMaxAttempts; attempt += 1) {
    deadLetterJob = await claim();
    assert.ok(deadLetterJob);
    await queryAs(
      "tanaghom_conversation_worker",
      "SELECT tanaghom.record_ghl_inbound_event_failure($1,'synthetic_failure','Bounded dead-letter test',0)",
      [deadLetterJob.job_id],
    );
  }
  const deadLetter = (await pool.query(
    "SELECT id,status FROM tanaghom.ghl_inbound_events WHERE provider_event_id='resilience-dead-letter-0'",
  )).rows[0];
  assert.equal(deadLetter.status, "dead_letter");
  const replayed = (await queryAs(
    "tanaghom_api",
    "SELECT * FROM tanaghom.replay_ghl_inbound_event($1,$2)",
    [deadLetter.id, ownerId],
  )).rows[0];
  assert.equal(replayed.job_id, deadLetterJob.job_id);
  const replayClaim = await claim();
  assert.equal(replayClaim.job_id, deadLetterJob.job_id);
  await complete(replayClaim);

  await acceptSynthetic("resilience-backlog-", Math.max(100, Math.floor(burstEvents / 2)));
  const abandonedClaims = (await Promise.all(Array.from({ length: workerConcurrency }, () => claim()))).filter(Boolean);
  const abandonedIds = abandonedClaims.map((job) => job.job_id).sort();
  assert.equal(abandonedClaims.length, workerConcurrency);
  await pool.end();
  pool = createPool(databaseUrl);
  await pool.query(
    "UPDATE tanaghom.agent_jobs SET started_at=statement_timestamp()-interval '120 seconds' WHERE id=ANY($1::uuid[])",
    [abandonedIds],
  );
  const recoveredCount = Number((await queryAs(
    "tanaghom_conversation_worker", "SELECT tanaghom.recover_stale_ghl_inbound_event_jobs(60) AS count",
  )).rows[0].count);
  assert.equal(recoveredCount, abandonedClaims.length);
  const recoveredIds = (await pool.query(
    "SELECT id FROM tanaghom.agent_jobs WHERE id=ANY($1::uuid[]) AND status='queued' ORDER BY id", [abandonedIds],
  )).rows.map((row) => row.id).sort();
  assert.deepEqual(recoveredIds, abandonedIds);

  const killedClient = await pool.connect();
  const killedPid = killedClient.processID;
  assert.equal((await pool.query("SELECT pg_terminate_backend($1) AS terminated", [killedPid])).rows[0].terminated, true);
  await assert.rejects(killedClient.query("SELECT 1"));
  killedClient.release(true);
  assert.equal((await pool.query("SELECT 1 AS connected")).rows[0].connected, 1);

  const { sourceFingerprint, restoredFingerprint } = await encryptedBacklogRestore("resilience-backlog-");
  assert.deepEqual(restoredFingerprint, sourceFingerprint);
  await drain("resilience-backlog-");

  const burstStartedAt = performance.now();
  await acceptSynthetic("resilience-burst-", burstEvents);
  const burstMaxQueue = await remaining("resilience-burst-");
  const burstCompleted = await drain("resilience-burst-", pool, modelLatencyMs);
  const burstElapsedMs = performance.now() - burstStartedAt;
  assert.equal(await remaining("resilience-burst-"), 0);

  let soakAccepted = 0;
  let soakMaxQueue = 0;
  let soakWaves = 0;
  let soakProducerDone = false;
  const soakPrefix = "resilience-soak-";
  const soakStartedAt = performance.now();
  async function soakProducer() {
    const deadline = performance.now() + soakSeconds * 1000;
    while (performance.now() < deadline) {
      const prefix = `${soakPrefix}${String(soakWaves).padStart(5, "0")}-`;
      await acceptSynthetic(prefix, soakWaveEvents, soakWaves % 5 === 0 ? "ContactUpdate" : "InboundMessage");
      soakAccepted += soakWaveEvents;
      soakWaves += 1;
      soakMaxQueue = Math.max(soakMaxQueue, await remaining(soakPrefix));
      await sleep(100);
    }
    soakProducerDone = true;
  }
  let soakCompleted = 0;
  async function soakWorker() {
    while (true) {
      const job = await claim();
      if (job) {
        await complete(job, pool, modelLatencyMs);
        soakCompleted += 1;
        continue;
      }
      if (soakProducerDone && await remaining(soakPrefix) === 0) return;
      await sleep(5);
    }
  }
  await Promise.all([soakProducer(), ...Array.from({ length: workerConcurrency }, () => soakWorker())]);
  const soakElapsedMs = performance.now() - soakStartedAt;
  assert.equal(soakCompleted, soakAccepted);
  assert.equal(await remaining(soakPrefix), 0);
  assert.ok(soakMaxQueue > 0);

  const final = (await pool.query(
    `SELECT count(*)::int AS accepted,
            count(*) FILTER (WHERE status='succeeded')::int AS succeeded,
            count(*) FILTER (WHERE status='dead_letter')::int AS dead_letters,
            count(*) FILTER (WHERE delivery_count>1)::int AS duplicates,
            count(*) FILTER (WHERE status IN ('pending','processing'))::int AS remaining
       FROM tanaghom.ghl_inbound_events WHERE provider_event_id LIKE 'resilience-%'`,
  )).rows[0];
  const mismatches = Number((await pool.query(
    `SELECT count(*) AS count FROM tanaghom.agent_jobs job
      JOIN tanaghom.ghl_inbound_events event ON event.id=(job.input->>'event_id')::uuid
     WHERE event.provider_event_id LIKE 'resilience-%'
       AND job.input->>'organization_id'<>event.organization_id::text`,
  )).rows[0].count);
  assert.equal(final.accepted, final.succeeded);
  assert.equal(final.dead_letters, 0);
  assert.equal(final.duplicates, 0);
  assert.equal(final.remaining, 0);
  assert.equal(mismatches, 0);

  const evidence = {
    contract_version: "phase5.conversation-resilience-evidence.v1",
    generated_at: new Date().toISOString(),
    boundaries: {
      disposable_database: true,
      synthetic_events: true,
      customer_credentials_used: false,
      provider_calls: 0,
      gemma_calls: 0,
      smartlabs_touched: false,
      production_touched: false,
    },
    priority: {
      background_queued_first: 24,
      interactive_queued_second: 8,
      first_claims: priorityClaims.length,
      first_claims_all_interactive: true,
    },
    burst: {
      accepted: burstEvents,
      succeeded: burstCompleted,
      max_queue_depth: burstMaxQueue,
      elapsed_ms: Number(burstElapsedMs.toFixed(2)),
      remaining: 0,
    },
    soak: {
      accepted: soakAccepted,
      succeeded: soakCompleted,
      max_queue_depth: soakMaxQueue,
      elapsed_ms: Number(soakElapsedMs.toFixed(2)),
      remaining: 0,
      duration_ms: Number(soakElapsedMs.toFixed(2)),
      waves: soakWaves,
      simulated_model_latency_ms: modelLatencyMs,
    },
    dependency: {
      cooldown_blocked_claims: true,
      accepted_work_preserved_during_cooldown: true,
      automatic_recovery: true,
    },
    recovery: {
      worker_claims_abandoned: abandonedClaims.length,
      worker_claims_recovered: recoveredCount,
      same_job_ids_recovered: true,
      database_connection_terminated: true,
      database_pool_reconnected: true,
      encrypted_backlog_archive: true,
      restored_backlog_matches_source: true,
      restored_backlog_drained: true,
      dead_letter_replayed_with_same_job_id: true,
    },
    outcomes: {
      accepted: final.accepted,
      succeeded: final.succeeded,
      dead_letters: final.dead_letters,
      duplicates: final.duplicates,
      organization_mismatches: mismatches,
      remaining: final.remaining,
    },
  };
  const schema = JSON.parse(await readFile(
    new URL("../packages/contracts/schemas/phase5/conversation-resilience-evidence.v1.schema.json", import.meta.url), "utf8",
  ));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(evidence, null, 2));
  console.log("PASS: burst, soak, priority, dependency cooldown, reconnect, worker recovery, encrypted backlog restore, and dead-letter replay verified.");
} finally {
  await pool.query("UPDATE tanaghom.automation_platform_controls SET emergency_stop=true,reason='Disposable resilience integration complete' WHERE provider='ghl'").catch(() => undefined);
  await restorePool?.end().catch(() => undefined);
  await pool.end().catch(() => undefined);
  if (restoreDatabaseName) {
    const adminPool = createPool(databaseUrlFor("postgres"));
    await adminPool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [restoreDatabaseName]).catch(() => undefined);
    await adminPool.query(`DROP DATABASE IF EXISTS ${restoreDatabaseName}`).catch(() => undefined);
    await adminPool.end().catch(() => undefined);
  }
  if (archiveDirectory) await rm(archiveDirectory, { recursive: true, force: true });
}
