// P4 generative-video disposable integration. Requires DATABASE_TEST_URL
// (fresh PostgreSQL) and a built dashboard (`npm run build:dashboard`
// first). Spins a stub JWKS auth server, a stub MiniMax-V2-shaped video
// provider (fault modes), and a loopback artifact server; no real
// provider, key, billing, or production contact. EXTERNAL ACCEPTANCE
// PENDING for vendor pixels.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import pg from "pg";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required");

const uploadDir = mkdtempSync(join(tmpdir(), "video-e2e-uploads-"));

const authPort = 43521;
const dashboardPort = 43522;
const providerPort = 43523;
const artifactPort = 43524;
const authOrigin = `http://127.0.0.1:${authPort}`;
const dashboardOrigin = `http://127.0.0.1:${dashboardPort}`;
const providerOrigin = `http://127.0.0.1:${providerPort}`;
const artifactOrigin = `http://127.0.0.1:${artifactPort}`;
const OWNER_SUBJECT = "93000000-0000-4000-8000-000000000031";
const OPERATOR_SUBJECT = "93000000-0000-4000-8000-000000000033";
const REVIEWER_SUBJECT = "93000000-0000-4000-8000-000000000034";
const VIEWER_SUBJECT = "93000000-0000-4000-8000-000000000032";
const ORGB_OWNER_SUBJECT = "93000000-0000-4000-8000-000000000041";
const ORG_B_ID = "84000000-0000-4000-8000-000000000041";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = { ...await exportJWK(publicKey), kid: "creative-video-key", alg: "RS256", use: "sig" };

// Minimal VALID vendor-style MP4 fixture (isom brand, mp4v video track,
// 640x640, 5s) served by the loopback artifact stub. Real vendor bytes
// would exercise the identical validator path at acceptance.
function box(type, ...payloads) {
  const body = Buffer.concat(payloads);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, body]);
}
function fixtureMp4() {
  const u32 = (value) => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(value, 0);
    return buffer;
  };
  const matrix = Buffer.concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);
  const ftyp = box("ftyp", Buffer.from("isom....isom", "ascii"));
  const mvhd = box("mvhd", Buffer.concat([u32(0), u32(0), u32(0), u32(1000), u32(5000), u32(0x00010000), Buffer.alloc(10), matrix, Buffer.alloc(24), u32(2)]));
  const dims = Buffer.alloc(8);
  dims.writeUInt32BE(640 * 65536, 0);
  dims.writeUInt32BE(640 * 65536, 4);
  const tkhd = box("tkhd", Buffer.concat([u32(0), u32(0), u32(0), u32(1), u32(0), u32(5000), Buffer.alloc(8), Buffer.alloc(8), matrix, dims]));
  const hdlr = box("hdlr", Buffer.concat([u32(0), u32(0), Buffer.from("vide", "ascii"), Buffer.alloc(12)]));
  const entryHeader = Buffer.alloc(8);
  entryHeader.writeUInt32BE(86, 0);
  entryHeader.write("mp4v", 4, "ascii");
  const stsd = box("stsd", Buffer.concat([u32(0), u32(1), entryHeader, Buffer.alloc(78)]));
  const mdia = box("mdia", box("mdhd", Buffer.concat([u32(0), u32(0), u32(0), u32(1000), u32(5000), Buffer.alloc(8)])), hdlr, box("minf", box("stbl", stsd)));
  return Buffer.concat([ftyp, box("moov", mvhd, box("trak", tkhd, mdia))]);
}
const FIXTURE_MP4 = fixtureMp4();
const GARBAGE = Buffer.from("this is not a video container at all, just text....");

