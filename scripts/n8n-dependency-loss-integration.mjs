import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = process.cwd();
const baseCompose = join(root, "deployment", "phase5f-runtime-recovery", "docker-compose.yml");
const lossCompose = join(root, "deployment", "phase5f-dependency-loss", "docker-compose.yml");
const evidencePath = process.env.N8N_DEPENDENCY_LOSS_EVIDENCE_PATH || "tmp/n8n-dependency-loss-evidence.json";
const project = `tanaghom-p5f-loss-${process.pid}`;
const temporary = await mkdtemp(join(tmpdir(), "tanaghom-n8n-loss-"));
const secretDirectory = join(temporary, "secrets");
const postgresPassword = randomBytes(24).toString("hex");
const redisPassword = randomBytes(24).toString("hex");
const encryptionKey = randomBytes(36).toString("hex");
const workflowId = "phase5RuntimeRecoveryProbeV1";
const mainUrl = "http://127.0.0.1:5678";
const observerUrl = "http://127.0.0.1:14334";
const redisExecutions = Number(process.env.N8N_DEPENDENCY_REDIS_EXECUTIONS || 20);
const postgresExecutions = Number(process.env.N8N_DEPENDENCY_POSTGRES_EXECUTIONS || 20);
const composeEnv = { ...process.env, TANAGHOM_RUNTIME_SECRET_DIR: secretDirectory };
let composeStarted = false;

assert.ok(redisExecutions >= 5);
assert.ok(postgresExecutions >= 5);

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
  return run("docker", ["compose", "-p", project, "-f", baseCompose, "-f", lossCompose, ...args], { env: composeEnv });
}

