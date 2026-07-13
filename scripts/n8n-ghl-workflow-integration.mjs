import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required");
const image = "docker.n8n.io/n8nio/n8n:2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd";
const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "tanaghom-ghl-n8n-"));
const volume = `tanaghom-ghl-n8n-test-${process.pid}`;
const gatewayPort = 43203;
const leadId = "65000000-0000-4000-8000-000000000011";
let requestCount = 0;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`${command} failed (${code})\n${output}`)));
  });
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/api/internal/integrations/ghl/contact") {
    response.writeHead(404).end(); return;
  }
  requestCount += 1;
  const body = await requestBody(request);
  assert.equal(request.headers.authorization, "Bearer integration-only-worker-token-32");
  assert.equal(request.headers["idempotency-key"], `ghl-contact-upsert:${leadId}:1`);
  assert.deepEqual(body.request_body, {
    name: "GHL Workflow Lead", email: "workflow-lead@example.test", phone: "+15555550111",
    locationId: "location-test-1", source: "Tanaghom", createNewIfDuplicateAllowed: false,
  });
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ new: true, contact: { id: "ghl-contact-123", locationId: "location-test-1" } }));
});

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
try {
  server.listen(gatewayPort, "127.0.0.1"); await once(server, "listening");
  await pool.query("ALTER ROLE tanaghom_n8n_worker LOGIN PASSWORD 'integration-only'");
  await pool.query("UPDATE tanaghom.automation_platform_controls SET emergency_stop=false, reason='Disposable GHL workflow test' WHERE provider='ghl'");
  await pool.query(`INSERT INTO tanaghom.integration_connections
    (organization_id,provider,status,base_url,credential_kind,credential_ciphertext,credential_nonce,
     credential_auth_tag,credential_key_version,secret_last_four,configuration,configured_by)
    VALUES ('10000000-0000-4000-8000-000000000001','ghl','connected','https://services.leadconnectorhq.com',
      'private_token',decode('01','hex'),decode(repeat('02',12),'hex'),decode(repeat('03',16),'hex'),1,'test',
      '{"location_id":"location-test-1"}','00000000-0000-4000-8000-000000000001')`);
  await pool.query(`INSERT INTO tanaghom.leads (id,campaign_id,name,contact_email,contact_phone,status)
    VALUES ($1,'20000000-0000-4000-8000-000000000001','GHL Workflow Lead','workflow-lead@example.test','+15555550111','new')`, [leadId]);
  const queued = await pool.query("SELECT * FROM tanaghom.queue_ghl_contact_upsert($1,'00000000-0000-4000-8000-000000000001')", [leadId]);
  const replay = await pool.query("SELECT * FROM tanaghom.queue_ghl_contact_upsert($1,'00000000-0000-4000-8000-000000000001')", [leadId]);
  assert.equal(replay.rows[0].job_id, queued.rows[0].job_id);

  const database = new URL(databaseUrl);
  const credentials = [
    { id: "62000000-0000-4000-8000-000000000001", name: "Tanaghom Worker PostgreSQL", type: "postgres", data: {
      host: "127.0.0.1", database: database.pathname.slice(1), user: "tanaghom_n8n_worker", password: "integration-only",
      port: Number(database.port || 5432), ssl: "disable",
    } },
    { id: "62000000-0000-4000-8000-000000000004", name: "Tanaghom Integration Gateway", type: "httpHeaderAuth",
      data: { name: "Authorization", value: "Bearer integration-only-worker-token-32" } },
  ];
  await writeFile(join(temporary, "credentials.json"), JSON.stringify(credentials));
  const workflow = JSON.parse(await readFile(join(root, "n8n", "workflows", "phase5", "ghl-contact-sync.v1.json"), "utf8"));
  workflow.nodes.find((entry) => entry.name === "Upsert GHL Contact").parameters.url = `http://127.0.0.1:${gatewayPort}/api/internal/integrations/ghl/contact`;
  await writeFile(join(temporary, "workflow.json"), JSON.stringify(workflow));
  await chmod(temporary, 0o755); await chmod(join(temporary, "credentials.json"), 0o644); await chmod(join(temporary, "workflow.json"), 0o644);

  await run("docker", ["volume", "create", volume]);
  const dockerBase = ["run", "--rm", "--network", "host", "-e", "N8N_ENCRYPTION_KEY=integration-only-encryption-key-32",
    "-e", "N8N_USER_MANAGEMENT_DISABLED=true", "-e", "N8N_DIAGNOSTICS_ENABLED=false", "-e", "N8N_SSRF_PROTECTION_ENABLED=false",
    "-e", `TANAGHOM_INTEGRATION_GATEWAY_URL=http://127.0.0.1:${gatewayPort}`,
    "-v", `${volume}:/home/node/.n8n`, "-v", `${temporary}:/fixtures:ro`, image];
  await run("docker", [...dockerBase, "import:credentials", "--input=/fixtures/credentials.json"]);
  await run("docker", [...dockerBase, "import:workflow", "--input=/fixtures/workflow.json"]);
  const execution = await run("docker", [...dockerBase, "execute", "--id=phase5GhlContactUpsertV1", "--rawOutput"]);

  assert.equal(requestCount, 1, execution.slice(-4000));
  assert.equal((await pool.query("SELECT status FROM tanaghom.agent_jobs WHERE id=$1", [queued.rows[0].job_id])).rows[0].status, "succeeded");
  assert.equal((await pool.query("SELECT ghl_contact_id FROM tanaghom.leads WHERE id=$1", [leadId])).rows[0].ghl_contact_id, "ghl-contact-123");
  assert.equal((await pool.query("SELECT count(*)::int count FROM tanaghom.external_operations WHERE provider='ghl' AND operation_type='upsert_contact' AND status='succeeded'")).rows[0].count, 1);
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.find((entry) => entry.type === "n8n-nodes-base.scheduleTrigger").disabled, true);
  assert.equal(workflow.settings.saveDataErrorExecution, "none");
  console.log("PASS: inactive GHL workflow performed one simulated contact upsert without messaging or credential exposure.");
} finally {
  server.close();
  await pool.query(`
    UPDATE tanaghom.automation_platform_controls SET emergency_stop=true, reason='Disposable GHL workflow test complete' WHERE provider='ghl';
    DELETE FROM tanaghom.integration_connections WHERE provider='ghl';
    DELETE FROM tanaghom.external_operations WHERE provider='ghl' AND operation_type='upsert_contact';
    DELETE FROM tanaghom.outbox_events WHERE aggregate_id=$1;
    ALTER TABLE tanaghom.agent_actions_log DISABLE TRIGGER audit_no_update;
    ALTER TABLE tanaghom.agent_actions_log DISABLE TRIGGER audit_no_delete;
    DELETE FROM tanaghom.agent_actions_log WHERE entity_id=$1;
    DELETE FROM tanaghom.agent_jobs WHERE job_type='lead.ghl.contact_upsert' AND input->>'lead_id'=$1;
    ALTER TABLE tanaghom.agent_actions_log ENABLE TRIGGER audit_no_update;
    ALTER TABLE tanaghom.agent_actions_log ENABLE TRIGGER audit_no_delete;
    DELETE FROM tanaghom.leads WHERE id=$1;
    UPDATE tanaghom.agents SET status='idle' WHERE code='sales_crm' AND status <> 'disabled';
  `, [leadId]).catch(() => {});
  await pool.end(); await run("docker", ["volume", "rm", "-f", volume]).catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