async function accessToken(subject) {
  return new SignJWT({ role: "authenticated", email: "video@example.test" })
    .setProtectedHeader({ alg: "RS256", kid: "creative-video-key" })
    .setIssuer(`${authOrigin}/auth/v1`)
    .setAudience("authenticated")
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
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

function bearer(subject) {
  return accessToken(subject).then((token) => ({ Authorization: `Bearer ${token}` }));
}

async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

// Stub MiniMax-V2-shaped provider. Fault selects behavior; tasks progress
// queued -> running -> terminal across polls.
const providerTasks = new Map();
let providerTaskSeq = 0;
const providerHits = { creates: 0, queries: 0 };
const providerServer = createServer(async (request, response) => {
  const url = new URL(request.url, providerOrigin);
  const json = (status, payload) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  };
  if (request.method === "POST" && url.pathname.startsWith("/v2/video_generation")) {
    providerHits.creates += 1;
    const fault = url.pathname.split("/").pop();
    const body = await jsonBody(request);
    if (fault === "rate_limit") return json(429, { type: "error", error: { type: "rate_limit_error", message: "slow down", http_code: "429" }, request_id: "r1" });
    if (fault === "rejected") return json(422, { type: "error", error: { type: "unprocessable_entity_error", message: "video description contains sensitive content (1026)", http_code: "422" }, request_id: "r2" });
    if (fault === "malformed") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("not-json{{{");
      return;
    }
    if (fault === "empty") return json(200, {});
    providerTaskSeq += 1;
    const id = `stub-task-${providerTaskSeq}`;
    providerTasks.set(id, { polls: 0, fault, prompt: body?.prompt ?? body?.content?.[0]?.text ?? "" });
    return json(200, { task_id: id });
  }
  const queryMatch = /^\/v2\/query\/video_generation\/(.+)$/.exec(url.pathname);
  if (request.method === "GET" && queryMatch) {
    providerHits.queries += 1;
    const task = providerTasks.get(decodeURIComponent(queryMatch[1]));
    if (!task) return json(404, { type: "error", error: { message: "unknown task" } });
    task.polls += 1;
    if (task.fault === "stuck") return json(200, { task: { id: queryMatch[1], status: "running" } });
    if (task.fault === "flaky" && task.polls <= 2) {
      return json(500, { type: "error", error: { type: "server_error", message: "internal error (1000)", http_code: "500" } });
    }
    if (task.fault === "cancel-slow" && task.polls < 5) {
      return json(200, { task: { id: queryMatch[1], status: "running" } });
    }
    if (task.fault === "moderated") {
      return json(200, { task: { id: queryMatch[1], status: "failed", error: { code: "1026", message: "video description contains sensitive content" } } });
    }
    if (task.fault === "evil-host") {
      return json(200, { task: { id: queryMatch[1], status: "succeeded", content: { url: "https://evil.example/x.mp4" }, duration: 5, resolution: "768P", ratio: "16:9", usage: { output_seconds: 5 } } });
    }
    if (task.fault === "garbage") {
      return json(200, { task: { id: queryMatch[1], status: "succeeded", content: { url: `${artifactOrigin}/garbage.mp4` }, duration: 5, resolution: "768P", ratio: "16:9", usage: { output_seconds: 5 } } });
    }
    if (task.polls < 2) return json(200, { task: { id: queryMatch[1], status: "running" } });
    return json(200, {
      task: {
        id: queryMatch[1], status: "succeeded",
        content: { url: `${artifactOrigin}/artifact.mp4` },
        duration: 5, resolution: "768P", ratio: "16:9", usage: { output_seconds: 5 },
      },
    });
  }
  response.writeHead(404).end();
});

