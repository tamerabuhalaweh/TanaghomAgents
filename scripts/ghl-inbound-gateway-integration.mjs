import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required");

const dashboardPort = 43201;
const dashboardOrigin = `http://127.0.0.1:${dashboardPort}`;
const loadEvents = Number(process.env.GHL_INBOUND_LOAD_EVENTS || "1000");
const evidencePath = process.env.GHL_INBOUND_EVIDENCE_PATH || "tmp/ghl-inbound-load-evidence.json";
if (!Number.isInteger(loadEvents) || loadEvents < 1 || loadEvents > 100_000) {
  throw new Error("GHL_INBOUND_LOAD_EVENTS must be an integer between 1 and 100000");
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
let dashboard;

function signature(rawBody) {
  return sign(null, Buffer.from(rawBody), privateKey).toString("base64");
}

async function sendRaw(rawBody, options = {}) {
  const started = performance.now();
  const response = await fetch(`${dashboardOrigin}/api/webhooks/ghl`, {
    method: "POST",
    headers: {
      "Content-Type": options.contentType || "application/json",
      ...(options.omitSignature ? {} : { "X-GHL-Signature": options.signature || signature(rawBody) }),
    },
    body: rawBody,
  });
  return { response, body: await response.json(), duration: performance.now() - started };
}

async function send(payload, options) {
  return sendRaw(JSON.stringify(payload), options);
}

async function waitForDashboard() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (dashboard?.exitCode !== null) throw new Error(`dashboard exited with ${dashboard?.exitCode}`);
    try {
      const response = await fetch(`${dashboardOrigin}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("dashboard did not become healthy");
}

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

function percentile(sorted, ratio) {
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)].toFixed(2));
}

try {
  await pool.query("DELETE FROM tanaghom.integration_connections WHERE provider='ghl'");
  await pool.query(
    `INSERT INTO tanaghom.integration_connections (
       organization_id, provider, status, base_url, credential_kind,
       credential_ciphertext, credential_nonce, credential_auth_tag,
       credential_key_version, secret_last_four, configuration, configured_by
     ) VALUES (
       '10000000-0000-4000-8000-000000000001', 'ghl', 'connected',
       'https://services.leadconnectorhq.com', 'private_token', decode('01','hex'),
       decode(repeat('02',12),'hex'), decode(repeat('03',16),'hex'),
       1, 'test', '{"location_id":"location-gateway-test"}',
       '00000000-0000-4000-8000-000000000001'
     )`,
  );
  await pool.query(
    `UPDATE tanaghom.organization_crm_policies
        SET conversation_processing_mode='shadow'
      WHERE organization_id='10000000-0000-4000-8000-000000000001'`,
  );
  await pool.query(
    `UPDATE tanaghom.automation_platform_controls
        SET emergency_stop=false, reason='GHL inbound integration test'
      WHERE provider='ghl'`,
  );

  dashboard = spawn(process.execPath, ["apps/dashboard/.next/standalone/apps/dashboard/server.js"], {
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(dashboardPort),
      DATABASE_URL: databaseUrl,
      APP_ENV: "integration",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      // The health contract requires authentication configuration even though
      // this public-webhook test never performs an authenticated request.
      SUPABASE_URL: "https://phase5b-integration.invalid",
      GHL_WEBHOOK_INGRESS_ENABLED: "true",
      GHL_WEBHOOK_PUBLIC_KEY_PEM: publicKeyPem,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  dashboard.stdout.on("data", (chunk) => process.stdout.write(chunk));
  dashboard.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForDashboard();

  const basePayload = {
    type: "InboundMessage",
    webhookId: "gateway-inbound-1",
    locationId: "location-gateway-test",
    contactId: "contact-gateway-1",
    conversationId: "conversation-gateway-1",
    messageId: "message-gateway-1",
    messageType: "WhatsApp",
    direction: "inbound",
    dateAdded: "2026-07-13T12:00:00.000Z",
    body: "Can you tell me more?",
    contentType: "text/plain",
    status: "delivered",
  };

  const missingSignature = await send(basePayload, { omitSignature: true });
  assert.equal(missingSignature.response.status, 401);
  assert.equal(missingSignature.body.error, "signature_missing");
  const invalidSignature = await send(basePayload, { signature: Buffer.alloc(64, 7).toString("base64") });
  assert.equal(invalidSignature.response.status, 401);
  assert.equal(invalidSignature.body.error, "signature_invalid");
  const invalidJson = await sendRaw("{not-json");
  assert.equal(invalidJson.response.status, 202);
  assert.equal(invalidJson.body.reason, "invalid_json");
  const unsupported = await send({ ...basePayload, type: "OpportunityCreate", webhookId: "unsupported-1" });
  assert.equal(unsupported.response.status, 202);
  assert.equal(unsupported.body.reason, "unsupported_event");
  const unknownLocation = await send({ ...basePayload, webhookId: "unknown-location-1", locationId: "unknown-location" });
  assert.equal(unknownLocation.response.status, 202);
  assert.equal(unknownLocation.body.reason, "location_unconfigured");

  const accepted = await send(basePayload);
  assert.equal(accepted.response.status, 202);
  assert.equal(accepted.body.accepted, true);
  assert.equal(accepted.body.duplicate, false);
  const duplicate = await send(basePayload);
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.event_id, accepted.body.event_id);
  assert.equal(duplicate.body.delivery_count, 2);

  const durable = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM tanaghom.ghl_inbound_events WHERE provider_event_id='gateway-inbound-1') events,
       (SELECT count(*)::int FROM tanaghom.agent_jobs
         WHERE job_type='conversation.ghl.inbound_event' AND input->>'event_id'=$1::text) jobs,
       (SELECT payload->'details'->>'body' FROM tanaghom.ghl_inbound_events WHERE id=$1::uuid) body`,
    [accepted.body.event_id],
  );
  assert.deepEqual(durable.rows[0], { events: 1, jobs: 1, body: "Can you tell me more?" });

  await pool.query(
    `UPDATE tanaghom.organization_crm_policies SET conversation_processing_mode='paused'
      WHERE organization_id='10000000-0000-4000-8000-000000000001'`,
  );
  assert.equal((await queryAs("tanaghom_conversation_worker", "SELECT * FROM tanaghom.claim_ghl_inbound_event_job()")).rowCount, 0);
  await pool.query(
    `UPDATE tanaghom.organization_crm_policies SET conversation_processing_mode='shadow'
      WHERE organization_id='10000000-0000-4000-8000-000000000001'`,
  );
  await pool.query("UPDATE tanaghom.automation_platform_controls SET emergency_stop=true WHERE provider='ghl'");
  assert.equal((await queryAs("tanaghom_conversation_worker", "SELECT * FROM tanaghom.claim_ghl_inbound_event_job()")).rowCount, 0);
  await pool.query("UPDATE tanaghom.automation_platform_controls SET emergency_stop=false WHERE provider='ghl'");
  const claimed = await queryAs("tanaghom_conversation_worker", "SELECT * FROM tanaghom.claim_ghl_inbound_event_job()");
  assert.equal(claimed.rows[0].event_id, accepted.body.event_id);
  await queryAs(
    "tanaghom_conversation_worker",
    "SELECT tanaghom.complete_ghl_inbound_event($1::uuid,$2::jsonb)",
    [claimed.rows[0].job_id, JSON.stringify({
      contract_version: "phase5.ghl-inbound-event-result.v1",
      event_id: accepted.body.event_id,
      outcome: "accepted_for_conversation_intelligence",
      external_action_count: 0,
    })],
  );

  const loadStartedAt = performance.now();
  const latencies = [];
  let nextIndex = 0;
  async function loadWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= loadEvents) return;
      const result = await send({
        ...basePayload,
        webhookId: `load-event-${index}`,
        messageId: `load-message-${index}`,
        conversationId: `load-conversation-${Math.floor(index / 5)}`,
        contactId: `load-contact-${Math.floor(index / 5)}`,
        body: `Synthetic message ${index}`,
      });
      assert.equal(result.response.status, 202, `load event ${index} was not durably accepted`);
      assert.equal(result.body.accepted, true);
      latencies.push(result.duration);
    }
  }
  await Promise.all(Array.from({ length: Math.min(32, loadEvents) }, () => loadWorker()));
  const elapsedMs = performance.now() - loadStartedAt;
  latencies.sort((left, right) => left - right);

  const loadState = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM tanaghom.ghl_inbound_events WHERE provider_event_id LIKE 'load-event-%') events,
       (SELECT count(*)::int FROM tanaghom.agent_jobs
         WHERE job_type='conversation.ghl.inbound_event'
           AND input->>'event_id' IN (
             SELECT id::text FROM tanaghom.ghl_inbound_events WHERE provider_event_id LIKE 'load-event-%'
           )) jobs,
       queue_depth::int, duplicate_delivery_count::int, dead_letter_count::int,
       oldest_queue_age_seconds::int
     FROM tanaghom.ghl_inbound_event_metrics
     WHERE organization_id='10000000-0000-4000-8000-000000000001'`,
  );
  assert.equal(loadState.rows[0].events, loadEvents);
  assert.equal(loadState.rows[0].jobs, loadEvents);
  assert.equal(loadState.rows[0].dead_letter_count, 0);

  const evidence = {
    contract_version: "phase5.ghl-inbound-load-evidence.v1",
    generated_at: new Date().toISOString(),
    workload: {
      events: loadEvents,
      concurrency: Math.min(32, loadEvents),
      shape: "campaign-shaped synthetic inbound WhatsApp messages; five turns per synthetic conversation",
      fixed_capacity_claim: false,
    },
    results: {
      accepted_events: loadState.rows[0].events,
      downstream_jobs: loadState.rows[0].jobs,
      elapsed_ms: Number(elapsedMs.toFixed(2)),
      throughput_events_per_second: Number((loadEvents / (elapsedMs / 1000)).toFixed(2)),
      acknowledgement_latency_ms: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99),
        maximum: Number(latencies.at(-1).toFixed(2)),
      },
      queue_depth: loadState.rows[0].queue_depth,
      duplicate_deliveries: loadState.rows[0].duplicate_delivery_count,
      dead_letters: loadState.rows[0].dead_letter_count,
      oldest_queue_age_seconds: loadState.rows[0].oldest_queue_age_seconds,
    },
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(evidence, null, 2));
  console.log("PASS: signed GHL ingress, durable acceptance, deduplication, pause gates, least-privilege claim, and load evidence verified.");
} finally {
  if (dashboard && dashboard.exitCode === null) dashboard.kill("SIGTERM");
  await pool.query(
    "UPDATE tanaghom.automation_platform_controls SET emergency_stop=true, reason='GHL inbound integration test complete' WHERE provider='ghl'",
  ).catch(() => undefined);
  await pool.end();
}
