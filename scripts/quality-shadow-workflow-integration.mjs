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
const temporary = await mkdtemp(join(tmpdir(), "tanaghom-quality-shadow-"));
const volume = `tanaghom-quality-shadow-${process.pid}`;
const port = 43205;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] }); let output = "";
    child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", reject); child.on("close", code => code === 0 ? resolve(output) : reject(new Error(`${command} failed (${code})\n${output}`)));
  });
}

const server = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.match(body.messages[0].content, /Never send a message/);
  const job = JSON.parse(body.messages[1].content); assert.equal(job.external_actions_allowed, false);
  const result = { contract_version: "phase5g.quality-shadow-result.v1", prompt_version: job.versions.prompt,
    model_name: job.versions.model, proposed_reply: "Offline proposal only", scores: { groundedness_pass: true,
      policy_compliance_pass: true, qualification_match: true, unsupported_claim: false }, escalation_required: false,
    predicted_qualified: true, latency_seconds: 0, external_action_count: 0 };
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
});

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
try {
  server.listen(port, "0.0.0.0"); await once(server, "listening");
  await pool.query("ALTER ROLE tanaghom_n8n_worker LOGIN PASSWORD 'integration-only'");
  const owner = (await pool.query("SELECT id FROM tanaghom.app_users WHERE role='owner' AND kind='human' LIMIT 1")).rows[0].id;
  const formulas = { response_time: "average", coverage: "reviewed reply", groundedness: "review score", policy_compliance: "review score", qualification_accuracy: "review match", qualification: "label", booking: "label", won: "label", unsupported_claim: "review score", complaint: "label", opt_out: "label" };
  const thresholds = { minimum_sample_size: 10, minimum_groundedness_percent: 90, minimum_policy_compliance_percent: 95, minimum_qualification_accuracy_percent: 85, maximum_unsupported_claim_percent: 1, maximum_complaint_percent: 1, maximum_opt_out_percent: 5 };
  const program = (await pool.query("SELECT tanaghom.create_quality_metric_program($1,$2::jsonb,$3::jsonb,$4) id", [owner, formulas, thresholds, "Integration-only formulas"])).rows[0].id;
  await pool.query("SELECT tanaghom.approve_quality_metric_program($1,$2)", [owner, program]);
  const versions = { model: "gemma-test", prompt: "quality-shadow-evaluator/v1", knowledge: "test-v1", policy: "manual-v1", campaign: "test-v1" };
  const cases = Array.from({ length: 10 }, (_, index) => ({ reference_hash: `sha256:${(index + 1).toString(16).padStart(64, "0")}`, language: "en", customer_message: `What options are available? Case ${index + 1}`, human_reply: "Reviewed human answer", response_seconds: 65 + index, qualified: true, booked: false, won: false, handed_off: false, opted_out: false, complaint: false, reviewed: true }));
  const dataset = (await pool.query("SELECT tanaghom.import_quality_baseline_dataset($1,$2,$3,now()-interval '1 day',now(),$4::jsonb,$5::jsonb,true) id", [owner, "Integration baseline", `sha256:${"b".repeat(64)}`, versions, JSON.stringify(cases)])).rows[0].id;
  await pool.query("SELECT tanaghom.record_quality_dataset_snapshot($1,$2,'human_baseline',$3,$4)", [owner, dataset, "Integration-only", "quality-shadow-workflow-integration"]);
  await pool.query("SELECT tanaghom.set_quality_rollout_stage($1,'shadow',$2,gen_random_uuid())", [owner, "Integration-only shadow stage"]);
  await pool.query("SELECT tanaghom.queue_quality_shadow_run($1,$2,$3::jsonb)", [owner, dataset, versions]);

  const credentials = [
    { id: "62000000-0000-4000-8000-000000000001", name: "Tanaghom Worker PostgreSQL", type: "postgres", data: { host: "127.0.0.1", database: new URL(databaseUrl).pathname.slice(1), user: "tanaghom_n8n_worker", password: "integration-only", port: Number(new URL(databaseUrl).port || 5432), ssl: "disable" } },
    { id: "62000000-0000-4000-8000-000000000002", name: "Tanaghom Gemma API", type: "httpHeaderAuth", data: { name: "Authorization", value: "Bearer integration-only" } },
  ];
  await writeFile(join(temporary, "credentials.json"), JSON.stringify(credentials));
  const workflow = JSON.parse(await readFile(join(process.cwd(), "n8n", "workflows", "phase5g", "quality-shadow-evaluator.v1.json"), "utf8"));
  workflow.nodes.find(node => node.name === "Call Gemma").parameters.url = `http://host.docker.internal:${port}/v1/chat/completions`;
  await writeFile(join(temporary, "workflow.json"), JSON.stringify(workflow)); await chmod(temporary, 0o755);
  await Promise.all(["credentials.json", "workflow.json"].map(file => chmod(join(temporary, file), 0o644)));
  await run("docker", ["volume", "create", volume]);
  const docker = ["run", "--rm", "--network", "host", "-e", "N8N_ENCRYPTION_KEY=integration-only-encryption-key-32", "-e", "N8N_USER_MANAGEMENT_DISABLED=true", "-e", "N8N_DIAGNOSTICS_ENABLED=false", "-e", "N8N_SSRF_PROTECTION_ENABLED=false", "-v", `${volume}:/home/node/.n8n`, "-v", `${temporary}:/fixtures:ro`, image];
  await run("docker", [...docker, "import:credentials", "--input=/fixtures/credentials.json"]);
  await run("docker", [...docker, "import:workflow", "--input=/fixtures/workflow.json"]);
  const execution = await run("docker", [...docker, "execute", "--id=phase5gQualityShadowEvaluatorV1", "--rawOutput"]);
  const result = (await pool.query("SELECT result.proposed_reply,result.external_action_count,job.status FROM tanaghom.quality_shadow_results result JOIN tanaghom.quality_shadow_jobs job ON job.id=result.job_id WHERE result.dataset_id=$1", [dataset])).rows[0];
  assert.deepEqual(result, { proposed_reply: "Offline proposal only", external_action_count: 0, status: "succeeded" }, execution.slice(-4000));
  assert.equal(workflow.active, false); assert.equal(workflow.nodes.find(node => node.type.includes("scheduleTrigger")).disabled, true);
  console.log("PASS: pinned n8n generated proposal-only evidence through simulated Gemma; no external action occurred.");
} finally {
  server.close(); await pool.end(); await run("docker", ["volume", "rm", "-f", volume]).catch(() => {}); await rm(temporary, { recursive: true, force: true });
}
