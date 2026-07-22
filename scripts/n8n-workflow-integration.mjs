import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import pg from "pg";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required");
const image = "docker.n8n.io/n8nio/n8n:2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd";
const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "tanaghom-n8n-"));
const volume = `tanaghom-n8n-test-${process.pid}`;
const gemmaPort = 43201;
const dockerHost = process.platform === "win32" ? "host.docker.internal" : "127.0.0.1";
let responseMode = "valid";

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

const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const system = body.messages?.[0]?.content || "";
  let content;
  if (responseMode === "invalid") {
    content = "not-json";
  } else if (system.includes("Campaign Strategist")) {
    content = JSON.stringify({
      contract_version: "phase3.strategist-output.v1", status: "ok",
      positioning: "Integration-only positioning", key_messages: ["one", "two", "three"],
      channels: ["instagram"], posting_cadence: { instagram: { posts_per_week: 1 } },
      content_pillars: [
        { name: "Proof", description: "Evidence", example_angles: ["A"] },
        { name: "People", description: "Audience", example_angles: ["B"] },
        { name: "Process", description: "Method", example_angles: ["C"] },
        { name: "Offer", description: "Value", example_angles: ["D"] },
      ],
    });
  } else {
    content = JSON.stringify({
      contract_version: "phase3.content-producer-output.v1",
      items: [{ channel: "instagram", content_type: "post", content_pillar: "Proof", draft_copy: "Integration-only draft", media_brief: "Integration-only visual", scheduled_time_suggestion: null }],
    });
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content } }] }));
});

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
try {
  server.listen(gemmaPort, process.platform === "win32" ? "0.0.0.0" : "127.0.0.1");
  await once(server, "listening");
  await pool.query("ALTER ROLE tanaghom_n8n_worker LOGIN PASSWORD 'integration-only'");

  const credentials = [
    { id: "62000000-0000-4000-8000-000000000001", name: "Tanaghom Worker PostgreSQL", type: "postgres", data: { host: dockerHost, database: "tanaghom_agents_workflow_test", user: "tanaghom_n8n_worker", password: "integration-only", port: 5432, ssl: "disable" } },
    { id: "62000000-0000-4000-8000-000000000002", name: "Tanaghom Gemma API", type: "httpHeaderAuth", data: { name: "Authorization", value: "Bearer integration-only" } },
  ];
  await writeFile(join(temporary, "credentials.json"), JSON.stringify(credentials));
  for (const file of ["campaign-strategist.v1.json", "content-producer.v1.json"]) {
    const workflow = JSON.parse(await readFile(join(root, "n8n", "workflows", "phase3", file), "utf8"));
    const http = workflow.nodes.find((entry) => entry.name === "Call Gemma");
    http.parameters.url = `http://${dockerHost}:${gemmaPort}/v1/chat/completions`;
    await writeFile(join(temporary, `original-${file}`), JSON.stringify(workflow));
    const schedule = workflow.nodes.find((entry) => entry.type === "n8n-nodes-base.scheduleTrigger");
    assert.ok(schedule, `${file} schedule trigger is missing`);
    schedule.disabled = true;
    await writeFile(join(temporary, file), JSON.stringify(workflow));
  }
  await writeFile(join(temporary, "workflows-after.json"), "[]\n");
  await chmod(temporary, 0o755);
  await Promise.all(["credentials.json", "campaign-strategist.v1.json", "content-producer.v1.json", "original-campaign-strategist.v1.json", "original-content-producer.v1.json", "workflows-after.json"]
    .map((file) => chmod(join(temporary, file), 0o644)));

  await run("docker", ["volume", "create", volume]);
  const dockerBase = ["run", "--rm", "--network", "host", "-e", "N8N_ENCRYPTION_KEY=integration-only-encryption-key-32", "-e", "N8N_USER_MANAGEMENT_DISABLED=true", "-e", "N8N_DIAGNOSTICS_ENABLED=false", "-e", "N8N_SSRF_PROTECTION_ENABLED=false", "-v", `${volume}:/home/node/.n8n`, "-v", `${temporary}:/fixtures`, image];
  await run("docker", [...dockerBase, "import:credentials", "--input=/fixtures/credentials.json"]);
  await run("docker", [...dockerBase, "import:workflow", "--input=/fixtures/campaign-strategist.v1.json"]);
  await run("docker", [...dockerBase, "import:workflow", "--input=/fixtures/content-producer.v1.json"]);

  const campaignName = "Integration controlled core canary.test";
  const operator = join(root, "deployment", "phase6-core-agent-canary", "scripts", "canary-operator.mjs");
  const operatorOptions = { env: { ...process.env, DATABASE_URL: databaseUrl, TANAGHOM_EXPECTED_MIGRATION: "0025_runtime_agent_reconciliation" } };
  await run(process.execPath, [operator, "check-database", campaignName], operatorOptions);
  await run(process.execPath, [operator, "seed", campaignName], operatorOptions);
  const campaignId = (await pool.query("SELECT id FROM tanaghom.campaigns WHERE name=$1", [campaignName])).rows[0].id;
  await run("docker", [...dockerBase, "publish:workflow", "--id=phase3StrategistV1"]);
  const strategistExecution = await run("docker", [...dockerBase, "execute", "--id=phase3StrategistV1", "--rawOutput"]);
  await run("docker", [...dockerBase, "unpublish:workflow", "--id=phase3StrategistV1"]);
  assert.equal((await pool.query("SELECT status FROM tanaghom.agent_jobs WHERE campaign_id=$1 AND job_type='campaign.strategy.generate'", [campaignId])).rows[0].status, "succeeded", strategistExecution.slice(-4000));

  await run(process.execPath, [operator, "queue-content", campaignName], operatorOptions);
  await run("docker", [...dockerBase, "publish:workflow", "--id=phase3ContentProducerV1"]);
  const producerExecution = await run("docker", [...dockerBase, "execute", "--id=phase3ContentProducerV1", "--rawOutput"]);
  await run("docker", [...dockerBase, "unpublish:workflow", "--id=phase3ContentProducerV1"]);
  assert.equal((await pool.query("SELECT status FROM tanaghom.agent_jobs WHERE campaign_id=$1 AND job_type='campaign.content.generate'", [campaignId])).rows[0].status, "waiting_approval", producerExecution.slice(-4000));
  assert.equal((await pool.query("SELECT count(*)::int count FROM tanaghom.content_items WHERE draft_copy='Integration-only draft' AND status='pending_approval'")).rows[0].count, 1);
  await run(process.execPath, [operator, "verify-pending", campaignName], operatorOptions);

  const contentId = (await pool.query("SELECT id FROM tanaghom.content_items WHERE draft_copy='Integration-only draft'")).rows[0].id;
  const ownerId = (await pool.query("SELECT id FROM tanaghom.app_users WHERE kind='human' AND role='owner' AND is_active ORDER BY created_at LIMIT 1")).rows[0].id;
  await pool.query("BEGIN");
  await pool.query("INSERT INTO tanaghom.content_approvals (content_item_id,decision,decided_by) VALUES ($1,'approved',$2)", [contentId, ownerId]);
  await pool.query("UPDATE tanaghom.content_items SET status='approved' WHERE id=$1", [contentId]);
  await pool.query("COMMIT");
  assert.equal((await pool.query("SELECT count(*)::int count FROM tanaghom.content_approvals WHERE content_item_id=$1 AND decision='approved' AND decided_by=$2", [contentId, ownerId])).rows[0].count, 1);
  assert.equal((await pool.query("SELECT count(*)::int count FROM tanaghom.agent_jobs WHERE campaign_id=$1 AND job_type IN ('content.postiz.draft','lead.ghl.contact_upsert','ghl.action.execute')", [campaignId])).rows[0].count, 0);
  assert.equal((await pool.query("SELECT count(*)::int count FROM tanaghom.posts p JOIN tanaghom.content_items i ON i.id=p.content_item_id WHERE i.campaign_id=$1", [campaignId])).rows[0].count, 0);
  assert.equal((await pool.query("SELECT count(*)::int count FROM tanaghom.external_operations WHERE correlation_id IN (SELECT correlation_id FROM tanaghom.agent_jobs WHERE campaign_id=$1)", [campaignId])).rows[0].count, 0);
  await run(process.execPath, [operator, "verify-approved", campaignName], operatorOptions);

  await run("docker", [...dockerBase, "import:workflow", "--input=/fixtures/original-campaign-strategist.v1.json", "--activeState=false"]);
  await run("docker", [...dockerBase, "import:workflow", "--input=/fixtures/original-content-producer.v1.json", "--activeState=false"]);
  await chmod(join(temporary, "workflows-after.json"), 0o666);
  await run("docker", [...dockerBase, "export:workflow", "--all", "--pretty", "--output=/fixtures/workflows-after.json"]);
  const restored = JSON.parse(await readFile(join(temporary, "workflows-after.json"), "utf8"));
  for (const id of ["phase3StrategistV1", "phase3ContentProducerV1"]) {
    const workflow = restored.find((entry) => entry.id === id);
    assert.equal(workflow.active, false);
    assert.notEqual(workflow.nodes.find((entry) => entry.type === "n8n-nodes-base.scheduleTrigger")?.disabled, true);
  }

  responseMode = "invalid";
  await pool.query(`INSERT INTO tanaghom.agent_jobs (id, correlation_id, agent_id, campaign_id, job_type, input) VALUES ('70000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',$1,'campaign.strategy.generate','{}')`, [campaignId]);
  await run("docker", [...dockerBase, "execute", "--id=phase3StrategistV1", "--rawOutput"]);
  const failed = (await pool.query("SELECT status,attempt,error_code FROM tanaghom.agent_jobs WHERE id='70000000-0000-4000-8000-000000000003'")).rows[0];
  assert.deepEqual(failed, { status: "queued", attempt: 1, error_code: "gemma_invalid_json" });
  console.log("PASS: pinned n8n ran a sequential schedule-disabled core canary, stopped at human approval, produced no provider side effects, restored both workflows inactive, and retained retry coverage.");
} finally {
  server.close();
  await pool.end();
  await run("docker", ["volume", "rm", "-f", volume]).catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
