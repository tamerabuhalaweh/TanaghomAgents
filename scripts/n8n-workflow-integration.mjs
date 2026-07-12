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
  server.listen(gemmaPort, "127.0.0.1");
  await once(server, "listening");
  await pool.query("ALTER ROLE tanaghom_n8n_worker LOGIN PASSWORD 'integration-only'");

  const credentials = [
    { id: "62000000-0000-4000-8000-000000000001", name: "Tanaghom Worker PostgreSQL", type: "postgres", data: { host: "127.0.0.1", database: "tanaghom_agents_workflow_test", user: "tanaghom_n8n_worker", password: "integration-only", port: 5432, ssl: "disable" } },
    { id: "62000000-0000-4000-8000-000000000002", name: "Tanaghom Gemma API", type: "httpHeaderAuth", data: { name: "Authorization", value: "Bearer integration-only" } },
  ];
  await writeFile(join(temporary, "credentials.json"), JSON.stringify(credentials));
  for (const file of ["campaign-strategist.v1.json", "content-producer.v1.json"]) {
    const workflow = JSON.parse(await readFile(join(root, "n8n", "workflows", "phase3", file), "utf8"));
    const http = workflow.nodes.find((entry) => entry.name === "Call Gemma");
    http.parameters.url = `http://127.0.0.1:${gemmaPort}/v1/chat/completions`;
    await writeFile(join(temporary, file), JSON.stringify(workflow));
  }
  await chmod(temporary, 0o755);
  await Promise.all(["credentials.json", "campaign-strategist.v1.json", "content-producer.v1.json"]
    .map((file) => chmod(join(temporary, file), 0o644)));

  await run("docker", ["volume", "create", volume]);
  const dockerBase = ["run", "--rm", "--network", "host", "-e", "N8N_ENCRYPTION_KEY=integration-only-encryption-key-32", "-e", "N8N_USER_MANAGEMENT_DISABLED=true", "-e", "N8N_DIAGNOSTICS_ENABLED=false", "-e", "N8N_SSRF_PROTECTION_ENABLED=false", "-v", `${volume}:/home/node/.n8n`, "-v", `${temporary}:/fixtures:ro`, image];
  await run("docker", [...dockerBase, "import:credentials", "--input=/fixtures/credentials.json"]);

  const campaignId = "20000000-0000-4000-8000-000000000001";
  await pool.query(`INSERT INTO tanaghom.agent_jobs (id, correlation_id, agent_id, campaign_id, job_type, input) VALUES ('70000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',$1,'campaign.strategy.generate',$2::jsonb)`, [campaignId, JSON.stringify({ contract_version: "phase3.strategist-job.v1", job_id: "70000000-0000-4000-8000-000000000001", correlation_id: "71000000-0000-4000-8000-000000000001", campaign: { id: campaignId, name: "Staging Summer Camp", brief: "Integration-only offer brief", product_type: "camp", target_audience: { geographies: ["test"], description: "test adults" }, budget_target: 0, revenue_target: 0, currency: "USD" } })]);
  await run("docker", [...dockerBase, "execute", "--file=/fixtures/campaign-strategist.v1.json", "--rawOutput"]);
  assert.equal((await pool.query("SELECT status FROM tanaghom.agent_jobs WHERE id='70000000-0000-4000-8000-000000000001'")).rows[0].status, "succeeded");

  const strategy = (await pool.query("SELECT * FROM tanaghom.campaign_strategies WHERE campaign_id=$1 ORDER BY version DESC LIMIT 1", [campaignId])).rows[0];
  const contentInput = { contract_version: "phase3.content-producer-job.v1", job_id: "70000000-0000-4000-8000-000000000002", correlation_id: "71000000-0000-4000-8000-000000000002", campaign: { id: campaignId, name: "Staging Summer Camp", brief: "Integration-only offer brief", product_type: "camp", target_audience: { geographies: ["test"] } }, strategy: { id: strategy.id, version: strategy.version, positioning: strategy.positioning, key_messages: strategy.key_messages, channels: strategy.channels, posting_cadence: strategy.posting_cadence, content_pillars: strategy.content_pillars }, max_items: 1 };
  await pool.query(`INSERT INTO tanaghom.agent_jobs (id, correlation_id, agent_id, campaign_id, job_type, input) VALUES ('70000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',$1,'campaign.content.generate',$2::jsonb)`, [campaignId, JSON.stringify(contentInput)]);
  await run("docker", [...dockerBase, "execute", "--file=/fixtures/content-producer.v1.json", "--rawOutput"]);
  assert.equal((await pool.query("SELECT status FROM tanaghom.agent_jobs WHERE id='70000000-0000-4000-8000-000000000002'")).rows[0].status, "waiting_approval");
  assert.equal((await pool.query("SELECT count(*)::int count FROM tanaghom.content_items WHERE draft_copy='Integration-only draft' AND status='pending_approval'")).rows[0].count, 1);

  responseMode = "invalid";
  await pool.query(`INSERT INTO tanaghom.agent_jobs (id, correlation_id, agent_id, campaign_id, job_type, input) VALUES ('70000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',$1,'campaign.strategy.generate','{}')`, [campaignId]);
  await run("docker", [...dockerBase, "execute", "--file=/fixtures/campaign-strategist.v1.json", "--rawOutput"]);
  const failed = (await pool.query("SELECT status,attempt,error_code FROM tanaghom.agent_jobs WHERE id='70000000-0000-4000-8000-000000000003'")).rows[0];
  assert.deepEqual(failed, { status: "queued", attempt: 1, error_code: "gemma_invalid_json" });
  console.log("PASS: pinned n8n executed Strategist, Content Producer, and retry paths.");
} finally {
  server.close();
  await pool.end();
  await run("docker", ["volume", "rm", "-f", volume]).catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
