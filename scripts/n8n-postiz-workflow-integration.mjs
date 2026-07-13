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
const temporary = await mkdtemp(join(tmpdir(), "tanaghom-postiz-n8n-"));
const volume = `tanaghom-postiz-n8n-test-${process.pid}`;
const postizPort = 43202;
let requestCount = 0;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(output)
      : reject(new Error(`${command} failed (${code})\n${output}`)));
  });
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/api/internal/integrations/postiz/draft") {
    response.writeHead(404).end();
    return;
  }
  requestCount += 1;
  const body = await requestBody(request);
  assert.equal(request.headers.authorization, "Bearer integration-only-worker-token-32");
  assert.equal(request.headers["idempotency-key"], "postiz-draft:53000000-0000-4000-8000-000000000001");
  assert.equal(body.request_body.type, "draft");
  assert.equal(body.request_body.posts.length, 1);
  assert.equal(body.request_body.posts[0].integration.id, "integration-channel-1");
  assert.equal(body.request_body.posts[0].value[0].content, "Workflow Postiz draft");
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify([{ postId: "postiz-draft-123", integration: "integration-channel-1" }]));
});

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
try {
  server.listen(postizPort, "127.0.0.1");
  await once(server, "listening");
  await pool.query("ALTER ROLE tanaghom_n8n_worker LOGIN PASSWORD 'integration-only'");
  await pool.query(`UPDATE tanaghom.automation_platform_controls
    SET emergency_stop=false, reason='Disposable n8n workflow test'
    WHERE provider='postiz'`);
  await pool.query(`INSERT INTO tanaghom.integration_connections
    (organization_id,provider,status,base_url,credential_kind,credential_ciphertext,
     credential_nonce,credential_auth_tag,credential_key_version,secret_last_four,
     configuration,configured_by)
    VALUES ('10000000-0000-4000-8000-000000000001','postiz','connected',
      'https://api.postiz.com/public/v1','api_key',decode('01','hex'),
      decode(repeat('02',12),'hex'),decode(repeat('03',16),'hex'),1,'test','{}',
      '00000000-0000-4000-8000-000000000001')
    ON CONFLICT (organization_id,provider) DO UPDATE SET
      status='connected',credential_ciphertext=excluded.credential_ciphertext,
      credential_nonce=excluded.credential_nonce,credential_auth_tag=excluded.credential_auth_tag,
      credential_key_version=1,secret_last_four='test',disconnected_at=NULL`);
  await pool.query(`INSERT INTO tanaghom.publishing_channels
    (organization_id, provider, channel, provider_integration_id, provider_settings)
    VALUES ('10000000-0000-4000-8000-000000000001','postiz','instagram','integration-channel-1','{"__type":"instagram","post_type":"post"}')
    ON CONFLICT (organization_id, provider, channel) DO UPDATE SET
      provider_integration_id=excluded.provider_integration_id,
      provider_settings=excluded.provider_settings,
      is_active=true`);
  const strategy = await pool.query(`INSERT INTO tanaghom.campaign_strategies
    (campaign_id, version, positioning, key_messages, channels, posting_cadence, content_pillars, model_name, prompt_version)
    VALUES ('20000000-0000-4000-8000-000000000001', 401, 'Postiz workflow test', '["safe"]', '["instagram"]', '{}', '["proof"]', 'none', 'phase4-test')
    RETURNING id`);
  await pool.query(`INSERT INTO tanaghom.content_items
    (id, campaign_id, strategy_id, generation, channel, content_type, draft_copy, media_brief, status)
    VALUES
      ('53000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',$1,401,'instagram','post','Workflow Postiz draft','No external media','pending_approval'),
      ('53000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',$1,402,'instagram','post','Unapproved forged draft','No external media','pending_approval')`, [strategy.rows[0].id]);
  await pool.query(`INSERT INTO tanaghom.content_approvals (content_item_id, decision, decided_by)
    VALUES ('53000000-0000-4000-8000-000000000001','approved','00000000-0000-4000-8000-000000000001')`);
  await pool.query(`UPDATE tanaghom.content_items SET status='approved'
    WHERE id='53000000-0000-4000-8000-000000000001'`);
  const queued = await pool.query(`SELECT * FROM tanaghom.queue_postiz_draft(
    '53000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001')`);
  const jobId = queued.rows[0].job_id;

  const credentials = [
    {
      id: "62000000-0000-4000-8000-000000000001",
      name: "Tanaghom Worker PostgreSQL",
      type: "postgres",
      data: {
        host: "127.0.0.1",
        database: new URL(databaseUrl).pathname.slice(1),
        user: "tanaghom_n8n_worker",
        password: "integration-only",
        port: Number(new URL(databaseUrl).port || 5432),
        ssl: "disable",
      },
    },
    {
      id: "62000000-0000-4000-8000-000000000004",
      name: "Tanaghom Integration Gateway",
      type: "httpHeaderAuth",
      data: { name: "Authorization", value: "Bearer integration-only-worker-token-32" },
    },
  ];
  await writeFile(join(temporary, "credentials.json"), JSON.stringify(credentials));
  const workflow = JSON.parse(await readFile(
    join(root, "n8n", "workflows", "phase4", "postiz-draft-publisher.v1.json"),
    "utf8",
  ));
  workflow.nodes.find((entry) => entry.name === "Create Postiz Draft").parameters.url =
    `http://127.0.0.1:${postizPort}/api/internal/integrations/postiz/draft`;
  await writeFile(join(temporary, "workflow.json"), JSON.stringify(workflow));
  await chmod(temporary, 0o755);
  await Promise.all(["credentials.json", "workflow.json"].map((file) => chmod(join(temporary, file), 0o644)));

  await run("docker", ["volume", "create", volume]);
  const dockerBase = [
    "run", "--rm", "--network", "host",
    "-e", "N8N_ENCRYPTION_KEY=integration-only-encryption-key-32",
    "-e", "N8N_USER_MANAGEMENT_DISABLED=true",
    "-e", "N8N_DIAGNOSTICS_ENABLED=false",
    "-e", "N8N_SSRF_PROTECTION_ENABLED=false",
    `-e`, `TANAGHOM_INTEGRATION_GATEWAY_URL=http://127.0.0.1:${postizPort}`,
    "-v", `${volume}:/home/node/.n8n`,
    "-v", `${temporary}:/fixtures:ro`,
    image,
  ];
  await run("docker", [...dockerBase, "import:credentials", "--input=/fixtures/credentials.json"]);
  await run("docker", [...dockerBase, "import:workflow", "--input=/fixtures/workflow.json"]);
  const execution = await run("docker", [...dockerBase, "execute", "--id=phase4PostizDraftV1", "--rawOutput"]);

  assert.equal(requestCount, 1, execution.slice(-4000));
  assert.equal((await pool.query("SELECT status FROM tanaghom.agent_jobs WHERE id=$1", [jobId])).rows[0].status, "succeeded");
  assert.deepEqual((await pool.query(`SELECT provider_post_id,status FROM tanaghom.posts
    WHERE content_item_id='53000000-0000-4000-8000-000000000001'`)).rows[0], {
    provider_post_id: "postiz-draft-123",
    status: "draft",
  });
  assert.equal((await pool.query(`SELECT count(*)::int count FROM tanaghom.external_operations
    WHERE idempotency_key='postiz-draft:53000000-0000-4000-8000-000000000001'
      AND status='succeeded'`)).rows[0].count, 1);

  const replay = await pool.query(`SELECT * FROM tanaghom.queue_postiz_draft(
    '53000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001')`);
  assert.equal(replay.rows[0].job_id, jobId);
  assert.equal(replay.rows[0].job_status, "succeeded");
  assert.equal((await pool.query(`SELECT count(*)::int count FROM tanaghom.agent_jobs
    WHERE job_type='content.postiz.draft'
      AND input->>'content_item_id'='53000000-0000-4000-8000-000000000001'`)).rows[0].count, 1);

  await pool.query(`INSERT INTO tanaghom.agent_jobs
    (correlation_id,agent_id,campaign_id,job_type,input)
    VALUES ('54000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000001','content.postiz.draft',
      '{"contract_version":"phase4.postiz-draft-job.v1","content_item_id":"53000000-0000-4000-8000-000000000002","organization_id":"10000000-0000-4000-8000-000000000001"}')`);
  await assert.rejects(
    run("docker", [...dockerBase, "execute", "--id=phase4PostizDraftV1", "--rawOutput"]),
    /content is no longer approved/,
  );
  assert.equal(requestCount, 1, "forged unapproved job reached simulated Postiz");
  console.log("PASS: inactive Postiz workflow created one draft and blocked replay plus forged unapproved content.");
} finally {
  server.close();
  await pool.query(`
    DELETE FROM tanaghom.posts WHERE content_item_id IN
      ('53000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002');
    DELETE FROM tanaghom.external_operations WHERE idempotency_key IN
      ('postiz-draft:53000000-0000-4000-8000-000000000001','postiz-draft:53000000-0000-4000-8000-000000000002');
    DELETE FROM tanaghom.outbox_events WHERE aggregate_id IN
      ('53000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002');
    ALTER TABLE tanaghom.agent_actions_log DISABLE TRIGGER audit_no_update;
    ALTER TABLE tanaghom.agent_actions_log DISABLE TRIGGER audit_no_delete;
    DELETE FROM tanaghom.agent_actions_log WHERE entity_id IN
      ('53000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002')
      OR job_id IN (SELECT id FROM tanaghom.agent_jobs WHERE job_type='content.postiz.draft'
        AND input->>'content_item_id' IN ('53000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002'));
    DELETE FROM tanaghom.agent_jobs WHERE job_type='content.postiz.draft'
      AND input->>'content_item_id' IN ('53000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002');
    ALTER TABLE tanaghom.agent_actions_log ENABLE TRIGGER audit_no_update;
    ALTER TABLE tanaghom.agent_actions_log ENABLE TRIGGER audit_no_delete;
    DELETE FROM tanaghom.content_items WHERE id IN
      ('53000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002');
    DELETE FROM tanaghom.campaign_strategies
      WHERE campaign_id='20000000-0000-4000-8000-000000000001' AND version=401;
    DELETE FROM tanaghom.integration_connections WHERE provider='postiz';
    UPDATE tanaghom.automation_platform_controls
      SET emergency_stop=true, reason='Disposable n8n workflow test complete'
      WHERE provider='postiz';
    UPDATE tanaghom.agents SET status='idle' WHERE code='publisher_monitor' AND status <> 'disabled';
  `).catch(() => {});
  await pool.end();
  await run("docker", ["volume", "rm", "-f", volume]).catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
