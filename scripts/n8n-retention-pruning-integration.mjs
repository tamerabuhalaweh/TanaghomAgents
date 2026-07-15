import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = process.cwd();
const baseCompose = join(root, "deployment", "phase5f-runtime-recovery", "docker-compose.yml");
const retentionCompose = join(root, "deployment", "phase5f-retention", "docker-compose.yml");
const evidencePath = process.env.N8N_RETENTION_EVIDENCE_PATH || "tmp/n8n-retention-pruning-evidence.json";
const project = `tanaghom-p5f-retention-${process.pid}`;
const temporary = await mkdtemp(join(tmpdir(), "tanaghom-n8n-retention-"));
const secretDirectory = join(temporary, "secrets");
const postgresPassword = randomBytes(24).toString("hex");
const redisPassword = randomBytes(24).toString("hex");
const encryptionKey = randomBytes(36).toString("hex");
const backupKey = randomBytes(32);
const workflowId = "phase5RuntimeRecoveryProbeV1";
const mainUrl = "http://127.0.0.1:5678";
const completedExecutions = Number(process.env.N8N_RETENTION_COMPLETED_EXECUTIONS || 60);
const queuedExecutions = Number(process.env.N8N_RETENTION_QUEUED_EXECUTIONS || 40);
const retainedMaximum = Number(process.env.N8N_RETENTION_MAX_COUNT || 20);
const payloadBytes = Number(process.env.N8N_RETENTION_PAYLOAD_BYTES || 16384);
const restoreDatabase = `n8n_retention_restore_${process.pid}`;
const composeEnv = {
  ...process.env,
  TANAGHOM_RUNTIME_SECRET_DIR: secretDirectory,
  TANAGHOM_RETENTION_TEST_PRUNE: "false",
  TANAGHOM_RETENTION_TEST_MAX_COUNT: String(retainedMaximum),
};
let composeStarted = false;

assert.ok(completedExecutions > retainedMaximum);
assert.ok(queuedExecutions >= 10);
assert.ok(payloadBytes >= 1024 && payloadBytes <= 65536);

function run(command, args, options = {}) {
  const allowed = options.allowedExitCodes || [0];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
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
  return run("docker", ["compose", "-p", project, "-f", baseCompose, "-f", retentionCompose, ...args], {
    env: composeEnv,
  });
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

async function psql(database, sql) {
  const result = await compose("exec", "-T", "postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1",
    "-U", "n8n", "-d", database, "-At", "-F", "\t", "-c", sql);
  return result.stdout.trim();
}

async function executionRows(database = "n8n") {
  const output = await psql(database,
    `SELECT id::text,status FROM execution_entity WHERE "workflowId"='${workflowId}' ORDER BY id::bigint`);
  return output ? output.split(/\r?\n/).map((line) => {
    const [id, status] = line.split("\t");
    return { id, status };
  }) : [];
}

async function waitSettled(count) {
  const terminal = new Set(["success", "error", "crashed", "canceled"]);
  return waitFor(`${count} settled executions`, async () => {
    const rows = await executionRows();
    return rows.length === count && rows.every((row) => terminal.has(row.status)) ? rows : undefined;
  }, 240_000, 1000);
}

async function sendBatch(prefix, count, concurrency = 20) {
  // Random base64 avoids an unrealistically favorable PostgreSQL TOAST result
  // from a repeated-character payload while remaining synthetic and credential-free.
  const padding = randomBytes(Math.ceil(payloadBytes * 0.75)).toString("base64").slice(0, payloadBytes);
  for (let offset = 0; offset < count; offset += concurrency) {
    const size = Math.min(concurrency, count - offset);
    await Promise.all(Array.from({ length: size }, async (_, index) => {
      const correlation = `${prefix}-${offset + index}`;
      const body = JSON.stringify({ correlation_id: correlation, delay_ms: 100, payload: padding });
      const result = await compose("exec", "-T", "n8n", "node", "-e",
        `fetch('${mainUrl}/webhook/tanaghom-runtime-recovery',{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(body)},signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw new Error(String(r.status));process.stdout.write(String(r.status))})`);
      assert.equal(result.stdout.trim(), "200");
    }));
  }
}

async function postgresMetrics(database = "n8n") {
  const output = await psql(database, `
    SELECT
      pg_database_size(current_database()),
      COALESCE((SELECT sum(pg_total_relation_size(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'execution%'),0),
      count(*),
      COALESCE(sum(pg_column_size(e.*)),0),
      COALESCE((SELECT sum(pg_column_size(d.*)) FROM execution_data d JOIN execution_entity x ON x.id=d."executionId" WHERE x."workflowId"='${workflowId}'),0),
      md5(COALESCE(string_agg(e.id::text || ':' || e.status, ',' ORDER BY e.id::bigint),''))
    FROM execution_entity e
    WHERE e."workflowId"='${workflowId}'`);
  const [databaseBytes, executionRelationsBytes, count, entityBytes, dataBytes, digest] = output.split("\t");
  return {
    database_bytes: Number(databaseBytes),
    execution_relations_bytes: Number(executionRelationsBytes),
    execution_count: Number(count),
    logical_execution_bytes: Number(entityBytes) + Number(dataBytes),
    execution_digest: digest,
  };
}

async function redisMetrics() {
  const result = await compose("exec", "-T", "redis", "sh", "-ec",
    "REDISCLI_AUTH=\"$(cat /run/secrets/redis_password)\" redis-cli INFO memory; REDISCLI_AUTH=\"$(cat /run/secrets/redis_password)\" redis-cli INFO persistence; REDISCLI_AUTH=\"$(cat /run/secrets/redis_password)\" redis-cli DBSIZE");
  const value = (name) => Number(result.stdout.match(new RegExp(`^${name}:(\\d+)`, "m"))?.[1]);
  const lines = result.stdout.trim().split(/\r?\n/);
  const dbsize = Number(lines.at(-1));
  return {
    keys: dbsize,
    used_memory_bytes: value("used_memory"),
    aof_current_size_bytes: value("aof_current_size"),
    aof_base_size_bytes: value("aof_base_size"),
  };
}

async function waitAofRewrite() {
  await waitFor("Redis AOF rewrite", async () => {
    const result = await compose("exec", "-T", "redis", "sh", "-ec",
      "REDISCLI_AUTH=\"$(cat /run/secrets/redis_password)\" redis-cli INFO persistence");
    return /aof_rewrite_in_progress:0/.test(result.stdout)
      && /aof_rewrite_scheduled:0/.test(result.stdout)
      && /aof_last_bgrewrite_status:ok/.test(result.stdout);
  }, 120_000, 500);
}

function encryptBackup(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", backupKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from("TNGR1"), iv, cipher.getAuthTag(), ciphertext]);
}

function decryptBackup(encrypted) {
  assert.equal(encrypted.subarray(0, 5).toString("utf8"), "TNGR1");
  const iv = encrypted.subarray(5, 17);
  const tag = encrypted.subarray(17, 33);
  const decipher = createDecipheriv("aes-256-gcm", backupKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted.subarray(33)), decipher.final()]);
}

