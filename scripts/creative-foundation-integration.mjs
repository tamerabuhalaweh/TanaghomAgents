// P1a Creative Foundation disposable integration.
// Requires DATABASE_TEST_URL (fresh PostgreSQL) and a built dashboard
// (`npm run build:dashboard` first). Spins nothing except a stub JWKS auth
// server and `next start`; no docker, provider, GPU, or production contact.
//
// Flow: full migrate -> unused 0036 down/up -> contract assertions ->
// staging seed + extra users -> dashboard boot (disabled, then enabled) ->
// live API + worker-lane exit-gate proof -> used-down refusal.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import pg from "pg";
import { readFileSync } from "node:fs";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required");

const authPort = 43211;
const dashboardPort = 43212;
const authOrigin = `http://127.0.0.1:${authPort}`;
const dashboardOrigin = `http://127.0.0.1:${dashboardPort}`;
const OWNER_SUBJECT = "90000000-0000-4000-8000-000000000001";
const REVIEWER_SUBJECT = "90000000-0000-4000-8000-000000000011";
const VIEWER_SUBJECT = "90000000-0000-4000-8000-000000000012";
const ORGB_OWNER_SUBJECT = "90000000-0000-4000-8000-000000000021";
const ORG_B_ID = "81000000-0000-4000-8000-000000000001";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = { ...await exportJWK(publicKey), kid: "creative-integration-key", alg: "RS256", use: "sig" };

const subjects = {
  "owner@example.test": OWNER_SUBJECT,
  "reviewer@example.test": REVIEWER_SUBJECT,
  "viewer@example.test": VIEWER_SUBJECT,
  "orgb-owner@example.test": ORGB_OWNER_SUBJECT,
};

async function accessToken(subject) {
  return new SignJWT({ role: "authenticated", email: "creative@example.test" })
    .setProtectedHeader({ alg: "RS256", kid: "creative-integration-key" })
    .setIssuer(`${authOrigin}/auth/v1`)
    .setAudience("authenticated")
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const authServer = createServer(async (request, response) => {
  const url = new URL(request.url, authOrigin);
  if (request.method === "GET" && url.pathname === "/auth/v1/.well-known/jwks.json") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ keys: [publicJwk] }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
    const body = await jsonBody(request);
    const subject = subjects[body.email];
    if (!subject || body.password !== "integration-only") {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_grant" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ access_token: await accessToken(subject), refresh_token: "creative-refresh-0", expires_in: 3600 }));
    return;
  }
  response.writeHead(404).end();
});

function bearer(subject) {
  return accessToken(subject).then((token) => ({ Authorization: `Bearer ${token}` }));
}

async function waitForDashboard(child) {
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`dashboard exited early\n${output}`);
    try {
      const response = await fetch(`${dashboardOrigin}/api/health`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`dashboard did not become ready\n${output}`);
}