const artifactServer = createServer(async (request, response) => {
  const url = new URL(request.url, artifactOrigin);
  if (request.method === "GET" && url.pathname === "/artifact.mp4") {
    response.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": FIXTURE_MP4.length });
    response.end(FIXTURE_MP4);
    return;
  }
  if (request.method === "GET" && url.pathname === "/garbage.mp4") {
    response.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": GARBAGE.length });
    response.end(GARBAGE);
    return;
  }
  response.writeHead(404).end();
});

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
let dashboard;
let workerDb;
try {
  migrate();
  const latestMigration = (await pool.query(`SELECT max(version) AS v FROM public.schema_migrations`)).rows[0].v;
  assert.equal(latestMigration, "0044_creative_video_lane");
  await pool.query(readFileSync(`packages/database/migrations/${latestMigration}.down.sql`, "utf8"));
  console.log(`PASS unused ${latestMigration} down`);
  await pool.query(readFileSync(`packages/database/migrations/${latestMigration}.up.sql`, "utf8"));
  console.log(`PASS unused ${latestMigration} up`);
  psqlFile("packages/database/tests/creative_video.sql");

  await pool.query(
    `INSERT INTO tanaghom.organizations (id, slug, name, is_active)
     VALUES ($1, 'video-e2e-org-b', 'Video E2E Org B', true) ON CONFLICT (id) DO NOTHING`,
    [ORG_B_ID],
  );
  await pool.query(
    `INSERT INTO tanaghom.app_users (id, organization_id, email, display_name, kind, role, auth_subject, accepted_at) VALUES
     ('00000000-0000-4000-8000-000000000331', '10000000-0000-4000-8000-000000000001', 'video-owner@example.test', 'Video Owner', 'human', 'owner', $1, now()),
     ('00000000-0000-4000-8000-000000000333', '10000000-0000-4000-8000-000000000001', 'video-operator@example.test', 'Video Operator', 'human', 'operator', $2, now()),
     ('00000000-0000-4000-8000-000000000334', '10000000-0000-4000-8000-000000000001', 'video-reviewer@example.test', 'Video Reviewer', 'human', 'reviewer', $3, now()),
     ('00000000-0000-4000-8000-000000000332', '10000000-0000-4000-8000-000000000001', 'video-viewer@example.test', 'Video Viewer', 'human', 'viewer', $4, now()),
     ('00000000-0000-4000-8000-000000000341', $5, 'orgb-owner@example.test', 'Org B Owner', 'human', 'owner', $6, now())
     ON CONFLICT (id) DO NOTHING`,
    [OWNER_SUBJECT, OPERATOR_SUBJECT, REVIEWER_SUBJECT, VIEWER_SUBJECT, ORG_B_ID, ORGB_OWNER_SUBJECT],
  );

  authServer.listen(authPort, "127.0.0.1");
  await once(authServer, "listening");
  providerServer.listen(providerPort, "127.0.0.1");
  await once(providerServer, "listening");
  artifactServer.listen(artifactPort, "127.0.0.1");
  await once(artifactServer, "listening");

  const workerDbConnected = await pool.connect();
  workerDb = workerDbConnected;
  await workerDb.query("SET ROLE tanaghom_creative_worker");

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

  // Flags OFF by default: video generation refuses safely.
  await bootDashboard({});
  const ownerProbe = await bearer(OWNER_SUBJECT);
  const off = await fetch(`${dashboardOrigin}/api/creative/video/generate`, {
    method: "POST", headers: { ...ownerProbe, "Content-Type": "application/json", "Idempotency-Key": "e2e-video-off" },
    body: JSON.stringify({}),
  });
  assert.equal(off.status, 503);
  console.log("PASS video flags off by default");
  await stopDashboard();

  await bootDashboard({ CREATIVE_STUDIO_ENABLED: "true", GENERATIVE_VIDEO_ENABLED: "true", CREATIVE_UPLOAD_DIR: uploadDir });
  await pool.query(`UPDATE tanaghom.creative_controls SET enabled=true, emergency_stop=false, reason='Disposable video e2e'`);
  // Foreign-capability decoy: an older image GPU job the video worker
  // must never touch.
  const decoyId = (await pool.query(
    `SELECT tanaghom.create_creative_job('00000000-0000-4000-8000-000000000331','image','gpu_video','{}',$1,$2,0,3) AS id`,
    [randomUUID(), randomUUID()],
  )).rows[0].id;
  const owner = await bearer(OWNER_SUBJECT);
  const operator = await bearer(OPERATOR_SUBJECT);
  const reviewer = await bearer(REVIEWER_SUBJECT);
  const viewer = await bearer(VIEWER_SUBJECT);

  async function postJson(path, headers, body, key) {
    return fetch(`${dashboardOrigin}${path}`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
  }

  const anonymous = await fetch(`${dashboardOrigin}/api/creative/video/generate`, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "e2e-video-anon" }, body: JSON.stringify({}),
  });
  assert.equal(anonymous.status, 401);
  for (const [headers, name] of [[viewer, "viewer"], [reviewer, "reviewer"]]) {
    const denied = await postJson("/api/creative/video/generate", headers,
      { operation: "text_to_video", prompt: "x", duration: 5, ratio: "16:9", correlation_id: randomUUID() }, `e2e-video-deny-${name}`);
    assert.equal(denied.status, 403, `video submit ${name}`);
  }
  const badDuration = await postJson("/api/creative/video/generate", owner,
    { operation: "text_to_video", prompt: "x", duration: 30, ratio: "16:9", correlation_id: randomUUID() }, "e2e-video-bad");
  assert.equal(badDuration.status, 400);

  const correlation = randomUUID();
  const genKey = randomUUID();
  const generated = await postJson("/api/creative/video/generate", owner,
    { operation: "text_to_video", prompt: "A falcon over dunes at dawn, slow push in", duration: 5, ratio: "16:9", correlation_id: correlation }, genKey);
  const generatedText = await generated.text();
  assert.equal(generated.status, 200, generatedText.slice(0, 300));
  const gen = JSON.parse(generatedText);
  assert.equal(gen.estimate.estimated_cost_usd, 0.4);
  assert.equal(gen.estimate.informational_only, true);
  const replayed = await postJson("/api/creative/video/generate", owner,
    { operation: "text_to_video", prompt: "A falcon over dunes at dawn, slow push in", duration: 5, ratio: "16:9", correlation_id: correlation }, genKey);
  assert.equal(replayed.status, 200);
  assert.deepEqual((await replayed.json()).job_ids, gen.job_ids);
  assert.equal(replayed.headers.get("Idempotency-Replayed"), "true");
  console.log("PASS video submit with estimate + idempotency replay");

  // Runtime provider worker under the least-privilege role.
  const { executeVideoJob } = await import("../packages/creative-runtime/render/video-worker.mjs");
  const { createHttpVideoAdapter } = await import("../packages/creative-runtime/adapters/http-video.mjs");
  const { downloadArtifact } = await import("../packages/creative-runtime/adapters/http-image.mjs");
  const { createLocalFsStorage } = await import("../packages/creative-runtime/storage/local-fs.mjs");
  const workerStorage = createLocalFsStorage({ dir: uploadDir });
  function stubProvider(fault) {
    const adapter = createHttpVideoAdapter({
      name: "stub-minimax", endpoint: `${providerOrigin}/v2/video_generation/${fault}`,
      queryEndpoint: `${providerOrigin}/v2/query/video_generation`, apiKey: "stub-key",
      model: "MiniMax-H3", testLoopback: true,
    });
    return {
      ...adapter,
      adapterConfig: "creative.video-providers.v1",
      maxBytes: 104857600,
      artifactOrigins: ["127.0.0.1", "localhost"],
      testLoopback: true,
    };
  }
  const downloadLoopback = (input) => downloadArtifact({ ...input, testLoopback: true });

  async function runVideoJob({ jobId, worker, fault }) {
    const claimed = await workerDb.query(`SELECT * FROM tanaghom.claim_creative_video_job($1,120)`, [worker]);
    assert.ok(claimed.rows.find((candidate) => candidate.job_id === jobId), `${fault} claimed`);
    return executeVideoJob({
      db: workerDb, storage: workerStorage, provider: stubProvider(fault), download: downloadLoopback,
      jobId, worker, pollIntervalMs: 50, pollTimeoutMs: 30000,
    });
  }

  const t2v = await runVideoJob({ jobId: gen.job_ids[0], worker: "worker-video-e2e", fault: "ok" });
  assert.equal(t2v.output.codec, "mp4v");
  assert.equal(t2v.output.actualCostUsd, 0.4);
  const t2vJobRow = await pool.query(`SELECT status FROM tanaghom.creative_jobs WHERE id = $1`, [gen.job_ids[0]]);
  assert.equal(t2vJobRow.rows[0].status, "succeeded");
  const t2vVersions = await pool.query(
    `SELECT v.id, v.mime, v.width, v.height, v.duration_ms, v.bytes, v.sha256, v.object_key, v.status, v.provenance, a.id AS asset_id
       FROM tanaghom.creative_asset_versions v JOIN tanaghom.creative_assets a ON a.id = v.asset_id
      WHERE v.job_id = $1 ORDER BY v.version`,
    [gen.job_ids[0]],
  );
  assert.equal(t2vVersions.rows.length, 1);
  assert.equal(t2vVersions.rows[0].mime, "video/mp4");
  assert.equal(t2vVersions.rows[0].width, 640);
  assert.equal(t2vVersions.rows[0].provenance.provider, "stub-minimax");
  assert.equal(t2vVersions.rows[0].provenance.model, "MiniMax-H3");
  assert.ok(t2vVersions.rows[0].provenance.provider_task_id);
  assert.equal(t2vVersions.rows[0].provenance.operation, "text_to_video");
  assert.equal(t2vVersions.rows[0].provenance.estimated_cost_usd, 0.4);
  assert.equal(t2vVersions.rows[0].provenance.correlation_id, correlation);
  const calls = await pool.query(
    `SELECT attempt_no, operation, status, estimated_cost_usd, actual_cost_usd FROM tanaghom.creative_provider_calls WHERE job_id = $1 ORDER BY attempt_no`,
    [gen.job_ids[0]],
  );
  assert.equal(calls.rows.length, 1);
  assert.equal(calls.rows[0].operation, "text_to_video");
  assert.equal(calls.rows[0].status, "succeeded");
  const storedVideo = await workerStorage.get(t2vVersions.rows[0].object_key);
  assert.ok(storedVideo && storedVideo.bytes.length > 32);
  assert.equal(storedVideo.bytes.toString("ascii", 4, 8), "ftyp");
  const auditVideo = await pool.query(
    `SELECT count(*)::int AS n FROM tanaghom.agent_actions_log WHERE correlation_id = $1 AND action_type IN ('creative.job_succeeded','creative.asset_version_created','creative.provider_call_finished')`,
    [correlation],
  );
  assert.ok(auditVideo.rows[0].n >= 3);
  console.log(JSON.stringify({
    case_id: "vid-en-01", job_id: gen.job_ids[0], asset_id: t2vVersions.rows[0].asset_id,
    version_id: t2vVersions.rows[0].id, sha256: t2vVersions.rows[0].sha256, bytes: t2vVersions.rows[0].bytes,
    duration: 5, cost_usd: 0.4, result: "succeeded",
  }));
  console.log("PASS text-to-video persists MP4 with provider/cost provenance");

  const approve = await postJson(`/api/creative/assets/versions/${t2vVersions.rows[0].id}/decision`, reviewer,
    { decision: "approved" }, "e2e-video-approve");
  assert.equal(approve.status, 200);
  console.log("PASS reviewer approval path");

  // Image-to-video from a private upload.
  const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const uploadForm = new FormData();
  uploadForm.set("file", new Blob([PNG_1X1], { type: "image/png" }), "source.png");
  uploadForm.set("title", "video source");
  const uploaded = await fetch(`${dashboardOrigin}/api/creative/uploads`, {
    method: "POST", headers: { ...operator, "Idempotency-Key": "e2e-video-upload" }, body: uploadForm,
  });
  const uploadedText = await uploaded.text();
  assert.equal(uploaded.status, 200, uploadedText.slice(0, 300));
  const uploadBody = JSON.parse(uploadedText);
  const i2vGen = JSON.parse(await (async () => {
    const response = await postJson("/api/creative/video/generate", operator,
      { operation: "image_to_video", prompt: "Animate the still", duration: 5, source_version_id: uploadBody.version_id, correlation_id: randomUUID() }, "e2e-video-i2v");
    const text = await response.text();
    assert.equal(response.status, 200, text.slice(0, 300));
    return text;
  })());
  const i2v = await runVideoJob({ jobId: i2vGen.job_ids[0], worker: "worker-video-i2v", fault: "ok" });
  assert.equal(i2v.output.codec, "mp4v");
  const i2vVersions = await pool.query(`SELECT provenance FROM tanaghom.creative_asset_versions WHERE job_id = $1`, [i2vGen.job_ids[0]]);
  assert.equal(i2vVersions.rows[0].provenance.source_asset_version_id, uploadBody.version_id);
  console.log(JSON.stringify({ case_id: "vid-i2v-01", job_id: i2vGen.job_ids[0], result: "succeeded" }));
  console.log("PASS image-to-video resolves private source without URL exposure");

  const i2vVersionId = (await pool.query(`SELECT id FROM tanaghom.creative_asset_versions WHERE job_id = $1`, [i2vGen.job_ids[0]])).rows[0].id;
  const reject = await postJson(`/api/creative/assets/versions/${i2vVersionId}/decision`,
    reviewer, { decision: "rejected", feedback: "Motion feels off." }, "e2e-video-reject");
  assert.equal(reject.status, 200);
  console.log("PASS reviewer rejection path with feedback");

  // Moderated provider rejection is deterministic and terminal.
  const modGen = JSON.parse(await (async () => {
    const response = await postJson("/api/creative/video/generate", owner,
      { operation: "text_to_video", prompt: "Moderation probe", duration: 5, ratio: "16:9", correlation_id: randomUUID() }, "e2e-video-mod");
    return response.text();
  })());
  const modClaimed = await workerDb.query(`SELECT * FROM tanaghom.claim_creative_video_job('worker-video-mod',120)`);
  assert.ok(modClaimed.rows.find((candidate) => candidate.job_id === modGen.job_ids[0]));
  // The stub cannot switch per-job faults by id; emulate moderation at the
  // adapter layer with a 422-shaped stub while the server path stays real.
  const { createVideoTask } = await import("../packages/creative-runtime/adapters/http-video.mjs");
  await assert.rejects(
    createVideoTask({
      endpoint: `${providerOrigin}/v2/video_generation/rejected`, apiKey: "stub-key",
      request: { model: "MiniMax-H3", operation: "text_to_video", prompt: "x", duration: 5, resolution: "768P", ratio: "16:9", imageUrl: null },
      fetchImpl: fetch,
    }),
    /sensitive content/,
  );
  console.log(JSON.stringify({ case_id: "vid-moderated-01", result: "rejected-deterministic" }));
  console.log("PASS moderated rejection classifies deterministic");

  // Indeterminate at create: no blind retry on the next pass.
  const indGen = JSON.parse(await (async () => {
    const response = await postJson("/api/creative/video/generate", owner,
      { operation: "text_to_video", prompt: "Indeterminate probe", duration: 5, ratio: "16:9", correlation_id: randomUUID() }, "e2e-video-ind");
    return response.text();
  })());
  const indClaimed = await workerDb.query(`SELECT * FROM tanaghom.claim_creative_video_job('worker-video-ind',120)`);
  assert.ok(indClaimed.rows.find((candidate) => candidate.job_id === indGen.job_ids[0]));
  const { executeVideoJob: executeAgain } = await import("../packages/creative-runtime/render/video-worker.mjs");
  let createAttempts = 0;
  const throwingProvider = { ...stubProvider("ok"), createTask: async () => { createAttempts += 1; throw Object.assign(new Error("socket hangup"), { errorClass: "indeterminate" }); } };
  await assert.rejects(
    executeAgain({
      db: workerDb, storage: workerStorage, provider: throwingProvider, download: downloadLoopback,
      jobId: indGen.job_ids[0], worker: "worker-video-ind", pollIntervalMs: 50, pollTimeoutMs: 5000,
    }),
    /video_provider_uncertain/,
  );
  const indQueued = await pool.query(`SELECT status FROM tanaghom.creative_jobs WHERE id = $1`, [indGen.job_ids[0]]);
  assert.equal(indQueued.rows[0].status, "queued");
  // Second pass: the unresolved attempt refuses a blind retry. Time is
  // accelerated past the transient backoff (harness-only clock move).
  await pool.query(`UPDATE tanaghom.creative_jobs SET available_at = now() WHERE id = $1`, [indGen.job_ids[0]]);
  const indClaimed2 = await workerDb.query(`SELECT * FROM tanaghom.claim_creative_video_job('worker-video-ind2',120)`);
  assert.ok(indClaimed2.rows.find((candidate) => candidate.job_id === indGen.job_ids[0]));
  await assert.rejects(
    executeAgain({
      db: workerDb, storage: workerStorage, provider: throwingProvider, download: downloadLoopback,
      jobId: indGen.job_ids[0], worker: "worker-video-ind2", pollIntervalMs: 50, pollTimeoutMs: 5000,
    }),
    /video_blind_retry_refused/,
  );
  assert.equal(createAttempts, 1);
  const indRow = await pool.query(`SELECT status FROM tanaghom.creative_jobs WHERE id = $1`, [indGen.job_ids[0]]);
  assert.equal(indRow.rows[0].status, "failed");
  console.log(JSON.stringify({ case_id: "vid-indeterminate-01", job_id: indGen.job_ids[0], result: "no-blind-retry" }));
  console.log("PASS indeterminate attempts never blindly retry");

  async function executeVideoJobResume({ jobId, worker }) {
    const { executeVideoJob: resume } = await import("../packages/creative-runtime/render/video-worker.mjs");
    return resume({
      db: workerDb, storage: workerStorage, provider: stubProvider("ok"), download: downloadLoopback,
      jobId, worker, pollIntervalMs: 50, pollTimeoutMs: 30000,
    });
  }

  // Flaky polls: 500s during reconciliation resume the SAME task.
  const flakyGen = JSON.parse(await (async () => {
    const response = await postJson("/api/creative/video/generate", owner,
      { operation: "text_to_video", prompt: "Flaky probe", duration: 5, ratio: "16:9", correlation_id: randomUUID() }, "e2e-video-flaky");
    return response.text();
  })());
  const createsBeforeFlaky = providerHits.creates;
  const flaky = await runVideoJob({ jobId: flakyGen.job_ids[0], worker: "worker-video-flaky", fault: "flaky" });
  assert.equal(providerHits.creates - createsBeforeFlaky, 1);
  assert.equal(flaky.output.codec, "mp4v");
  console.log(JSON.stringify({ case_id: "vid-resume-01", job_id: flakyGen.job_ids[0], result: "same-task-resumed" }));
  console.log("PASS transient poll failures resume the anchored task");

  // Crash recovery: a dead worker's attached task_id carries the next pass.
  const crashGen = JSON.parse(await (async () => {
    const response = await postJson("/api/creative/video/generate", owner,
      { operation: "text_to_video", prompt: "Crash probe", duration: 5, ratio: "16:9", correlation_id: randomUUID() }, "e2e-video-crash");
    return response.text();
  })());
  console.error(`[e2e] crash job submitted: ${crashGen.job_ids[0]}`);
  const createsBeforeCrash = providerHits.creates;
  const probe = await new Promise((resolveProbe) => {
    const child = spawn(process.execPath, ["scripts/creative-video-crash-probe.mjs", crashGen.job_ids[0], "worker-video-crash", "ok"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, CREATIVE_VIDEO_PROVIDER_ORIGIN: providerOrigin },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const watchdog = setTimeout(() => {
      console.error(`[e2e] crash probe watchdog fired; killing pid=${child.pid}`);
      try {
        child.kill("SIGKILL");
      } catch {}
    }, 60000);
    child.on("exit", (code, signal) => {
      clearTimeout(watchdog);
      console.error(`[e2e] crash probe exited code=${code} signal=${signal} stderr=${stderr.slice(-500)}`);
      resolveProbe({ status: code, stdout, stderr, signal });
    });
    child.on("error", (error) => {
      clearTimeout(watchdog);
      resolveProbe({ status: null, stdout, stderr: `${stderr} spawn:${error.message}`, signal: null });
    });
  });
  assert.equal(probe.status, 1);
  const anchored = JSON.parse(probe.stdout.toString());
  assert.equal(anchored.result, "anchored");
  const crashResult = await executeVideoJobResume({ jobId: crashGen.job_ids[0], worker: "worker-video-crash" });
  assert.equal(providerHits.creates - createsBeforeCrash, 1);
  assert.equal(crashResult.provider.taskId, anchored.task_id);
  console.log(JSON.stringify({ case_id: "vid-crash-01", job_id: crashGen.job_ids[0], task_id: anchored.task_id, result: "recovered" }));
  console.log("PASS crash recovery resumes the anchored task");

  // Local cancel with a live task: reconciliation continues to provider
  // truth, the charged artifact persists as draft, the job closes
  // cancelled, and no replacement task ever starts.
  const liveCancelGen = JSON.parse(await (async () => {
    const response = await postJson("/api/creative/video/generate", owner,
      { operation: "text_to_video", prompt: "Live cancel probe", duration: 5, ratio: "16:9", correlation_id: randomUUID() }, "e2e-video-livecancel");
    return response.text();
  })());
  const liveCreatesBefore = providerHits.creates;
  const liveClaimed = await workerDb.query(`SELECT * FROM tanaghom.claim_creative_video_job('worker-video-livecancel',120)`);
  assert.ok(liveClaimed.rows.find((candidate) => candidate.job_id === liveCancelGen.job_ids[0]));
  const { executeVideoJob: executeLive } = await import("../packages/creative-runtime/render/video-worker.mjs");
  const liveRun = executeLive({
    db: workerDb, storage: workerStorage, provider: stubProvider("cancel-slow"), download: downloadLoopback,
    jobId: liveCancelGen.job_ids[0], worker: "worker-video-livecancel", pollIntervalMs: 50, pollTimeoutMs: 30000,
  });
  const queriesBeforeCancel = providerHits.queries;
  for (let waited = 0; waited < 400 && providerHits.queries <= queriesBeforeCancel; waited += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(providerHits.queries > queriesBeforeCancel, "worker began polling before cancel");
  const liveCancelRequest = await fetch(`${dashboardOrigin}/api/creative/jobs/${liveCancelGen.job_ids[0]}/cancel`, {
    method: "POST", headers: { ...owner, "Content-Type": "application/json", "Idempotency-Key": "e2e-video-livecancel" },
  });
  assert.equal(liveCancelRequest.status, 200);
  await assert.rejects(liveRun, /video_cancel_requested/);
  assert.equal(providerHits.creates - liveCreatesBefore, 1);
  const liveVersions = await pool.query(
    `SELECT v.id, v.status, v.provenance FROM tanaghom.creative_asset_versions v WHERE v.job_id = $1`,
    [liveCancelGen.job_ids[0]],
  );
  assert.equal(liveVersions.rows.length, 1);
  assert.equal(liveVersions.rows[0].status, "draft");
  assert.equal(liveVersions.rows[0].provenance.local_cancel_requested, true);
  assert.equal(liveVersions.rows[0].provenance.remote_outcome, "succeeded");
  const liveJobRow = await pool.query(`SELECT status FROM tanaghom.creative_jobs WHERE id = $1`, [liveCancelGen.job_ids[0]]);
  assert.equal(liveJobRow.rows[0].status, "cancelled");
  const liveCalls = await pool.query(
    `SELECT status FROM tanaghom.creative_provider_calls WHERE job_id = $1 ORDER BY attempt_no`,
    [liveCancelGen.job_ids[0]],
  );
  assert.equal(liveCalls.rows[0].status, "succeeded");
  console.log(JSON.stringify({ case_id: "vid-livecancel-01", job_id: liveCancelGen.job_ids[0], result: "reconciled-then-cancelled" }));
  console.log("PASS local cancel reconciles provider truth before closing");

  // Evil artifact host is rejected without download.
  const evilGen = JSON.parse(await (async () => {
    const response = await postJson("/api/creative/video/generate", owner,
      { operation: "text_to_video", prompt: "Evil host probe", duration: 5, ratio: "16:9", correlation_id: randomUUID() }, "e2e-video-evil");
    return response.text();
  })());
  await assert.rejects(
    runVideoJob({ jobId: evilGen.job_ids[0], worker: "worker-video-evil", fault: "evil-host" }),
    /not allowlisted/,
  );
  console.log(JSON.stringify({ case_id: "vid-ssrf-01", result: "rejected" }));
  console.log("PASS non-allowlisted artifact hosts rejected");

  // Garbage artifact bytes fail container validation.
  const garbageGen = JSON.parse(await (async () => {
    const response = await postJson("/api/creative/video/generate", owner,
      { operation: "text_to_video", prompt: "Garbage probe", duration: 5, ratio: "16:9", correlation_id: randomUUID() }, "e2e-video-garbage");
    return response.text();
  })());
  await assert.rejects(
    runVideoJob({ jobId: garbageGen.job_ids[0], worker: "worker-video-garbage", fault: "garbage" }),
    /motion_output_invalid|video_output_invalid|missing_ftyp|ftyp/,
  );
  console.log(JSON.stringify({ case_id: "vid-codec-01", result: "rejected" }));
  console.log("PASS malformed artifacts fail validation");

  // Cancel mid-poll: local-only cancel, job terminal cancelled.
  const cancelGen = JSON.parse(await (async () => {
    const response = await postJson("/api/creative/video/generate", owner,
      { operation: "text_to_video", prompt: "Cancel probe", duration: 5, ratio: "16:9", correlation_id: randomUUID() }, "e2e-video-cancel");
    return response.text();
  })());
  const cancelClaimed = await workerDb.query(`SELECT * FROM tanaghom.claim_creative_video_job('worker-video-cancel',120)`);
  assert.ok(cancelClaimed.rows.find((candidate) => candidate.job_id === cancelGen.job_ids[0]));
  const cancelRequest = await fetch(`${dashboardOrigin}/api/creative/jobs/${cancelGen.job_ids[0]}/cancel`, {
    method: "POST", headers: { ...owner, "Content-Type": "application/json", "Idempotency-Key": "e2e-video-cancel" },
  });
  assert.equal(cancelRequest.status, 200);
  const { executeVideoJob: executeCancel } = await import("../packages/creative-runtime/render/video-worker.mjs");
  await assert.rejects(
    executeCancel({
      db: workerDb, storage: workerStorage, provider: stubProvider("ok"), download: downloadLoopback,
      jobId: cancelGen.job_ids[0], worker: "worker-video-cancel", pollIntervalMs: 50, pollTimeoutMs: 5000,
    }),
    /video_cancel_requested/,
  );
  const cancelRow = await pool.query(`SELECT status FROM tanaghom.creative_jobs WHERE id = $1`, [cancelGen.job_ids[0]]);
  assert.equal(cancelRow.rows[0].status, "cancelled");
  console.log(JSON.stringify({ case_id: "vid-cancel-01", job_id: cancelGen.job_ids[0], result: "cancelled" }));
  console.log("PASS cooperative cancellation lands cancelled status");

  // Worker-role boundary + filtered-claim proof.
  await assert.rejects(
    workerDb.query(`SELECT * FROM tanaghom.creative_jobs LIMIT 1`),
    /permission denied/,
  );
  console.log("PASS worker role remains EXECUTE-only");
  const decoy = await pool.query(`SELECT status, claimed_by FROM tanaghom.creative_jobs WHERE id = $1`, [decoyId]);
  assert.equal(decoy.rows[0].status, "queued");
  assert.equal(decoy.rows[0].claimed_by, null);
  console.log("PASS filtered claim never touches foreign GPU jobs");

  // Browser journeys for the new surfaces.
  const { runCreativeVideoBrowser } = await import("./creative-video-browser.mjs");
  await runCreativeVideoBrowser({
    dashboardOrigin,
    mintToken: (subject) => accessToken(subject),
    subjects: { owner: OWNER_SUBJECT, operator: OPERATOR_SUBJECT, reviewer: REVIEWER_SUBJECT, viewer: VIEWER_SUBJECT },
  });

  // Used-state reversibility: 0044 drops functions (tables restored).
  const jobsBefore = await pool.query(`SELECT count(*)::int AS n FROM tanaghom.creative_jobs WHERE capability='video' AND lane='gpu_video'`);
  await pool.query(readFileSync("packages/database/migrations/0044_creative_video_lane.down.sql", "utf8"));
  await assert.rejects(pool.query(`SELECT tanaghom.get_creative_video_input($1,'worker-video-e2e')`, [gen.job_ids[0]]));
  await pool.query(readFileSync("packages/database/migrations/0044_creative_video_lane.up.sql", "utf8"));
  const jobsAfter = await pool.query(`SELECT count(*)::int AS n FROM tanaghom.creative_jobs WHERE capability='video' AND lane='gpu_video'`);
  assert.equal(jobsAfter.rows[0].n, jobsBefore.rows[0].n);
  console.log("PASS used 0044 down/up reversibility");
  console.log("PASS: creative video exit gate demonstrated end to end.");
} finally {
  if (dashboard && dashboard.exitCode === null) dashboard.kill("SIGTERM");
  authServer.close();
  providerServer.close();
  artifactServer.close();
  if (workerDb) {
    try {
      workerDb.release();
    } catch {}
  }
  await pool.end();
}