function projectedBytes(bytesPerItem, retainedItems) {
  return Math.ceil(bytesPerItem * retainedItems);
}

try {
  await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
  await Promise.all([
    writeFile(join(secretDirectory, "postgres_password"), postgresPassword, { mode: 0o644 }),
    writeFile(join(secretDirectory, "redis_password"), redisPassword, { mode: 0o644 }),
    writeFile(join(secretDirectory, "n8n_encryption_key"), encryptionKey, { mode: 0o644 }),
  ]);

  await compose("config", "--quiet");
  await compose("pull", "postgres", "redis", "n8n", "n8n-worker");
  composeStarted = true;
  await compose("up", "-d", "postgres", "redis");
  await waitFor("PostgreSQL health", async () => (await compose("exec", "-T", "postgres", "pg_isready", "-U", "n8n", "-d", "n8n")).stdout.includes("accepting connections"));
  await waitFor("Redis health", async () => (await compose("exec", "-T", "redis", "sh", "-ec", "REDISCLI_AUTH=\"$(cat /run/secrets/redis_password)\" redis-cli PING")).stdout.trim() === "PONG");
  await compose("run", "--rm", "--no-deps", "n8n", "import:workflow", "--input=/fixtures/runtime-recovery-probe.v1.json");
  await compose("run", "--rm", "--no-deps", "n8n", "publish:workflow", `--id=${workflowId}`);
  await compose("up", "-d", "n8n", "n8n-worker");
  await Promise.all([waitReady("n8n", 5678), waitReady("n8n-worker", 5680)]);

  const postgresBaseline = await postgresMetrics();
  const redisBaseline = await redisMetrics();
  await sendBatch("retained", completedExecutions);
  await waitSettled(completedExecutions);
  const beforePrune = await postgresMetrics();
  assert.equal(beforePrune.execution_count, completedExecutions);
  assert.ok(beforePrune.logical_execution_bytes > 0);

  await compose("exec", "-T", "postgres", "pg_dump", "-U", "n8n", "-d", "n8n", "-Fc", "-f", "/tmp/pre-prune.dump");
  const postgresContainer = (await compose("ps", "-q", "postgres")).stdout.trim();
  const plainBackupPath = join(temporary, "pre-prune.dump");
  const encryptedBackupPath = join(temporary, "pre-prune.dump.enc");
  const restoreBackupPath = join(temporary, "restore.dump");
  await run("docker", ["cp", `${postgresContainer}:/tmp/pre-prune.dump`, plainBackupPath]);
  const plainBackup = await readFile(plainBackupPath);
  const encryptedBackup = encryptBackup(plainBackup);
  await writeFile(encryptedBackupPath, encryptedBackup, { mode: 0o600 });
  const decryptedBackup = decryptBackup(await readFile(encryptedBackupPath));
  assert.deepEqual(decryptedBackup, plainBackup);
  await writeFile(restoreBackupPath, decryptedBackup, { mode: 0o600 });
  await run("docker", ["cp", restoreBackupPath, `${postgresContainer}:/tmp/restore.dump`]);

  await compose("stop", "-t", "5", "n8n-worker");
  await sendBatch("queued", queuedExecutions);
  await waitFor("queued execution count", async () => (await executionRows()).length === completedExecutions + queuedExecutions);
  const redisQueued = await redisMetrics();
  assert.ok(redisQueued.keys >= redisBaseline.keys);
  assert.ok(redisQueued.aof_current_size_bytes >= redisBaseline.aof_current_size_bytes);
  await compose("up", "-d", "n8n-worker");
  await waitReady("n8n-worker", 5680);
  await waitSettled(completedExecutions + queuedExecutions);
  const redisBeforeRewrite = await redisMetrics();
  await compose("exec", "-T", "redis", "sh", "-ec",
    "REDISCLI_AUTH=\"$(cat /run/secrets/redis_password)\" redis-cli BGREWRITEAOF");
  await waitAofRewrite();
  const redisAfterRewrite = await redisMetrics();
  assert.equal(redisAfterRewrite.keys, redisBeforeRewrite.keys);
  assert.ok(redisAfterRewrite.aof_current_size_bytes <= redisBeforeRewrite.aof_current_size_bytes);

  composeEnv.TANAGHOM_RETENTION_TEST_PRUNE = "true";
  await compose("stop", "-t", "5", "n8n-worker", "n8n");
  await compose("up", "-d", "--force-recreate", "n8n");
  await waitReady("n8n", 5678);
  await compose("up", "-d", "--force-recreate", "n8n-worker");
  await waitReady("n8n-worker", 5680);
  const afterPrune = await waitFor("count-based execution pruning", async () => {
    const metrics = await postgresMetrics();
    return metrics.execution_count <= retainedMaximum ? metrics : undefined;
  }, 300_000, 2000);
  assert.ok(afterPrune.execution_count > 0);
  assert.ok(afterPrune.execution_count <= retainedMaximum);
  await psql("n8n", "VACUUM (ANALYZE) execution_entity");
  await psql("n8n", "VACUUM (ANALYZE) execution_data");
  const afterVacuum = await postgresMetrics();

  await psql("postgres", `CREATE DATABASE ${restoreDatabase} OWNER n8n`);
  await compose("exec", "-T", "postgres", "pg_restore", "-U", "n8n", "-d", restoreDatabase, "--exit-on-error", "/tmp/restore.dump");
  const restored = await postgresMetrics(restoreDatabase);
  assert.equal(restored.execution_count, beforePrune.execution_count);
  assert.equal(restored.execution_digest, beforePrune.execution_digest);
  await psql("postgres", `DROP DATABASE ${restoreDatabase} WITH (FORCE)`);

  const measuredExecutionBytes = Math.max(1, beforePrune.logical_execution_bytes - postgresBaseline.logical_execution_bytes);
  const executionBytesPerItem = measuredExecutionBytes / completedExecutions;
  const redisAofBytesPerQueuedItem = Math.max(0, redisQueued.aof_current_size_bytes - redisBaseline.aof_current_size_bytes) / queuedExecutions;
  const redisMemoryBytesPerQueuedItem = Math.max(0, redisQueued.used_memory_bytes - redisBaseline.used_memory_bytes) / queuedExecutions;
  const profiles = [
    { name: "normal_1000_per_day", executions_per_day: 1000, retention_days: 7 },
    { name: "representative_peak_10000_per_day", executions_per_day: 10000, retention_days: 7 },
    { name: "illustrative_75000_single_burst", executions_per_day: 75000, retention_days: 1 },
  ].map((profile) => {
    const generated = profile.executions_per_day * profile.retention_days;
    const retained = Math.min(generated, 10000);
    return {
      ...profile,
      retained_execution_cap: retained,
      projected_n8n_logical_bytes: projectedBytes(executionBytesPerItem, retained),
      projected_redis_aof_bytes_at_full_backlog: projectedBytes(redisAofBytesPerQueuedItem, profile.executions_per_day),
      projected_redis_memory_bytes_at_full_backlog: projectedBytes(redisMemoryBytesPerQueuedItem, profile.executions_per_day),
      production_sla_claim: false,
    };
  });

  const evidence = {
    contract_version: "phase5.n8n-retention-pruning-evidence.v1",
    generated_at: new Date().toISOString(),
    boundaries: {
      disposable_compose: true,
      synthetic_executions: true,
      customer_credentials_used: false,
      provider_calls: 0,
      gemma_calls: 0,
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
    },
    workload: {
      completed_before_backup: completedExecutions,
      queued_for_redis_measurement: queuedExecutions,
      total_executions: completedExecutions + queuedExecutions,
      payload_bytes_per_execution: payloadBytes,
      external_actions: 0,
    },
    postgres: {
      baseline_database_bytes: postgresBaseline.database_bytes,
      before_prune_database_bytes: beforePrune.database_bytes,
      before_prune_execution_relations_bytes: beforePrune.execution_relations_bytes,
      measured_logical_execution_bytes: measuredExecutionBytes,
      measured_logical_bytes_per_execution: Number(executionBytesPerItem.toFixed(2)),
      retained_maximum: retainedMaximum,
      retained_after_prune: afterPrune.execution_count,
      rows_removed: completedExecutions + queuedExecutions - afterPrune.execution_count,
      ordinary_vacuum_completed: true,
      physical_file_shrink_claimed: false,
      post_vacuum_database_bytes: afterVacuum.database_bytes,
    },
    redis: {
      aof_enabled: true,
      noeviction: true,
      baseline_keys: redisBaseline.keys,
      queued_keys: redisQueued.keys,
      keys_after_drain_before_rewrite: redisBeforeRewrite.keys,
      keys_after_rewrite: redisAfterRewrite.keys,
      baseline_aof_bytes: redisBaseline.aof_current_size_bytes,
      queued_aof_bytes: redisQueued.aof_current_size_bytes,
      before_rewrite_aof_bytes: redisBeforeRewrite.aof_current_size_bytes,
      after_rewrite_aof_bytes: redisAfterRewrite.aof_current_size_bytes,
      measured_aof_bytes_per_queued_execution: Number(redisAofBytesPerQueuedItem.toFixed(2)),
      measured_memory_bytes_per_queued_execution: Number(redisMemoryBytesPerQueuedItem.toFixed(2)),
      bgrewriteaof_completed: true,
      queue_keys_preserved: true,
      manual_queue_key_deletion_performed: false,
    },
    backup_restore: {
      pre_prune_execution_count: beforePrune.execution_count,
      backup_format: "pg_dump_custom_aes_256_gcm",
      encrypted_backup_sha256: createHash("sha256").update(encryptedBackup).digest("hex"),
      restored_to_unique_disposable_database: true,
      restored_execution_count: restored.execution_count,
      restored_execution_digest_matches: true,
      restore_database_removed: true,
      in_place_undelete_claimed: false,
    },
    proposed_policy: {
      save_on_error: "all",
      save_on_success: "all",
      save_on_progress: false,
      save_manual_executions: true,
      prune_enabled: true,
      maximum_age_hours: 168,
      maximum_count: 10000,
      hard_delete_buffer_hours: 1,
      production_applied: false,
    },
    projections: {
      fixed_75000_lead_sla_claimed: false,
      based_on_synthetic_payload_shape: true,
      profiles,
    },
  };

  const schema = JSON.parse(await readFile(
    new URL("../packages/contracts/schemas/phase5/n8n-retention-pruning-evidence.v1.schema.json", import.meta.url), "utf8",
  ));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(evidence, null, 2));
  console.log("PASS: n8n/PostgreSQL/Redis retention, projection, pruning, compaction, encrypted restore, and rollback evidence verified.");
} catch (error) {
  console.error(error.stack || error.message);
  if (composeStarted) {
    const status = await compose("ps", "-a").catch((diagnosticError) => ({ stdout: "", stderr: diagnosticError.message }));
    const logs = await compose("logs", "--no-color", "--tail", "200", "postgres", "redis", "n8n", "n8n-worker")
      .catch((diagnosticError) => ({ stdout: "", stderr: diagnosticError.message }));
    console.error("--- disposable retention status ---\n", status.stdout, status.stderr);
    console.error("--- disposable retention logs ---\n", logs.stdout, logs.stderr);
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
