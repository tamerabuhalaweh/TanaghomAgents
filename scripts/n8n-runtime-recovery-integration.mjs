import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = process.cwd();
const composeFile = join(root, "deployment", "phase5f-runtime-recovery", "docker-compose.yml");
const evidencePath = process.env.N8N_RUNTIME_RECOVERY_EVIDENCE_PATH || "tmp/n8n-runtime-recovery-evidence.json";
const project = `tanaghom-p5f-runtime-${process.pid}`;
const temporary = await mkdtemp(join(tmpdir(), "tanaghom-n8n-runtime-"));
const secretDirectory = join(temporary, "secrets");
const postgresPassword = randomBytes(24).toString("hex");
const redisPassword = randomBytes(24).toString("hex");
const encryptionKey = randomBytes(36).toString("hex");
const workflowId = "phase5RuntimeRecoveryProbeV1";
const mainUrl = "http://127.0.0.1:5678";
const workerUrl = "http://127.0.0.1:5680";
const alertPort = 14333;
const alertUrl = `http://127.0.0.1:${alertPort}/alerts`;
const alertFile = "/tmp/tanaghom-runtime-alerts.ndjson";
const composeEnv = { ...process.env, TANAGHOM_RUNTIME_SECRET_DIR: secretDirectory };
const workerExecutions = 6;
const redisExecutions = 8;
let composeStarted = false;

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

function composeAllowed(allowedExitCodes, ...args) {
  return run("docker", ["compose", "-p", project, "-f", composeFile, ...args], {
    env: composeEnv,
    allowedExitCodes,
  });
}

function compose(...args) {
  return composeAllowed([0], ...args);
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

async function httpOk(service, url) {
  try {
    const result = await compose("exec", "-T", service, "node", "-e",
      `fetch('${url}',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`);
    return result.code === 0;
  } catch {
    return false;
  }
}

function ready(service, baseUrl) {
  return httpOk(service, `${baseUrl}/healthz/readiness`);
}

async function waitReady(name, service, baseUrl) {
  await waitFor(`${name} readiness`, () => ready(service, baseUrl), 120_000, 1000);
}

async function executions() {
  const result = await compose("exec", "-T", "postgres", "psql", "-U", "n8n", "-d", "n8n",
    "-At", "-F", "\t", "-c",
    `SELECT id::text,status FROM execution_entity WHERE "workflowId"='${workflowId}' ORDER BY id::bigint`);
  return result.stdout.trim()
    ? result.stdout.trim().split(/\r?\n/).map((line) => {
      const [id, status] = line.split("\t");
      return { id, status };
    })
    : [];
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
    const body = JSON.stringify({ correlation_id: `${prefix}-${index}`, delay_ms: delayMs });
    const result = await compose("exec", "-T", "n8n", "node", "-e",
      `fetch('${mainUrl}/webhook/tanaghom-runtime-recovery',{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(body)},signal:AbortSignal.timeout(10000)}).then(r=>{if(!r.ok)throw new Error(String(r.status));process.stdout.write(String(r.status))})`);
    assert.equal(result.stdout.trim(), "200", `webhook ${prefix}-${index} was not accepted`);
    return Number(result.stdout.trim());
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
  const result = await composeAllowed(alert ? [2] : [0], "exec", "-T", "n8n", "env",
    `TANAGHOM_N8N_MAIN_URL=${mainUrl}`,
    "TANAGHOM_N8N_WORKER_URL=http://n8n-worker:5680",
    ...(alert ? [`TANAGHOM_RUNTIME_ALERT_URL=${alertUrl}`] : []),
    "node", "/runtime-scripts/runtime-monitor.mjs");
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

try {
  await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
  await Promise.all([
    // Compose bind-mounts local secret files without remapping their host owner.
    // The directory stays private; 0644 lets the non-root n8n UID read the mounted files.
    writeFile(join(secretDirectory, "postgres_password"), postgresPassword, { mode: 0o644 }),
    writeFile(join(secretDirectory, "redis_password"), redisPassword, { mode: 0o644 }),
    writeFile(join(secretDirectory, "n8n_encryption_key"), encryptionKey, { mode: 0o644 }),
  ]);

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
  await Promise.all([
    waitReady("n8n main", "n8n", mainUrl),
    waitReady("n8n worker", "n8n-worker", workerUrl),
  ]);
  await compose("exec", "-d", "n8n", "env",
    `TANAGHOM_ALERT_SINK_PORT=${alertPort}`,
    `TANAGHOM_ALERT_SINK_FILE=${alertFile}`,
    "node", "/runtime-scripts/alert-sink.mjs");
  await waitFor("local alert sink", () => httpOk("n8n", `http://127.0.0.1:${alertPort}/healthz`), 30_000, 500);

  assert.equal((await executions()).length, 0);
  const mainMetrics = (await compose("exec", "-T", "n8n", "node", "-e",
    `fetch('${mainUrl}/metrics').then(r=>r.text()).then(t=>process.stdout.write(t))`)).stdout;
  const workerMetrics = (await compose("exec", "-T", "n8n-worker", "node", "-e",
    `fetch('${workerUrl}/metrics').then(r=>r.text()).then(t=>process.stdout.write(t))`)).stdout;
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
  await waitFor("worker becomes unready", async () => !(await ready("n8n-worker", workerUrl)), 30_000, 250);
  const degradedObservation = await monitor(true);
  assert.equal(degradedObservation.state, "degraded");
  assert.equal(degradedObservation.alert_delivery.code, "n8n_worker_unready");
  const alertOutput = await compose("exec", "-T", "n8n", "node", "-e",
    `process.stdout.write(require('node:fs').readFileSync('${alertFile}','utf8'))`);
  const deliveredAlerts = alertOutput.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(deliveredAlerts.length, 1);
  assert.equal(deliveredAlerts[0].code, "n8n_worker_unready");
  await compose("up", "-d", "n8n-worker");
  await waitReady("restarted n8n worker", "n8n-worker", workerUrl);
  const workerFinal = await waitAllSucceeded(workerExecutions);
  const workerElapsedMs = performance.now() - workerStartedAt;
  assert.deepEqual(workerFinal.map((entry) => entry.id).sort(), workerIds);
  const healthyObservation = await monitor(false);
  assert.equal(healthyObservation.state, "healthy");

  await compose("stop", "-t", "5", "n8n-worker");
  await waitFor("worker stopped", async () => !(await ready("n8n-worker", workerUrl)), 30_000, 250);
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
  assert.equal(await ready("n8n", mainUrl), true);
  await compose("up", "-d", "n8n-worker");
  await waitReady("worker after Redis restart", "n8n-worker", workerUrl);
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
} catch (error) {
  console.error(error.stack || error.message);
  if (composeStarted) {
    const status = await compose("ps", "-a").catch((diagnosticError) => ({ stdout: "", stderr: diagnosticError.message }));
    const logs = await compose("logs", "--no-color", "--tail", "200", "postgres", "redis", "n8n", "n8n-worker")
      .catch((diagnosticError) => ({ stdout: "", stderr: diagnosticError.message }));
    console.error("--- disposable compose status ---\n", status.stdout, status.stderr);
    console.error("--- disposable service logs ---\n", logs.stdout, logs.stderr);
  }
  throw error;
} finally {
  if (composeStarted) {
    await compose("down", "--volumes", "--remove-orphans", "--timeout", "5").catch(async (error) => {
      console.error(error.message);
      await compose("kill").catch(() => undefined);
      await compose("down", "--volumes", "--remove-orphans", "--timeout", "1").catch(() => undefined);
    });
  }
  await rm(temporary, { recursive: true, force: true });
}