function migrate() {
  // The workflow pins DATABASE_MIGRATION_TARGET for historical controlled
  // packages; this harness needs the full chain including 0036, so the
  // target is explicitly unset here (database.mjs default migrates all).
  const { DATABASE_MIGRATION_TARGET: _pinned, ...env } = process.env;
  const result = spawnSync(process.execPath, ["scripts/database.mjs", "migrate"], {
    env: { ...env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function psqlFile(path) {
  const result = spawnSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-f", path], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
const workerPool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
let dashboard;
try {
  migrate();
  // Unused-state 0036 down/up cycle, mirroring the workspace 0035 pattern.
  await pool.query(readFileSync("packages/database/migrations/0036_creative_foundation.down.sql", "utf8"));
  console.log("PASS unused 0036 down");
  await pool.query(readFileSync("packages/database/migrations/0036_creative_foundation.up.sql", "utf8"));
  console.log("PASS unused 0036 up");
  psqlFile("packages/database/tests/creative_foundation.sql");
  psqlFile("packages/database/seeds/staging.sql");
  // Extra users for role/tenant API coverage (seed provides the owner).
  await pool.query(
    `INSERT INTO tanaghom.organizations (id, slug, name, is_active)
     VALUES ($1, 'creative-e2e-org-b', 'Creative E2E Org B', true) ON CONFLICT (id) DO NOTHING`,
    [ORG_B_ID],
  );
  await pool.query(
    `INSERT INTO tanaghom.app_users (id, organization_id, email, display_name, kind, role, auth_subject, accepted_at) VALUES
     ('00000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'reviewer@example.test', 'Creative Reviewer', 'human', 'reviewer', $1, now()),
     ('00000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 'viewer@example.test', 'Creative Viewer', 'human', 'viewer', $2, now()),
     ('00000000-0000-4000-8000-000000000021', $3, 'orgb-owner@example.test', 'Org B Owner', 'human', 'owner', $4, now())
     ON CONFLICT (id) DO NOTHING`,
    [REVIEWER_SUBJECT, VIEWER_SUBJECT, ORG_B_ID, ORGB_OWNER_SUBJECT],
  );

  authServer.listen(authPort, "127.0.0.1");
  await once(authServer, "listening");

  async function bootDashboard(extraEnv) {
    dashboard = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "apps/dashboard", "-p", String(dashboardPort)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ENV: "integration",
        DATABASE_URL: databaseUrl,
        SUPABASE_URL: authOrigin,
        SUPABASE_PUBLISHABLE_KEY: "integration-publishable-key",
        SUPABASE_SECRET_KEY: "integration-secret-key",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForDashboard(dashboard);
  }
  async function stopDashboard() {
    if (dashboard && dashboard.exitCode === null) {
      dashboard.kill("SIGTERM");
      await once(dashboard, "exit");
      dashboard = undefined;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Phase 1: surface stays OFF by default.
  await bootDashboard({});
  for (const [method, path, body] of [
    ["POST", "/api/creative/jobs", {}],
    ["GET", "/api/creative/jobs/00000000-0000-4000-8000-000000000001", undefined],
    ["GET", "/api/creative/assets", undefined],
  ]) {
    const disabled = await fetch(`${dashboardOrigin}${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(disabled.status, 503, `${method} ${path} while disabled`);
    assert.equal((await disabled.json()).error, "creative_studio_disabled");
  }
  console.log("PASS creative surface disabled by default");
  await stopDashboard();

  // Phase 2: enabled surface, full exit-gate proof.
  await pool.query(
    `UPDATE tanaghom.creative_controls
        SET enabled=true, emergency_stop=false, reason='Disposable creative foundation e2e'`,
  );
  await bootDashboard({ CREATIVE_STUDIO_ENABLED: "true" });
  const owner = await bearer(OWNER_SUBJECT);
  const reviewer = await bearer(REVIEWER_SUBJECT);
  const viewer = await bearer(VIEWER_SUBJECT);
  const orgBOwner = await bearer(ORGB_OWNER_SUBJECT);

  const anonymous = await fetch(`${dashboardOrigin}/api/creative/jobs/00000000-0000-4000-8000-000000000001`);
  assert.equal(anonymous.status, 401);

  for (const [headers, name] of [[viewer, "viewer"], [reviewer, "reviewer"]]) {
    const denied = await fetch(`${dashboardOrigin}/api/creative/jobs`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": `e2e-deny-${name}` },
      body: JSON.stringify({ capability: "image", lane: "cpu", params: { prompt: "x" }, idempotency_key: randomUUID(), correlation_id: randomUUID() }),
    });
    assert.equal(denied.status, 403, `${name} enqueue`);
  }

  const jobKey = randomUUID();
  const jobCorrelation = randomUUID();
  const enqueueHeaders = { ...owner, "Content-Type": "application/json", "Idempotency-Key": "e2e-enqueue-1" };
  const enqueueBody = JSON.stringify({ capability: "image", lane: "cpu", params: { prompt: "e2e mock square" }, idempotency_key: jobKey, correlation_id: jobCorrelation, priority: 100 });
  const enqueued = await fetch(`${dashboardOrigin}/api/creative/jobs`, { method: "POST", headers: enqueueHeaders, body: enqueueBody });
  assert.equal(enqueued.status, 200);
  const enqueuedBody = await enqueued.json();
  assert.match(enqueuedBody.job_id, /^[0-9a-f-]{36}$/);
  assert.equal(enqueuedBody.correlation_id, jobCorrelation);
  const gateJobId = enqueuedBody.job_id;
  const replayed = await fetch(`${dashboardOrigin}/api/creative/jobs`, { method: "POST", headers: enqueueHeaders, body: enqueueBody });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.headers.get("idempotency-replayed"), "true");
  assert.equal((await replayed.json()).job_id, gateJobId);
  console.log("PASS enqueue, roles, replay");

  const crossRead = await fetch(`${dashboardOrigin}/api/creative/jobs/${gateJobId}`, { headers: orgBOwner });
  assert.equal(crossRead.status, 404);
  const crossCancel = await fetch(`${dashboardOrigin}/api/creative/jobs/${gateJobId}/cancel`, {
    method: "POST", headers: { ...orgBOwner, "Idempotency-Key": "e2e-cross-cancel" },
  });
  assert.equal(crossCancel.status, 404);
  const viewerCancel = await fetch(`${dashboardOrigin}/api/creative/jobs/${gateJobId}/cancel`, {
    method: "POST", headers: { ...viewer, "Idempotency-Key": "e2e-viewer-cancel" },
  });
  assert.equal(viewerCancel.status, 403);
  console.log("PASS tenant isolation on read/cancel");

  // Worker lane through the least-privilege role: claim, mock, store, register, complete.
  const { mockExecute } = await import("../packages/creative-runtime/adapters/mock.mjs");
  const { createTestStorage } = await import("../packages/creative-runtime/storage/test-adapter.mjs");
  const { buildObjectKey } = await import("../packages/creative-runtime/storage/keys.mjs");
  const storage = createTestStorage();
  const worker = await workerPool.connect();
  try {
    await worker.query("SET ROLE tanaghom_creative_worker");
    const claimed = await worker.query(`SELECT * FROM tanaghom.claim_creative_job('cpu','e2e-worker',120)`);
    assert.equal(claimed.rows[0]?.job_id, gateJobId);
    assert.equal(await worker.query(`SELECT tanaghom.mark_creative_job_running($1,'e2e-worker') AS s`, [gateJobId]).then((r) => r.rows[0].s), "running");
    const artifact = await mockExecute({ capability: "image", jobId: gateJobId, params: { prompt: "e2e mock square" }, organizationId: "10000000-0000-4000-8000-000000000001" });
    const objectKey = buildObjectKey({ organizationId: "10000000-0000-4000-8000-000000000001", capability: "image", assetId: gateJobId, version: 1, mime: artifact.mime });
    const stored = storage.put({ key: objectKey, bytes: artifact.bytes, mime: artifact.mime });
    assert.equal(stored.sha256, artifact.sha256);
    const registered = await worker.query(
      `SELECT tanaghom.create_creative_asset_version($1,'e2e-worker',NULL,'E2E square',$2,1024,1024,NULL,$3,$4,$5,NULL,$6,NULL,NULL,'mock') AS id`,
      [gateJobId, artifact.mime, artifact.bytes.length, artifact.sha256, objectKey, JSON.stringify(artifact.provenance)],
    );
    const versionId = registered.rows[0].id;
    assert.equal(await worker.query(`SELECT tanaghom.complete_creative_job($1,'e2e-worker',$2,3) AS s`, [gateJobId, versionId]).then((r) => r.rows[0].s), "succeeded");
    await worker.query("RESET ROLE");
    const read = await fetch(`${dashboardOrigin}/api/creative/jobs/${gateJobId}`, { headers: owner });
    assert.equal(read.status, 200);
    assert.equal((await read.json()).job.status, "succeeded");
    const version = await fetch(`${dashboardOrigin}/api/creative/assets/versions/${versionId}`, { headers: owner });
    assert.equal(version.status, 200);
    assert.equal((await version.json()).version.status, "draft");
    const assets = await fetch(`${dashboardOrigin}/api/creative/assets`, { headers: viewer });
    assert.equal(assets.status, 200);
    assert.equal((await assets.json()).assets.length, 1);
    const rejectBare = await fetch(`${dashboardOrigin}/api/creative/assets/versions/${versionId}/decision`, {
      method: "POST", headers: { ...reviewer, "Content-Type": "application/json", "Idempotency-Key": "e2e-decide-1" },
      body: JSON.stringify({ decision: "rejected" }),
    });
    assert.equal(rejectBare.status, 400);
    const rejected = await fetch(`${dashboardOrigin}/api/creative/assets/versions/${versionId}/decision`, {
      method: "POST", headers: { ...reviewer, "Content-Type": "application/json", "Idempotency-Key": "e2e-decide-2" },
      body: JSON.stringify({ decision: "rejected", feedback: "off-brand test feedback" }),
    });
    assert.equal(rejected.status, 200);
    const rejectedBody = await rejected.json();
    assert.equal(rejectedBody.status, "rejected");
    assert.equal(rejectedBody.correlation_id, jobCorrelation);
    const lateApprove = await fetch(`${dashboardOrigin}/api/creative/assets/versions/${versionId}/decision`, {
      method: "POST", headers: { ...owner, "Content-Type": "application/json", "Idempotency-Key": "e2e-decide-3" },
      body: JSON.stringify({ decision: "approved" }),
    });
    assert.equal(lateApprove.status, 409);
    const viewerDecide = await fetch(`${dashboardOrigin}/api/creative/assets/versions/${versionId}/decision`, {
      method: "POST", headers: { ...viewer, "Content-Type": "application/json", "Idempotency-Key": "e2e-decide-4" },
      body: JSON.stringify({ decision: "approved" }),
    });
    assert.equal(viewerDecide.status, 403);
  } finally {
    worker.release();
  }
  console.log("PASS worker lane, mock artifact, completion, decisions");

  // Second job proves the cancel path end to end.
  const cancelKey = randomUUID();
  const cancelEnqueue = await fetch(`${dashboardOrigin}/api/creative/jobs`, {
    method: "POST", headers: { ...owner, "Content-Type": "application/json", "Idempotency-Key": "e2e-cancel-1" },
    body: JSON.stringify({ capability: "design", lane: "cpu", params: { brief: "cancel me" }, idempotency_key: cancelKey, correlation_id: randomUUID() }),
  });
  const cancelJobId = (await cancelEnqueue.json()).job_id;
  const cancelled = await fetch(`${dashboardOrigin}/api/creative/jobs/${cancelJobId}/cancel`, {
    method: "POST", headers: { ...owner, "Idempotency-Key": "e2e-cancel-2" },
  });
  assert.equal(cancelled.status, 200);
  const cancelledBody = await cancelled.json();
  assert.equal(cancelledBody.status, "cancelled");
  const cancelJobCorr = (await pool.query(`SELECT correlation_id::text AS c FROM tanaghom.creative_jobs WHERE id=$1`, [cancelJobId])).rows[0].c;
  assert.equal(cancelledBody.correlation_id, cancelJobCorr);
  const cancelledAgain = await fetch(`${dashboardOrigin}/api/creative/jobs/${cancelJobId}/cancel`, {
    method: "POST", headers: { ...owner, "Idempotency-Key": "e2e-cancel-3" },
  });
  assert.equal(cancelledAgain.status, 409);

  // Audit + provider silence for the gate job.
  const evidence = await pool.query(
    `SELECT (SELECT count(*)::int FROM tanaghom.agent_actions_log
              WHERE entity_id=$1 OR entity_id IN (SELECT id FROM tanaghom.creative_asset_versions WHERE job_id=$1)) audit,
            (SELECT count(*)::int FROM tanaghom.creative_events WHERE job_id=$1) events,
            (SELECT count(*)::int FROM tanaghom.posts WHERE id=$1) posts,
            (SELECT count(*)::int FROM tanaghom.external_operations WHERE idempotency_key LIKE '%'||$2||'%') operations,
            (SELECT provider FROM tanaghom.creative_jobs WHERE id=$1) provider`,
    [gateJobId, jobCorrelation],
  );
  assert.ok(evidence.rows[0].audit >= 2);
  assert.ok(evidence.rows[0].events >= 5);
  assert.deepEqual({ posts: evidence.rows[0].posts, operations: evidence.rows[0].operations, provider: evidence.rows[0].provider },
    { posts: 0, operations: 0, provider: null });
  console.log("PASS audit lineage and zero provider actions");

  // Correlation continuity: every audit row for the gate job, its versions,
  // and the cancel job shares the originating job trace — no forked UUIDs.
  const traces = await pool.query(
    `SELECT DISTINCT correlation_id::text AS c FROM tanaghom.agent_actions_log
      WHERE entity_id=$1 OR entity_id IN (SELECT id FROM tanaghom.creative_asset_versions WHERE job_id=$1)`,
    [gateJobId],
  );
  assert.deepEqual(traces.rows.map((row) => row.c), [jobCorrelation]);
  const cancelTraces = await pool.query(
    `SELECT DISTINCT correlation_id::text AS c FROM tanaghom.agent_actions_log WHERE entity_id=$1`,
    [cancelJobId],
  );
  assert.deepEqual(cancelTraces.rows.map((row) => row.c), [cancelJobCorr]);
  console.log("PASS correlation continuity across enqueue, worker, cancel, and decisions");

  // Used-state 0036 down refuses; the migration stays applied.
  try {
    await pool.query(readFileSync("packages/database/migrations/0036_creative_foundation.down.sql", "utf8"));
    throw new Error("used 0036 down unexpectedly succeeded");
  } catch (error) {
    assert.match(error.message, /retained jobs|unexpectedly succeeded/);
  }
  const applied = await pool.query(`SELECT count(*)::int AS n FROM public.schema_migrations WHERE version='0036_creative_foundation'`);
  assert.equal(applied.rows[0].n, 1);
  console.log("PASS used 0036 down refusal");
  console.log("PASS: creative foundation exit gate demonstrated end to end.");
} finally {
  if (dashboard && dashboard.exitCode === null) dashboard.kill("SIGTERM");
  authServer.close();
  await pool.end();
  await workerPool.end();
}
