import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import pg from "pg";

const root = process.cwd();
const composeFile = join(root, "deployment", "phase5f-runtime-recovery", "docker-compose.yml");
const monitorScript = join(root, "deployment", "phase5f-runtime-recovery", "scripts", "runtime-monitor.mjs");
const evidencePath = process.env.N8N_RUNTIME_RECOVERY_EVIDENCE_PATH || "tmp/n8n-runtime-recovery-evidence.json";
const project = `tanaghom-p5f-runtime-${process.pid}`;
const temporary = await mkdtemp(join(tmpdir(), "tanaghom-n8n-runtime-"));
const secretDirectory = join(temporary, "secrets");
const postgresPassword = randomBytes(24).toString("hex");
const redisPassword = randomBytes(24).toString("hex");
const encryptionKey = randomBytes(36).toString("hex");
const workflowId = "phase5RuntimeRecoveryProbeV1";
const mainUrl = "http://127.0.0.1:15678";
const workerUrl = "http://127.0.0.1:15680";
const alertPort = 14333;
const alertUrl = `http://127.0.0.1:${alertPort}/alerts`;
const composeEnv = { ...process.env, TANAGHOM_RUNTIME_SECRET_DIR: secretDirectory };
const workerExecutions = 6;
const redisExecutions = 8;
let pool;
let composeStarted = false;
let alertServer;
const deliveredAlerts = [];

