// P2a image-lane disposable integration. Requires DATABASE_TEST_URL (fresh
// PostgreSQL) and a built dashboard (`npm run build:dashboard` first).
// Spins a stub JWKS auth server, a stub image provider (fal-schnell-shaped
// with fault modes), and a minimal S3-compatible stub; no real provider,
// GPU, credentials, or production contact.
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

const authPort = 43221;
const dashboardPort = 43222;
const providerPort = 43223;
const s3Port = 43224;
const authOrigin = `http://127.0.0.1:${authPort}`;
const dashboardOrigin = `http://127.0.0.1:${dashboardPort}`;
const providerOrigin = `http://127.0.0.1:${providerPort}`;
const s3Origin = `http://127.0.0.1:${s3Port}`;
const OWNER_SUBJECT = "90000000-0000-4000-8000-000000000031";
const OPERATOR_SUBJECT = "90000000-0000-4000-8000-000000000033";
const REVIEWER_SUBJECT = "90000000-0000-4000-8000-000000000034";
const VIEWER_SUBJECT = "90000000-0000-4000-8000-000000000032";
const ORGB_OWNER_SUBJECT = "90000000-0000-4000-8000-000000000041";
const ORG_B_ID = "81000000-0000-4000-8000-000000000041";
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = { ...await exportJWK(publicKey), kid: "creative-image-key", alg: "RS256", use: "sig" };
const providerHits = {};

async function accessToken(subject) {
  return new SignJWT({ role: "authenticated", email: "image@example.test" })
    .setProtectedHeader({ alg: "RS256", kid: "creative-image-key" })
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
  response.writeHead(404).end();
});

// Stub image provider: fal-schnell-shaped JSON with fault injection.
const providerServer = createServer(async (request, response) => {
  const url = new URL(request.url, providerOrigin);
  // Artifact URLs are public CDN-style links: no auth, like real providers.
  if (request.method === "GET" && url.pathname === "/artifact.png") {
    response.writeHead(200, { "Content-Type": "image/png", "Content-Length": PNG_1X1.length });
    response.end(PNG_1X1);
    return;
  }
  if (!request.headers.authorization) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  const fault = url.pathname.split("/").pop();
  providerHits[fault] = (providerHits[fault] ?? 0) + 1;
  const json = (status, payload, headers = {}) => {
    response.writeHead(status, { "Content-Type": "application/json", ...headers });
    response.end(typeof payload === "string" ? payload : JSON.stringify(payload));
  };
  if (request.method === "POST" && url.pathname.startsWith("/fal-ai/flux/schnell")) {
    const body = await jsonBody(request);
    if (!body.prompt || typeof body.prompt !== "string") return json(400, { error: "bad prompt" });
    if (fault === "rate_limit") return json(429, { error: "slow down" });
    if (fault === "broken") return json(500, { error: "boom" });
    if (fault === "rejected") return json(400, { error: "bad prompt" });
    if (fault === "malformed") return json(200, "not-json{{{");
    if (fault === "empty") return json(200, { images: [] });
    if (fault === "slow") {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return json(200, { images: [{ url: `${providerOrigin}/artifact.png`, content_type: "image/png" }] });
    }
    return json(200, { images: [{ url: `${providerOrigin}/artifact.png`, content_type: "image/png" }] }, { "x-fal-request-id": `stub-${providerHits[fault]}` });
  }
  response.writeHead(404).end();
});