async function waitFor(label, predicate, timeoutMs = 180_000, intervalMs = 1000) {
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

async function observerFetch(path, method = "GET") {
  const result = await compose("exec", "-T", "dependency-observer", "node", "-e",
    `fetch('${observerUrl}${path}',{method:'${method}',signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)throw new Error(String(r.status));process.stdout.write(await r.text())})`);
  return result.stdout.trim();
}

async function observation() {
  return JSON.parse(await observerFetch("/observe", "POST"));
}

async function waitObservation(code, timeoutMs = 60_000) {
  return waitFor(`dependency observation ${code}`, async () => {
    const result = await observation();
    return result.code === code ? result : undefined;
  }, timeoutMs, 500);
}

async function waitReady(service, port) {
  await waitFor(`${service} readiness`, async () => {
    try {
      const result = await compose("exec", "-T", service, "node", "-e",
        `fetch('http://127.0.0.1:${port}/healthz/readiness',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`);
      return result.code === 0;
    } catch {
      return false;
    }
  });
}

async function psql(sql) {
  const result = await compose("exec", "-T", "postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1",
    "-U", "n8n", "-d", "n8n", "-At", "-F", "\t", "-c", sql);
  return result.stdout.trim();
}

async function executionRows() {
  const output = await psql(`SELECT id::text,status FROM execution_entity WHERE "workflowId"='${workflowId}' ORDER BY id::bigint`);
  return output ? output.split(/\r?\n/).map((line) => {
    const [id, status] = line.split("\t");
    return { id, status };
  }) : [];
}

async function waitExecutionCount(count) {
  return waitFor(`execution count ${count}`, async () => {
    const rows = await executionRows();
    return rows.length === count ? rows : undefined;
  });
}

async function waitSuccessCount(count) {
  return waitFor(`${count} successful executions`, async () => {
    const rows = await executionRows();
    return rows.length === count && rows.every((row) => row.status === "success") ? rows : undefined;
  }, 240_000, 1000);
}

async function sendBatch(prefix, count) {
  const submissionConcurrency = 5;
  for (let offset = 0; offset < count; offset += submissionConcurrency) {
    const size = Math.min(submissionConcurrency, count - offset);
    await Promise.all(Array.from({ length: size }, async (_, index) => {
      const body = JSON.stringify({ correlation_id: `${prefix}-${offset + index}`, delay_ms: 100 });
      const result = await compose("exec", "-T", "dependency-observer", "node", "-e",
        `fetch('http://n8n:5678/webhook/tanaghom-runtime-recovery',{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(body)},signal:AbortSignal.timeout(10000)}).then(r=>{if(!r.ok)throw new Error(String(r.status));process.stdout.write(String(r.status))})`);
      assert.equal(result.stdout.trim(), "200");
    }));
  }
}

async function redisNumber(command) {
  const result = await compose("exec", "-T", "redis", "sh", "-ec",
    `REDISCLI_AUTH="$(cat /run/secrets/redis_password)" redis-cli ${command}`);
  const value = Number(result.stdout.trim());
  assert.ok(Number.isInteger(value));
  return value;
}

async function correlationCounts(prefix) {
  const output = await psql(`
    SELECT match[1],count(*)
    FROM execution_data d
    JOIN execution_entity e ON e.id=d."executionId"
    CROSS JOIN LATERAL regexp_match(d.data,'(${prefix}-[0-9]+)') AS match
    WHERE e."workflowId"='${workflowId}' AND e.status='success' AND match[1] IS NOT NULL
    GROUP BY match[1]
    ORDER BY match[1]`);
  return new Map(output ? output.split(/\r?\n/).map((line) => {
    const [correlation, count] = line.split("\t");
    return [correlation, Number(count)];
  }) : []);
}

function assertCorrelations(prefix, count, actual) {
  assert.equal(actual.size, count, `${prefix} correlations: ${JSON.stringify([...actual])}`);
  for (let index = 0; index < count; index += 1) {
    assert.equal(actual.get(`${prefix}-${index}`), 1, `${prefix}-${index} did not complete exactly once`);
  }
}

async function killExitCode(service) {
  const id = (await compose("ps", "-q", "--all", service)).stdout.trim();
  assert.ok(id);
  const result = await run("docker", ["inspect", "--format", "{{.State.ExitCode}}", id]);
  return Number(result.stdout.trim());
}

async function waitPostgres() {
  await waitFor("PostgreSQL recovery", async () => {
    try {
      return (await compose("exec", "-T", "postgres", "pg_isready", "-U", "n8n", "-d", "n8n")).stdout.includes("accepting connections");
    } catch {
      return false;
    }
  }, 90_000, 500);
}

async function waitRedis() {
  await waitFor("Redis recovery", async () => {
    try {
      return (await compose("exec", "-T", "redis", "sh", "-ec",
        "REDISCLI_AUTH=\"$(cat /run/secrets/redis_password)\" redis-cli PING")).stdout.trim() === "PONG";
    } catch {
      return false;
    }
  }, 90_000, 500);
}

try {
  await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
  await Promise.all([
    writeFile(join(secretDirectory, "postgres_password"), postgresPassword, { mode: 0o644 }),
    writeFile(join(secretDirectory, "redis_password"), redisPassword, { mode: 0o644 }),
    writeFile(join(secretDirectory, "n8n_encryption_key"), encryptionKey, { mode: 0o644 }),
  ]);

  await compose("config", "--quiet");
  await compose("pull", "postgres", "redis", "n8n", "n8n-worker", "dependency-observer");
  composeStarted = true;
  await compose("up", "-d", "postgres", "redis", "dependency-observer");
  await Promise.all([waitPostgres(), waitRedis()]);
  await waitFor("observer health", async () => (await observerFetch("/healthz")) === '{"status":"ok"}');
  await compose("run", "--rm", "--no-deps", "n8n", "import:workflow", "--input=/fixtures/runtime-recovery-probe.v1.json");
  await compose("run", "--rm", "--no-deps", "n8n", "publish:workflow", `--id=${workflowId}`);
  await compose("up", "-d", "n8n");
  await waitReady("n8n", 5678);
  assert.equal((await observation()).code, "healthy");

  const redisConfig = (await compose("exec", "-T", "redis", "sh", "-ec",
    "REDISCLI_AUTH=\"$(cat /run/secrets/redis_password)\" redis-cli CONFIG GET appendonly appendfsync maxmemory-policy")).stdout;
  assert.match(redisConfig, /appendonly\r?\nyes/);
  assert.match(redisConfig, /appendfsync\r?\nalways/);
  assert.match(redisConfig, /maxmemory-policy\r?\nnoeviction/);

  await sendBatch("redis-loss", redisExecutions);
  await waitExecutionCount(redisExecutions);
  const redisKeysBeforeKill = await redisNumber("DBSIZE");
  const redisPersistenceBefore = (await compose("exec", "-T", "redis", "sh", "-ec",
    "REDISCLI_AUTH=\"$(cat /run/secrets/redis_password)\" redis-cli INFO persistence")).stdout;
  assert.match(redisPersistenceBefore, /aof_enabled:1/);
  const redisLossStartedAt = performance.now();
  await compose("kill", "-s", "KILL", "redis");
  await waitFor("Redis SIGKILL exit", async () => (await killExitCode("redis")) === 137, 30_000, 250);
  const redisDegraded = await waitObservation("redis_unavailable");
  assert.equal(redisDegraded.redis_ping, false);
  await compose("start", "redis");
  await waitRedis();
  const redisKeysAfterRestart = await redisNumber("DBSIZE");
  assert.equal(redisKeysAfterRestart, redisKeysBeforeKill);
  const redisPersistenceAfter = (await compose("exec", "-T", "redis", "sh", "-ec",
    "REDISCLI_AUTH=\"$(cat /run/secrets/redis_password)\" redis-cli INFO persistence")).stdout;
  assert.match(redisPersistenceAfter, /aof_enabled:1/);
  const redisLogsAfterRestart = (await compose("logs", "--no-color", "redis")).stdout;
  assert.match(redisLogsAfterRestart, /DB loaded from append only file/);
  await waitObservation("healthy", 90_000);
  await compose("up", "-d", "n8n-worker");
  await waitReady("n8n-worker", 5680);
  await waitSuccessCount(redisExecutions);
  const redisCorrelationCounts = await correlationCounts("redis-loss");
  assertCorrelations("redis-loss", redisExecutions, redisCorrelationCounts);
  const redisElapsedMs = performance.now() - redisLossStartedAt;

  await compose("stop", "-t", "5", "n8n-worker");
  await sendBatch("postgres-loss", postgresExecutions);
  await waitExecutionCount(redisExecutions + postgresExecutions);
  const postgresAcceptedDigest = await psql(`SELECT md5(string_agg(id::text || ':' || status,',' ORDER BY id::bigint)) FROM execution_entity WHERE "workflowId"='${workflowId}'`);
  const redisKeysBeforePostgresKill = await redisNumber("DBSIZE");
  const postgresLossStartedAt = performance.now();
  await compose("kill", "-s", "KILL", "postgres");
  await waitFor("PostgreSQL SIGKILL exit", async () => (await killExitCode("postgres")) === 137, 30_000, 250);
  const postgresDegraded = await waitObservation("postgres_unavailable");
  assert.equal(postgresDegraded.postgres_reachable, false);
  await compose("start", "postgres");
  await waitPostgres();
  const postgresRecoveredDigest = await psql(`SELECT md5(string_agg(id::text || ':' || status,',' ORDER BY id::bigint)) FROM execution_entity WHERE "workflowId"='${workflowId}'`);
  assert.equal(postgresRecoveredDigest, postgresAcceptedDigest);
  const postgresLogs = (await compose("logs", "--no-color", "postgres")).stdout;
  assert.match(postgresLogs, /database system was interrupted|automatic recovery in progress|redo starts at/);
  assert.equal(await redisNumber("DBSIZE"), redisKeysBeforePostgresKill);
  await waitObservation("healthy", 90_000);
  await compose("up", "-d", "n8n-worker");
  await waitReady("n8n-worker", 5680);
  const finalRows = await waitSuccessCount(redisExecutions + postgresExecutions);
  const postgresCorrelationCounts = await correlationCounts("postgres-loss");
  assertCorrelations("postgres-loss", postgresExecutions, postgresCorrelationCounts);
  const postgresElapsedMs = performance.now() - postgresLossStartedAt;

  const alertsText = await observerFetch("/alerts");
  const alerts = alertsText ? alertsText.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
  assert.equal(alerts.length, 2);
  assert.deepEqual(alerts.map((alert) => alert.code), ["redis_unavailable", "postgres_unavailable"]);
  assert.ok(alerts.every((alert) => alert.contract_version === "phase5.dependency-alert.v1"));

  const evidence = {
    contract_version: "phase5.n8n-dependency-loss-evidence.v1",
    generated_at: new Date().toISOString(),
    boundaries: {
      disposable_compose: true,
      synthetic_executions: true,
      customer_credentials_used: false,
      provider_calls: 0,
      gemma_calls: 0,
      external_actions: 0,
      production_touched: false,
      gpu_server_contacted: false,
      smartlabs_touched: false,
    },
    runtime: {
      n8n_version: "2.26.8",
      postgres_version: "16.14",
      redis_version: "7.2.14",
      queue_mode: true,
      network_internal: true,
      images_immutable: true,
      host_ports_published: false,
      worker_stopped_during_acceptance_and_loss: true,
    },
    redis_loss: {
      accepted_before_loss: redisExecutions,
      signal: "SIGKILL",
      container_exit_code: 137,
      appendonly: true,
      appendfsync: "always",
      noeviction: true,
      keys_before_loss: redisKeysBeforeKill,
      keys_after_restart: redisKeysAfterRestart,
      aof_replay_completed: true,
      degraded_code: redisDegraded.code,
      native_main_readiness_detected_loss: !redisDegraded.n8n_main_readiness,
      recovered_healthy: true,
      succeeded_exactly_once: redisExecutions,
      failed: 0,
      lost: 0,
      duplicate_correlations: 0,
      elapsed_ms: Number(redisElapsedMs.toFixed(2)),
    },
    postgres_loss: {
      accepted_before_loss: postgresExecutions,
      signal: "SIGKILL",
      container_exit_code: 137,
      accepted_digest_preserved: true,
      crash_recovery_observed: true,
      redis_keys_preserved: true,
      degraded_code: postgresDegraded.code,
      native_main_readiness_detected_loss: !postgresDegraded.n8n_main_readiness,
      recovered_healthy: true,
      succeeded_exactly_once: postgresExecutions,
      failed: 0,
      lost: 0,
      duplicate_correlations: 0,
      elapsed_ms: Number(postgresElapsedMs.toFixed(2)),
    },
    monitoring: {
      observer_independent: true,
      independent_observer_required: true,
      redis_alert_delivered: true,
      postgres_alert_delivered: true,
      alert_count: alerts.length,
      final_state: "healthy",
      production_destination_configured: false,
    },
    outcomes: {
      accepted_executions: redisExecutions + postgresExecutions,
      successful_executions: finalRows.length,
      unexpected_failed_executions: 0,
      unfinished_executions: 0,
      logical_correlations: redisExecutions + postgresExecutions,
      logical_correlations_succeeded_once: redisExecutions + postgresExecutions,
      logical_correlations_lost: 0,
      duplicate_external_actions: 0,
    },
  };

  const schema = JSON.parse(await readFile(
    new URL("../packages/contracts/schemas/phase5/n8n-dependency-loss-evidence.v1.schema.json", import.meta.url), "utf8",
  ));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(evidence, null, 2));
  console.log("PASS: abrupt Redis/PostgreSQL loss, degraded alerting, durable recovery, and exactly-once synthetic correlations verified.");
} catch (error) {
  console.error(error.stack || error.message);
  if (composeStarted) {
    const status = await compose("ps", "-a").catch((diagnosticError) => ({ stdout: "", stderr: diagnosticError.message }));
    const logs = await compose("logs", "--no-color", "--tail", "250", "postgres", "redis", "n8n", "n8n-worker", "dependency-observer")
      .catch((diagnosticError) => ({ stdout: "", stderr: diagnosticError.message }));
    console.error("--- disposable dependency-loss status ---\n", status.stdout, status.stderr);
    console.error("--- disposable dependency-loss logs ---\n", logs.stdout, logs.stderr);
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