function run(command, args, options = {}) {
  const allowed = options.allowedExitCodes || [0];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (allowed.includes(code)) resolve({ code, stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stdout}\n${stderr}`));
    });
  });
}

function compose(...args) {
  return run("docker", ["compose", "-p", project, "-f", composeFile, ...args], { env: composeEnv });
}

async function waitFor(label, predicate, timeoutMs = 120_000, intervalMs = 500) {
  const startedAt = performance.now();
  let lastError;
  while (performance.now() - startedAt < timeoutMs) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

async function ready(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/healthz/readiness`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitReady(name, baseUrl) {
  await waitFor(`${name} readiness`, () => ready(baseUrl), 120_000, 1000);
}

async function executions() {
  const result = await pool.query(
    `SELECT id::text AS id,status FROM execution_entity
      WHERE "workflowId"=$1 ORDER BY id::bigint`, [workflowId],
  );
  return result.rows;
}

async function waitExecutionCount(count) {
  return waitFor(`execution count ${count}`, async () => {
    const rows = await executions();
    return rows.length === count ? rows : undefined;
  });
}

async function waitAllSucceeded(count) {
  return waitFor(`${count} successful executions`, async () => {
    const rows = await executions();
    return rows.length === count && rows.every((entry) => entry.status === "success") ? rows : undefined;
  }, 180_000, 1000);
}

async function sendBatch(prefix, count, delayMs) {
  const responses = await Promise.all(Array.from({ length: count }, async (_, index) => {
    const response = await fetch(`${mainUrl}/webhook/tanaghom-runtime-recovery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ correlation_id: `${prefix}-${index}`, delay_ms: delayMs }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.ok, true, `webhook ${prefix}-${index} returned ${response.status}`);
    return response.status;
  }));
  assert.equal(responses.length, count);
}

async function redisNumber(command) {
  const result = await compose("exec", "-T", "redis", "sh", "-ec",
    `REDISCLI_AUTH=\"$(cat /run/secrets/redis_password)\" redis-cli ${command}`);
  const value = Number(result.stdout.trim());
  assert.ok(Number.isInteger(value));
  return value;
}

async function monitor(alert = false) {
  const result = await run(process.execPath, [monitorScript], {
    allowedExitCodes: alert ? [2] : [0],
    env: {
      ...process.env,
      TANAGHOM_N8N_MAIN_URL: mainUrl,
      TANAGHOM_N8N_WORKER_URL: workerUrl,
      ...(alert ? { TANAGHOM_RUNTIME_ALERT_URL: alertUrl } : {}),
    },
  });
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

try {
  await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
  await Promise.all([
    writeFile(join(secretDirectory, "postgres_password"), postgresPassword, { mode: 0o600 }),
    writeFile(join(secretDirectory, "redis_password"), redisPassword, { mode: 0o600 }),
    writeFile(join(secretDirectory, "n8n_encryption_key"), encryptionKey, { mode: 0o600 }),
  ]);

  alertServer = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/alerts") {
      response.writeHead(404).end(); return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    deliveredAlerts.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(204).end();
  });
  alertServer.listen(alertPort, "127.0.0.1");
  await once(alertServer, "listening");

  await compose("config", "--quiet");
  await compose("pull", "postgres", "redis", "n8n", "n8n-worker");
  composeStarted = true;
  await compose("up", "-d", "postgres", "redis");
  await waitFor("PostgreSQL health", async () => (await compose("exec", "-T", "postgres", "pg_isready", "-U", "n8n", "-d", "n8n")).stdout.includes("accepting connections"));
  await waitFor("Redis health", async () => {
    try {
      const result = await compose("exec", "-T", "redis", "sh", "-ec",
        "REDISCLI_AUTH=\"$(cat /run/secrets/redis_password)\" redis-cli PING");
      return result.stdout.trim() === "PONG";
    } catch { return false; }
  });

  await compose("run", "--rm", "--no-deps", "n8n", "import:workflow", "--input=/fixtures/runtime-recovery-probe.v1.json");
  await compose("run", "--rm", "--no-deps", "n8n", "publish:workflow", `--id=${workflowId}`);
  await compose("up", "-d", "n8n", "n8n-worker");
  await Promise.all([waitReady("n8n main", mainUrl), waitReady("n8n worker", workerUrl)]);

  pool = new pg.Pool({ connectionString: `postgresql://n8n:${postgresPassword}@127.0.0.1:15432/n8n`, max: 3 });
  assert.equal((await executions()).length, 0);
  const mainMetrics = await (await fetch(`${mainUrl}/metrics`)).text();
  const workerMetrics = await (await fetch(`${workerUrl}/metrics`)).text();
  assert.match(mainMetrics, /# (HELP|TYPE)/);
  assert.match(workerMetrics, /# (HELP|TYPE)/);

  const workerStartedAt = performance.now();
  await sendBatch("worker-restart", workerExecutions, 10_000);
  const beforeKill = await waitFor("running worker execution", async () => {
    const rows = await waitExecutionCount(workerExecutions);
    return rows.some((entry) => entry.status === "running") ? rows : undefined;
  });
  const workerIds = beforeKill.map((entry) => entry.id).sort();
  const runningBeforeKill = beforeKill.filter((entry) => entry.status === "running").length;
  await compose("kill", "-s", "KILL", "n8n-worker");
  await waitFor("worker becomes unready", async () => !(await ready(workerUrl)), 30_000, 250);
  const degradedObservation = await monitor(true);
  assert.equal(degradedObservation.state, "degraded");
  assert.equal(degradedObservation.alert_delivery.code, "n8n_worker_unready");
  assert.equal(deliveredAlerts.length, 1);
  assert.equal(deliveredAlerts[0].code, "n8n_worker_unready");
  await compose("up", "-d", "n8n-worker");
  await waitReady("restarted n8n worker", workerUrl);
  const workerFinal = await waitAllSucceeded(workerExecutions);
  const workerElapsedMs = performance.now() - workerStartedAt;
  assert.deepEqual(workerFinal.map((entry) => entry.id).sort(), workerIds);
  const healthyObservation = await monitor(false);
  assert.equal(healthyObservation.state, "healthy");

  await compose("stop", "-t", "5", "n8n-worker");
  await waitFor("worker stopped", async () => !(await ready(workerUrl)), 30_000, 250);
  const redisStartedAt = performance.now();
  await sendBatch("redis-restart", redisExecutions, 1000);
  const allQueued = await waitExecutionCount(workerExecutions + redisExecutions);
  const queuedBeforeRestart = allQueued.filter((entry) => entry.status !== "success").length;
  assert.equal(queuedBeforeRestart, redisExecutions);
  const queueKeysBeforeRestart = await redisNumber("DBSIZE");
  assert.ok(queueKeysBeforeRestart > 0);
  const persistence = await compose("exec", "-T", "redis", "sh", "-ec",
    "REDISCLI_AUTH=\"$(cat /run/secrets/redis_password)\" redis-cli INFO persistence");
  assert.match(persistence.stdout, /aof_enabled:1/);
  await compose("stop", "-t", "5", "redis");
  await compose("start", "redis");
  await waitFor("restarted Redis health", async () => {
    try {
      const result = await compose("exec", "-T", "redis", "sh", "-ec",
        "REDISCLI_AUTH=\"$(cat /run/secrets/redis_password)\" redis-cli PING");
      return result.stdout.trim() === "PONG";
    } catch { return false; }
  }, 60_000, 1000);
  const queueKeysAfterRestart = await redisNumber("DBSIZE");
  assert.ok(queueKeysAfterRestart > 0);
  assert.equal(await ready(mainUrl), true);
  await compose("up", "-d", "n8n-worker");
  await waitReady("worker after Redis restart", workerUrl);
  const finalRows = await waitAllSucceeded(workerExecutions + redisExecutions);
  const redisElapsedMs = performance.now() - redisStartedAt;

  const statusCounts = finalRows.reduce((counts, entry) => {
    counts[entry.status] = (counts[entry.status] || 0) + 1;
    return counts;
  }, {});
  const evidence = {
    contract_version: "phase5.n8n-runtime-recovery-evidence.v1",
    generated_at: new Date().toISOString(),
    boundaries: {
      disposable_compose: true,
      synthetic_executions: true,
      customer_credentials_used: false,
      provider_calls: 0,
      gemma_calls: 0,
      production_touched: false,
      smartlabs_touched: false,
    },
    runtime: {
      n8n_version: "2.26.8",
      postgres_version: "16.14",
      redis_version: "7.2.14",
      queue_mode: true,
      worker_concurrency: 2,
      network_internal: true,
      images_immutable: true,
    },
    worker_restart: {
      accepted: workerExecutions,
      running_before_kill: runningBeforeKill,
      signal: "SIGKILL",
      worker_became_unready: true,
      same_execution_ids_preserved: true,
      succeeded: workerFinal.length,
      failed: 0,
      elapsed_ms: Number(workerElapsedMs.toFixed(2)),
    },
    redis_restart: {
      accepted_while_worker_stopped: redisExecutions,
      queued_before_restart: queuedBeforeRestart,
      aof_enabled: true,
      queue_keys_before_restart: queueKeysBeforeRestart,
      queue_keys_after_restart: queueKeysAfterRestart,
      main_remained_available: true,
      succeeded: redisExecutions,
      failed: 0,
      elapsed_ms: Number(redisElapsedMs.toFixed(2)),
    },
    monitoring: {
      main_readiness: true,
      worker_readiness: true,
      main_metrics: true,
      worker_metrics: true,
      degraded_alert_code: "n8n_worker_unready",
      degraded_alert_delivered: true,
      healthy_after_recovery: true,
      production_destination_configured: false,
    },
    outcomes: {
      accepted: workerExecutions + redisExecutions,
      succeeded: statusCounts.success || 0,
      failed: statusCounts.error || 0,
      crashed: statusCounts.crashed || 0,
      unfinished: finalRows.filter((entry) => entry.status !== "success").length,
      unique_execution_ids: new Set(finalRows.map((entry) => entry.id)).size,
    },
  };
  const schema = JSON.parse(await readFile(
    new URL("../packages/contracts/schemas/phase5/n8n-runtime-recovery-evidence.v1.schema.json", import.meta.url), "utf8",
  ));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(evidence, null, 2));
  console.log("PASS: pinned n8n queue worker, Redis AOF restart, readiness, metrics, and local alert delivery recovery verified.");
} finally {
  await pool?.end().catch(() => undefined);
  await new Promise((resolve) => alertServer?.close(resolve) ?? resolve());
  if (composeStarted) {
    await compose("down", "--volumes", "--remove-orphans", "--timeout", "5").catch(async (error) => {
      console.error(error.message);
      await compose("kill").catch(() => undefined);
      await compose("down", "--volumes", "--remove-orphans", "--timeout", "1").catch(() => undefined);
    });
  }
  await rm(temporary, { recursive: true, force: true });
}