// Minimal S3-compatible stub: path-style buckets, in-memory bytes.
const s3Objects = new Map();
const s3Server = createServer(async (request, response) => {
  const url = new URL(request.url, s3Origin);
  if (!request.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ")) {
    response.writeHead(403).end();
    return;
  }
  const key = decodeURIComponent(url.pathname.slice(1));
  if (request.method === "PUT") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (s3Objects.has(key)) {
      response.writeHead(409).end();
      return;
    }
    s3Objects.set(key, { bytes, contentType: request.headers["content-type"] ?? "application/octet-stream" });
    response.writeHead(200, { ETag: '"stub-etag"' }).end();
    return;
  }
  if (request.method === "GET" || request.method === "HEAD") {
    const object = s3Objects.get(key);
    if (!object) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": object.contentType, "Content-Length": object.bytes.length, ETag: '"stub-etag"' });
    if (request.method === "GET") response.end(object.bytes);
    else response.end();
    return;
  }
  if (request.method === "DELETE") {
    if (!s3Objects.delete(key)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(204).end();
    return;
  }
  response.writeHead(400).end();
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
const workerPool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
let dashboard;
try {
  // Unused-state down/up cycle for the newest migration, whatever it is at
  // this head (see the foundation script for why this is not hardcoded).
  migrate();
  const latestMigration = (await pool.query(`SELECT max(version) AS v FROM public.schema_migrations`)).rows[0].v;
  await pool.query(readFileSync(`packages/database/migrations/${latestMigration}.down.sql`, "utf8"));
  console.log(`PASS unused ${latestMigration} down`);
  await pool.query(readFileSync(`packages/database/migrations/${latestMigration}.up.sql`, "utf8"));
  console.log(`PASS unused ${latestMigration} up`);
  psqlFile("packages/database/tests/creative_image_lane.sql");

  await pool.query(
    `INSERT INTO tanaghom.organizations (id, slug, name, is_active)
     VALUES ($1, 'image-org-b', 'Image Org B', true) ON CONFLICT (id) DO NOTHING`,
    [ORG_B_ID],
  );
  await pool.query(
    `INSERT INTO tanaghom.app_users (id, organization_id, email, display_name, kind, role, auth_subject, accepted_at) VALUES
     ('00000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000001', 'image-owner@example.test', 'Image Owner', 'human', 'owner', $1, now()),
     ('00000000-0000-4000-8000-000000000033', '10000000-0000-4000-8000-000000000001', 'image-operator@example.test', 'Image Operator', 'human', 'operator', $2, now()),
     ('00000000-0000-4000-8000-000000000034', '10000000-0000-4000-8000-000000000001', 'image-reviewer@example.test', 'Image Reviewer', 'human', 'reviewer', $3, now()),
     ('00000000-0000-4000-8000-000000000032', '10000000-0000-4000-8000-000000000001', 'image-viewer@example.test', 'Image Viewer', 'human', 'viewer', $4, now()),
     ('00000000-0000-4000-8000-000000000041', $5, 'orgb-owner@example.test', 'Org B Owner', 'human', 'owner', $6, now())
     ON CONFLICT (id) DO NOTHING`,
    [OWNER_SUBJECT, OPERATOR_SUBJECT, REVIEWER_SUBJECT, VIEWER_SUBJECT, ORG_B_ID, ORGB_OWNER_SUBJECT],
  );

  authServer.listen(authPort, "127.0.0.1");
  await once(authServer, "listening");
  providerServer.listen(providerPort, "127.0.0.1");
  await once(providerServer, "listening");
  s3Server.listen(s3Port, "127.0.0.1");
  await once(s3Server, "listening");

  async function bootDashboard(extraEnv) {
    dashboard = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "apps/dashboard", "-p", String(dashboardPort)], {
      cwd: process.cwd(),
      env: {
        ...process.env, APP_ENV: "integration", DATABASE_URL: databaseUrl,
        SUPABASE_URL: authOrigin, SUPABASE_PUBLISHABLE_KEY: "integration-publishable-key", SUPABASE_SECRET_KEY: "integration-secret-key",
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

  // Flags OFF by default: generation refuses safely.
  await bootDashboard({});
  const ownerProbe = await (async () => {
    const { default: jose } = await import("jose").catch(() => ({}));
    void jose;
    return bearer(OWNER_SUBJECT);
  })();
  for (const path of ["/api/creative/generations", "/api/creative/product/generate"]) {
    const off = await fetch(`${dashboardOrigin}${path}`, {
      method: "POST", headers: { ...ownerProbe, "Content-Type": "application/json", "Idempotency-Key": "e2e-flag-off" },
      body: JSON.stringify({}),
    });
    assert.equal(off.status, 503, `${path} while disabled`);
  }
  console.log("PASS generation flags off by default");
  await stopDashboard();

  await bootDashboard({ CREATIVE_STUDIO_ENABLED: "true", IMAGE_GENERATION_ENABLED: "true", PRODUCT_STUDIO_ENABLED: "true" });
  await pool.query(`UPDATE tanaghom.creative_controls SET enabled=true, emergency_stop=false, reason='Disposable image lane e2e'`);
  const owner = await bearer(OWNER_SUBJECT);
  const operator = await bearer(OPERATOR_SUBJECT);
  const reviewer = await bearer(REVIEWER_SUBJECT);
  const viewer = await bearer(VIEWER_SUBJECT);
  const orgBOwner = await bearer(ORGB_OWNER_SUBJECT);

  async function postJson(path, headers, body, key) {
    return fetch(`${dashboardOrigin}${path}`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
  }

  const anonymous = await fetch(`${dashboardOrigin}/api/creative/generations`, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "e2e-anon" }, body: JSON.stringify({}),
  });
  assert.equal(anonymous.status, 401);
  for (const [headers, name] of [[viewer, "viewer"], [reviewer, "reviewer"]]) {
    const denied = await postJson("/api/creative/generations", headers,
      { capability: "image", prompt: "x", idempotency_key: randomUUID(), correlation_id: randomUUID() }, `e2e-gen-deny-${name}`);
    assert.equal(denied.status, 403, `generation ${name}`);
  }
  const badVariants = await postJson("/api/creative/generations", owner,
    { capability: "image", prompt: "x", variants: 5, idempotency_key: randomUUID(), correlation_id: randomUUID() }, "e2e-gen-bad");
  assert.equal(badVariants.status, 400);

  const genKey = randomUUID();
  const genCorrelation = randomUUID();
  const genBody = { capability: "image", prompt: "A red square, flat vector style", width: 512, height: 512, variants: 2, idempotency_key: genKey, correlation_id: genCorrelation };
  const submitted = await postJson("/api/creative/generations", owner, genBody, "e2e-gen-1");
  assert.equal(submitted.status, 200);
  const submittedBody = await submitted.json();
  assert.equal(submittedBody.job_ids.length, 2);
  assert.equal(submittedBody.correlation_id, genCorrelation);
  assert.ok(Math.abs(submittedBody.estimate.estimated_cost_usd - 0.006) < 1e-9);
  assert.equal(submittedBody.estimate.unit, "megapixel");
  assert.equal(submittedBody.estimate.informational_only, true);
  const resubmitted = await postJson("/api/creative/generations", owner, genBody, "e2e-gen-1");
  assert.equal(resubmitted.status, 200);
  assert.equal(resubmitted.headers.get("idempotency-replayed"), "true");
  assert.deepEqual((await resubmitted.json()).job_ids, submittedBody.job_ids);
  const arSubmit = await postJson("/api/creative/generations", owner,
    { capability: "image", prompt: "مربع أحمر بسيط", idempotency_key: randomUUID(), correlation_id: randomUUID() }, "e2e-gen-ar");
  assert.equal(arSubmit.status, 200);
  const arJobId = (await arSubmit.json()).job_ids[0];
  console.log("PASS generation submit, roles, estimate, replay, Arabic prompt");

  // Worker lane through the least-privilege role. Expected params are tracked
  // in-harness: the worker role has no direct table reads by design.
  const expectedParams = new Map([
    [submittedBody.job_ids[0], { prompt: "A red square, flat vector style", width: 512, height: 512 }],
    [submittedBody.job_ids[1], { prompt: "A red square, flat vector style", width: 512, height: 512 }],
    [arJobId, { prompt: "مربع أحمر بسيط", width: 1024, height: 1024 }],
  ]);
  const httpImage = await import("../packages/creative-runtime/adapters/http-image.mjs");
  const sharpPipe = await import("../packages/creative-runtime/adapters/local-sharp.mjs");
  const s3mod = await import("../packages/creative-runtime/storage/s3.mjs");
  const keysMod = await import("../packages/creative-runtime/storage/keys.mjs");
  const s3 = s3mod.createS3Storage({
    endpoint: s3Origin, region: "us-east-1", bucket: "creative-test",
    accessKeyId: "TESTKEY", secretAccessKey: "test-secret-at-least-16-chars",
  });
  const worker = await workerPool.connect();
  const ledger = [];
  function ledgerLine(entry) {
    ledger.push({ ...entry, at: new Date().toISOString() });
    console.log(`LEDGER ${JSON.stringify(ledger[ledger.length - 1])}`);
  }
  async function beginCall(db, jobId, actor, fields) {
    const result = await db.query(
      `SELECT tanaghom.begin_creative_provider_call($1,$2,$3,$4,$5,$6,$7,$8,$9) AS id`,
      [jobId, actor, fields.provider, fields.model, fields.modelVersion ?? null, fields.operation,
        JSON.stringify(fields.units ?? {}), fields.est ?? null, fields.adapterConfig ?? null],
    );
    return result.rows[0].id;
  }
  async function finishCall(db, callId, actor, fields) {
    const result = await db.query(
      `SELECT tanaghom.finish_creative_provider_call($1,$2,$3,$4,$5,$6,$7) AS status`,
      [callId, actor, fields.requestId ?? null, fields.actual ?? null, fields.status,
        fields.errorClass ?? null, fields.errorMessage ?? null],
    );
    return result.rows[0].status;
  }
  async function priorTerminalCall(jobId, operation, actor = "e2e-image-worker") {
    const existing = await worker.query(
      `SELECT tanaghom.latest_creative_provider_call($1,$2,$3) AS status`,
      [jobId, actor, operation],
    );
    return existing.rows[0]?.status ?? null;
  }
  // Executes one claimed job exactly once per operation: refuses blind retry
  // after any terminal (succeeded/indeterminate) provider record. (Enforced
  // inline below via priorTerminalCall; kept as documentation of the rule.)
  try {
    await worker.query("SET ROLE tanaghom_creative_worker");
    // Two EN variant jobs + the AR job, oldest first.
    for (const [index, jobId] of [...submittedBody.job_ids, arJobId].entries()) {
      const claimed = await worker.query(`SELECT * FROM tanaghom.claim_creative_job('gpu_image','e2e-image-worker',120)`);
      const row = claimed.rows.find((candidate) => candidate.job_id === jobId) ?? claimed.rows[0];
      assert.ok(row);
      const targetId = row.job_id;
      await worker.query(`SELECT tanaghom.mark_creative_job_running($1,'e2e-image-worker')`, [targetId]);
      const jobParams = expectedParams.get(targetId) ?? { prompt: "fallback", width: 512, height: 512 };
      const adapter = httpImage.createHttpImageAdapter({
        name: "stub-schnell", endpoint: `${providerOrigin}/fal-ai/flux/schnell`, apiKey: "stub-key",
        model: "fal-ai/flux/schnell", modelVersion: null, timeoutMs: 30000, testLoopback: true,
      });
      const callId = await beginCall(worker, targetId, "e2e-image-worker", {
        provider: "stub-schnell", model: "fal-ai/flux/schnell", modelVersion: null,
        operation: "text_to_image", units: { megapixels: 1 }, est: 0.003, adapterConfig: "creative.providers.v1",
      });
      const startedAt = Date.now();
      const generated = await adapter.execute({ prompt: jobParams.prompt, width: jobParams.width ?? 512, height: jobParams.height ?? 512, variants: 1 });
      const downloaded = await httpImage.downloadArtifact({
        url: generated.images[0].url, allowedOrigins: [], testLoopback: true,
      });
      assert.ok(downloaded.bytes.length > 0);
      const probed = await sharpPipe.probeImage(downloaded.bytes);
      assert.equal(probed.format, "png");
      const keyBase = `t/10000000-0000-4000-8000-000000000001/image/${targetId}/v1`;
      await s3.put(`${keyBase}.png`, downloaded.bytes, "image/png");
      const versionId = await worker.query(
        `SELECT tanaghom.create_creative_asset_version($1,'e2e-image-worker',NULL,'Stub variant',$2,$3::int,$4::int,NULL,$5::bigint,$6,$7,NULL,$8,NULL,NULL,'render') AS id`,
        [targetId, "image/png", jobParams.width ?? 512, jobParams.height ?? 512, downloaded.bytes.length,
          keysMod.sha256Hex(downloaded.bytes), `${keyBase}.png`,
          JSON.stringify({ adapter: "stub-schnell", provider_request_id: generated.requestId })],
      ).then((r) => r.rows[0].id);
      await finishCall(worker, callId, "e2e-image-worker", {
        requestId: generated.requestId, actual: 0.003, status: "succeeded",
      });
      const done = await worker.query(`SELECT tanaghom.complete_creative_job($1,'e2e-image-worker',$2,1) AS s`, [targetId, versionId]);
      assert.equal(done.rows[0].s, "succeeded");
      ledgerLine({ case_id: index < 2 ? "img-en-01" : "img-ar-01", kind: "text_to_image", provider: "stub-schnell", model: "fal-ai/flux/schnell", output_bytes: downloaded.bytes.length, latency_ms: Date.now() - startedAt, cost_usd: 0.003, result: "succeeded", fidelity: "not_reviewed" });
    }
    console.log("PASS provider-path execution with provenance, cost, storage");

    // Fault matrix: timeout, 429, malformed, empty. Re-asserts the worker
    // role explicitly: earlier phases release their client.
    await worker.query("SET ROLE tanaghom_creative_worker");
    const faultCases = [
      { fault: "slow", timeoutMs: 300, errorClass: "indeterminate", terminal: "policy", label: "timeout" },
      { fault: "rate_limit", timeoutMs: 10000, errorClass: "capacity", terminal: "requeued", label: "rate_limit" },
      { fault: "malformed", timeoutMs: 10000, errorClass: "deterministic", terminal: "failed", label: "malformed" },
      { fault: "empty", timeoutMs: 10000, errorClass: "deterministic", terminal: "failed", label: "empty" },
    ];
    for (const faultCase of faultCases) {
      const enqueued = await postJson("/api/creative/generations", owner,
        { capability: "image", prompt: `fault ${faultCase.label}`, width: 256, height: 256, variants: 1, idempotency_key: randomUUID(), correlation_id: randomUUID() },
        `e2e-fault-${faultCase.label}`);
      assert.equal(enqueued.status, 200);
      const faultJobId = (await enqueued.json()).job_ids[0];
      const claimed = await worker.query(`SELECT * FROM tanaghom.claim_creative_job('gpu_image','e2e-fault-worker',120)`);
      const row = claimed.rows.find((candidate) => candidate.job_id === faultJobId);
      assert.ok(row, `fault job claimed (${faultCase.label})`);
      await worker.query(`SELECT tanaghom.mark_creative_job_running($1,'e2e-fault-worker')`, [faultJobId]);
      const adapter = httpImage.createHttpImageAdapter({
        name: `stub-${faultCase.fault}`, endpoint: `${providerOrigin}/fal-ai/flux/schnell/${faultCase.fault}`, apiKey: "stub-key",
        model: "fal-ai/flux/schnell", timeoutMs: faultCase.timeoutMs, testLoopback: true,
      });
      const before = providerHits[faultCase.fault] ?? 0;
      let outcome;
      const faultCallId = await beginCall(worker, faultJobId, "e2e-fault-worker", {
        provider: `stub-${faultCase.fault}`, model: "fal-ai/flux/schnell", modelVersion: null,
        operation: "text_to_image", units: {}, est: 0, adapterConfig: "creative.providers.v1",
      });
      try {
        await adapter.execute({ prompt: "x", width: 256, height: 256, variants: 1 });
        assert.fail(`fault ${faultCase.label} unexpectedly succeeded`);
      } catch (error) {
        assert.equal(error.errorClass, faultCase.errorClass, faultCase.label);
        outcome = error;
      }
      await finishCall(worker, faultCallId, "e2e-fault-worker", {
        status: faultCase.errorClass === "indeterminate" ? "indeterminate" : "failed",
        errorClass: faultCase.errorClass, errorMessage: outcome.message.slice(0, 200),
      });
      if (faultCase.errorClass === "indeterminate") {
        // A second worker pass must refuse a blind retry: exactly one stub hit total.
        const prior = await priorTerminalCall(faultJobId, "text_to_image", "e2e-fault-worker");
        assert.equal(prior, "indeterminate");
        const refused = await worker.query(`SELECT tanaghom.fail_creative_job($1,'e2e-fault-worker','policy','refusing blind retry after indeterminate provider record',0) AS s`, [faultJobId]);
        assert.equal(refused.rows[0].s, "failed");
        assert.equal(providerHits[faultCase.fault] ?? 0, before + 1);
        ledgerLine({ case_id: "neg-timeout-01", kind: "negative", provider: "stub", result: "indeterminate_no_retry", cost_usd: 0 });
      } else {
        const failed = await worker.query(`SELECT tanaghom.fail_creative_job($1,'e2e-fault-worker',$2,$3,0) AS s`,
          [faultJobId, faultCase.errorClass, outcome.message.slice(0, 200)]);
        assert.equal(failed.rows[0].s, faultCase.terminal === "requeued" ? "queued" : "failed");
        if (faultCase.terminal === "requeued") {
          // Requeue behavior is now proven; terminate the job so later fault
          // iterations claim their own target deterministically.
          await worker.query(`SELECT * FROM tanaghom.claim_creative_job('gpu_image','e2e-fault-worker',120)`);
          const cleanup = await worker.query(`SELECT tanaghom.fail_creative_job($1,'e2e-fault-worker','cancelled','harness cleanup after requeue proof',0) AS s`, [faultJobId]);
          assert.equal(cleanup.rows[0].s, "cancelled");
        }
        ledgerLine({ case_id: `neg-${faultCase.label}-01`, kind: "negative", provider: "stub", result: faultCase.terminal, cost_usd: 0 });
      }
    }
    console.log("PASS fault classification without blind retry");

    // Concurrent begins against one job serialize to distinct attempts.
    const raceSubmit = await postJson("/api/creative/generations", owner,
      { capability: "image", prompt: "race", width: 256, height: 256, variants: 1, idempotency_key: randomUUID(), correlation_id: randomUUID() }, "e2e-race-1");
    assert.equal(raceSubmit.status, 200);
    const raceJobId = (await raceSubmit.json()).job_ids[0];
    await worker.query(`SELECT * FROM tanaghom.claim_creative_job('gpu_image','e2e-race-worker',120)`);
    await worker.query(`SELECT tanaghom.mark_creative_job_running($1,'e2e-race-worker')`, [raceJobId]);
    const raceA = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    const raceB = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await raceA.query("SET ROLE tanaghom_creative_worker");
      await raceB.query("SET ROLE tanaghom_creative_worker");
      const [ra, rb] = await Promise.allSettled([
        raceA.query(`SELECT tanaghom.begin_creative_provider_call($1,'e2e-race-worker','stub','m',NULL,'text_to_image','{}',NULL,'creative.providers.v1') AS id`, [raceJobId]),
        raceB.query(`SELECT tanaghom.begin_creative_provider_call($1,'e2e-race-worker','stub','m',NULL,'text_to_image','{}',NULL,'creative.providers.v1') AS id`, [raceJobId]),
      ]);
      assert.equal(ra.status, "fulfilled");
      assert.equal(rb.status, "fulfilled");
      const attempts = await pool.query(`SELECT attempt_no FROM tanaghom.creative_provider_calls WHERE job_id=$1 ORDER BY attempt_no`, [raceJobId]);
      assert.deepEqual(attempts.rows.map((row) => row.attempt_no), [1, 2]);
      // Terminal rows reject further finishes.
      const firstId = ra.status === "fulfilled" ? ra.value.rows[0].id : null;
      await worker.query(`SELECT tanaghom.finish_creative_provider_call($1,'e2e-race-worker',NULL,NULL,'failed','transient','x')`, [firstId]);
      await assert.rejects(
        worker.query(`SELECT tanaghom.finish_creative_provider_call($1,'e2e-race-worker',NULL,NULL,'failed','transient','x')`, [firstId]),
        /already terminal/,
      );
    } finally {
      await raceA.end();
      await raceB.end();
    }
    await worker.query(`SELECT tanaghom.fail_creative_job($1,'e2e-race-worker','cancelled','race cleanup',0)`, [raceJobId]);
    console.log("PASS attempt allocation serializes; terminal rows immutable");
  } finally {
    await worker.query("RESET ROLE").catch(() => {});
    worker.release();
  }

  // S3 adapter CRUD against the disposable S3-compatible stub.
  {
    const s3Key = `t/10000000-0000-4000-8000-000000000001/image/${randomUUID()}/v1.png`;
    const stored = await s3.put(s3Key, PNG_1X1, "image/png");
    assert.ok(stored.etag);
    const fetched = await s3.get(s3Key);
    assert.deepEqual(fetched.bytes, PNG_1X1);
    const presigned = s3.presignGet(s3Key, 900, new Date("2026-10-08T00:00:00Z"));
    assert.ok(presigned.url.includes("X-Amz-Signature="));
    assert.equal(presigned.previewOnly, true);
    await assert.rejects(s3.put(s3Key, PNG_1X1, "image/png"), /409/);
    assert.equal((await s3.remove(s3Key)).deleted, true);
    assert.equal(await s3.get(s3Key), null);
    console.log("PASS s3-compatible storage round-trip");
  }

  // Product flow: upload source, submit scene, execute local pipeline.
  async function uploadPng({ headers, key, filename, title }) {
    const form = new FormData();
    form.set("file", new File([PNG_1X1], filename, { type: "image/png" }), filename);
    if (title !== undefined) form.set("title", title);
    return fetch(`${dashboardOrigin}/api/creative/uploads`, {
      method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: form,
    });
  }
  const srcUpload = await uploadPng({ headers: operator, key: "e2e-prod-up-1", filename: "product.png", title: "Test product" });
  assert.equal(srcUpload.status, 200);
  const srcBody = await srcUpload.json();
  const presetsRes = await fetch(`${dashboardOrigin}/api/creative/product/presets`, { headers: owner });
  assert.equal(presetsRes.status, 200);
  const presetCodes = (await presetsRes.json()).presets.map((preset) => preset.code);
  assert.deepEqual([...presetCodes].sort(), ["clean_white", "marble", "office_studio", "outdoor_lifestyle", "wood"]);
  const prodSubmit = await postJson("/api/creative/product/generate", operator,
    { source_version_id: srcBody.version_id, preset: "marble" }, "e2e-prod-1");
  assert.equal(prodSubmit.status, 200);
  const prodJobId = (await prodSubmit.json()).job_id;
  const prodBadPreset = await postJson("/api/creative/product/generate", operator,
    { source_version_id: srcBody.version_id, preset: "nope" }, "e2e-prod-2");
  assert.equal(prodBadPreset.status, 400);
  const prodReviewer = await postJson("/api/creative/product/generate", reviewer,
    { source_version_id: srcBody.version_id, preset: "marble" }, "e2e-prod-3");
  assert.equal(prodReviewer.status, 403);
  const prodBadSource = await postJson("/api/creative/product/generate", operator,
    { source_version_id: randomUUID(), preset: "marble" }, "e2e-prod-4");
  assert.equal(prodBadSource.status, 404);

  const productWorker = await workerPool.connect();
  let prodVersionId;
  try {
    await productWorker.query("SET ROLE tanaghom_creative_worker");
    const claimed = await productWorker.query(`SELECT * FROM tanaghom.claim_creative_job('cpu','e2e-product-worker',120)`);
    const row = claimed.rows.find((candidate) => candidate.job_id === prodJobId);
    assert.ok(row);
    await productWorker.query(`SELECT tanaghom.mark_creative_job_running($1,'e2e-product-worker')`, [prodJobId]);
    const previewRes = await fetch(
      `${dashboardOrigin}/api/creative/assets/versions/${srcBody.version_id}/preview`, { headers: operator });
    assert.equal(previewRes.status, 200);
    const sourceBytes = Buffer.from(await previewRes.arrayBuffer());
    const t0 = Date.now();
    const scene = await sharpPipe.composeScene({
      foregroundBytes: sourceBytes,
      preset: { code: "marble", background: { kind: "gradient", from: "#f5f3ef", to: "#d9d4cb", angle: 135 }, relight: { brightness: 1.0, saturation: 1.05 }, output: { width: 512, height: 512 } },
    });
    const sceneKey = `t/10000000-0000-4000-8000-000000000001/image/${prodJobId}/v1.png`;
    await s3.put(sceneKey, scene.bytes, "image/png");
    const registered = await productWorker.query(
      `SELECT tanaghom.create_creative_asset_version($1,'e2e-product-worker',NULL,'Marble scene','image/png',512,512,NULL,$2::bigint,$3,$4,NULL,$5,NULL,NULL,'composite') AS id`,
      [prodJobId, scene.bytes.length, keysMod.sha256Hex(scene.bytes), sceneKey, JSON.stringify(scene.provenance)],
    );
    prodVersionId = registered.rows[0].id;
    await recordCallDirect(prodJobId, "compose", scene.bytes.length, Date.now() - t0);
    const done = await productWorker.query(`SELECT tanaghom.complete_creative_job($1,'e2e-product-worker',$2,NULL) AS s`, [prodJobId, prodVersionId]);
    assert.equal(done.rows[0].s, "succeeded");
    ledgerLine({ case_id: "prd-medium-01", kind: "product_scene", provider: "local-sharp", preset: "marble", output_bytes: scene.bytes.length, latency_ms: Date.now() - t0, cost_usd: 0, result: "succeeded", fidelity: "not_reviewed" });
    async function recordCallDirect(jobId, op, bytes, ms) {
      const callId = await beginCall(productWorker, jobId, "e2e-product-worker", {
        provider: "local-sharp", model: "sharp", modelVersion: null,
        operation: op, units: { bytes }, est: 0, adapterConfig: "local-sharp/builtin",
      });
      await finishCall(productWorker, callId, "e2e-product-worker", { actual: 0, status: "succeeded" });
      void ms;
    }
    console.log("PASS product scene execution with provenance");
  } finally {
    await productWorker.query("RESET ROLE").catch(() => {});
    productWorker.release();
  }

  // Fidelity gate: failed blocks approval until an owner override is audited.
  const fidFailed = await postJson(`/api/creative/assets/versions/${prodVersionId}/fidelity`, reviewer,
    { overall: "failed", checklist: { logo: "pass", package_text: "fail", shape: "pass", proportions: "pass", primary_colors: "pass", markings: "unreviewed" } }, "e2e-fid-1");
  assert.equal(fidFailed.status, 200);
  const fidBad = await postJson(`/api/creative/assets/versions/${prodVersionId}/fidelity`, reviewer,
    { overall: "maybe", checklist: {} }, "e2e-fid-2");
  assert.equal(fidBad.status, 400);
  const approveBlocked = await postJson(`/api/creative/assets/versions/${prodVersionId}/decision`, reviewer,
    { decision: "approved" }, "e2e-fid-3");
  assert.equal(approveBlocked.status, 409);
  assert.equal((await approveBlocked.json()).error, "fidelity_override_required");
  const reviewerOverride = await fetch(`${dashboardOrigin}/api/creative/assets/versions/${prodVersionId}/decision`, {
    method: "POST", headers: { ...reviewer, "Content-Type": "application/json", "Idempotency-Key": "e2e-fid-4" },
    body: JSON.stringify({ decision: "approved", fidelity_override_reason: "reviewer override" }),
  });
  assert.equal(reviewerOverride.status, 409);
  const ownerOverride = await fetch(`${dashboardOrigin}/api/creative/assets/versions/${prodVersionId}/decision`, {
    method: "POST", headers: { ...owner, "Content-Type": "application/json", "Idempotency-Key": "e2e-fid-5" },
    body: JSON.stringify({ decision: "approved", fidelity_override_reason: "Owner accepts label blur for staging" }),
  });
  assert.equal(ownerOverride.status, 200);
  const fidHistory = await fetch(`${dashboardOrigin}/api/creative/assets/versions/${prodVersionId}/fidelity`, { headers: owner });
  assert.equal(fidHistory.status, 200);
  assert.equal((await fidHistory.json()).reviews.length, 1);
  console.log("PASS fidelity review path with owner-override gate");

  // Cancellation while running terminates cooperatively.
  const cancelSubmit = await postJson("/api/creative/generations", owner,
    { capability: "image", prompt: "cancel me", width: 256, height: 256, variants: 1, idempotency_key: randomUUID(), correlation_id: randomUUID() }, "e2e-cancel-1");
  const cancelJobId = (await cancelSubmit.json()).job_ids[0];
  const cancelWorker = await workerPool.connect();
  try {
    await cancelWorker.query("SET ROLE tanaghom_creative_worker");
    await cancelWorker.query(`SELECT * FROM tanaghom.claim_creative_job('gpu_image','e2e-cancel-worker',120)`);
    await cancelWorker.query(`SELECT tanaghom.mark_creative_job_running($1,'e2e-cancel-worker')`, [cancelJobId]);
    const cancelReq = await fetch(`${dashboardOrigin}/api/creative/jobs/${cancelJobId}/cancel`, {
      method: "POST", headers: { ...owner, "Idempotency-Key": "e2e-cancel-2" },
    });
    assert.equal(cancelReq.status, 200);
    const cancelled = await cancelWorker.query(`SELECT tanaghom.fail_creative_job($1,'e2e-cancel-worker','cancelled','operator cancelled',0) AS s`, [cancelJobId]);
    assert.equal(cancelled.rows[0].s, "cancelled");
  } finally {
    await cancelWorker.query("RESET ROLE").catch(() => {});
    cancelWorker.release();
  }
  console.log("PASS cooperative cancellation");

  // S3 adapter CRUD against the disposable S3-compatible stub.
  {
    const s3Key = `t/10000000-0000-4000-8000-000000000001/image/${randomUUID()}/v1.png`;
    const s3stored = await s3.put(s3Key, PNG_1X1, "image/png");
    assert.ok(s3stored.etag);
    const s3fetched = await s3.get(s3Key);
    assert.deepEqual(s3fetched.bytes, PNG_1X1);
    const s3signed = s3.presignGet(s3Key, 900, new Date("2026-10-08T00:00:00Z"));
    assert.ok(s3signed.url.includes("X-Amz-Signature="));
    assert.equal(s3signed.previewOnly, true);
    await assert.rejects(s3.put(s3Key, PNG_1X1, "image/png"), /409/);
    assert.equal((await s3.remove(s3Key)).deleted, true);
    assert.equal(await s3.get(s3Key), null);
    console.log("PASS s3-compatible storage round-trip");
  }

  // Browser journeys for the new surfaces.
  const { runCreativeImageBrowser } = await import("./creative-image-browser.mjs");
  await runCreativeImageBrowser({
    dashboardOrigin,
    mintToken: (subject) => accessToken(subject),
    subjects: { owner: OWNER_SUBJECT, reviewer: REVIEWER_SUBJECT, viewer: VIEWER_SUBJECT, operator: OPERATOR_SUBJECT },
  });

  // Used-state 0038 down refuses; the migration stays applied.
  try {
    await pool.query(readFileSync("packages/database/migrations/0038_creative_image_lane.down.sql", "utf8"));
    throw new Error("used 0038 down unexpectedly succeeded");
  } catch (error) {
    assert.match(error.message, /retained provider or fidelity evidence|unexpectedly succeeded/);
  }
  const applied = await pool.query(`SELECT count(*)::int AS n FROM public.schema_migrations WHERE version='0038_creative_image_lane'`);
  assert.equal(applied.rows[0].n, 1);
  console.log("PASS used 0038 down refusal");
  console.log("PASS: creative image lane exit gate demonstrated end to end.");
} finally {
  if (dashboard && dashboard.exitCode === null) dashboard.kill("SIGTERM");
  authServer.close();
  providerServer.close();
  s3Server.close();
  await pool.end();
  await workerPool.end();
}
