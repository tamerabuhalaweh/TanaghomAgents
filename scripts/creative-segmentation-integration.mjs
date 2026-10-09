// P2a segmentation disposable integration. Requires DATABASE_TEST_URL
// (fresh PostgreSQL) and a built dashboard (`npm run build:dashboard`
// first). Spins a stub JWKS auth server; no providers, GPU, billing, or
// production contact. The segment worker executes under
// SET ROLE tanaghom_creative_worker (EXECUTE-only) with the
// local-deterministic engine; BiRefNet stays deployment-gated.
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
import sharp from "sharp";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required");

const uploadDir = mkdtempSync(join(tmpdir(), "segment-e2e-uploads-"));

const authPort = 43621;
const dashboardPort = 43622;
const authOrigin = `http://127.0.0.1:${authPort}`;
const dashboardOrigin = `http://127.0.0.1:${dashboardPort}`;
const OWNER_SUBJECT = "94000000-0000-4000-8000-000000000031";
const OPERATOR_SUBJECT = "94000000-0000-4000-8000-000000000033";
const REVIEWER_SUBJECT = "94000000-0000-4000-8000-000000000034";
const VIEWER_SUBJECT = "94000000-0000-4000-8000-000000000032";
const ORGB_OWNER_SUBJECT = "94000000-0000-4000-8000-000000000041";
const ORG_B_ID = "85000000-0000-4000-8000-000000000041";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = { ...await exportJWK(publicKey), kid: "creative-segment-key", alg: "RS256", use: "sig" };

// Deterministic product photo: dark product on a light backdrop.
async function productPhoto(size = 512) {
  const bg = await sharp({
    create: { width: size, height: size, channels: 3, background: { r: 240, g: 240, b: 235 } },
  }).png().toBuffer();
  const box = Math.floor(size / 3);
  const off = Math.floor((size - box) / 2);
  return sharp(bg).composite([{
    input: Buffer.from(`<svg width="${size}" height="${size}"><rect x="${off}" y="${off}" width="${box}" height="${box}" rx="24" fill="rgb(30,60,120)"/></svg>`),
  }]).png().toBuffer();
}

async function accessToken(subject) {
  return new SignJWT({ role: "authenticated", email: "segment@example.test" })
    .setProtectedHeader({ alg: "RS256", kid: "creative-segment-key" })
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
  assert.equal(latestMigration, "0045_creative_segmentation");
  await pool.query(readFileSync(`packages/database/migrations/${latestMigration}.down.sql`, "utf8"));
  console.log(`PASS unused ${latestMigration} down`);
  await pool.query(readFileSync(`packages/database/migrations/${latestMigration}.up.sql`, "utf8"));
  console.log(`PASS unused ${latestMigration} up`);
  psqlFile("packages/database/tests/creative_segment.sql");

  await pool.query(
    `INSERT INTO tanaghom.organizations (id, slug, name, is_active)
     VALUES ($1, 'segment-e2e-org-b', 'Segment E2E Org B', true) ON CONFLICT (id) DO NOTHING`,
    [ORG_B_ID],
  );
  await pool.query(
    `INSERT INTO tanaghom.app_users (id, organization_id, email, display_name, kind, role, auth_subject, accepted_at) VALUES
     ('00000000-0000-4000-8000-000000000431', '10000000-0000-4000-8000-000000000001', 'segment-owner@example.test', 'Segment Owner', 'human', 'owner', $1, now()),
     ('00000000-0000-4000-8000-000000000433', '10000000-0000-4000-8000-000000000001', 'segment-operator@example.test', 'Segment Operator', 'human', 'operator', $2, now()),
     ('00000000-0000-4000-8000-000000000434', '10000000-0000-4000-8000-000000000001', 'segment-reviewer@example.test', 'Segment Reviewer', 'human', 'reviewer', $3, now()),
     ('00000000-0000-4000-8000-000000000432', '10000000-0000-4000-8000-000000000001', 'segment-viewer@example.test', 'Segment Viewer', 'human', 'viewer', $4, now()),
     ('00000000-0000-4000-8000-000000000441', $5, 'orgb-owner@example.test', 'Org B Owner', 'human', 'owner', $6, now())
     ON CONFLICT (id) DO NOTHING`,
    [OWNER_SUBJECT, OPERATOR_SUBJECT, REVIEWER_SUBJECT, VIEWER_SUBJECT, ORG_B_ID, ORGB_OWNER_SUBJECT],
  );

  authServer.listen(authPort, "127.0.0.1");
  await once(authServer, "listening");

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

  // Flags OFF by default: segmentation refuses safely.
  await bootDashboard({});
  const ownerProbe = await bearer(OWNER_SUBJECT);
  const off = await fetch(`${dashboardOrigin}/api/creative/segment/jobs`, {
    method: "POST", headers: { ...ownerProbe, "Content-Type": "application/json", "Idempotency-Key": "e2e-segment-off" },
    body: JSON.stringify({}),
  });
  assert.equal(off.status, 503);
  console.log("PASS segment flags off by default");
  await stopDashboard();

  await bootDashboard({ CREATIVE_STUDIO_ENABLED: "true", ML_SEGMENTATION_ENABLED: "true", PRODUCT_STUDIO_ENABLED: "true", IMAGE_GENERATION_ENABLED: "true", CREATIVE_UPLOAD_DIR: uploadDir });
  await pool.query(`UPDATE tanaghom.creative_controls SET enabled=true, emergency_stop=false, reason='Disposable segment e2e'`);
  // Foreign-capability decoy: an older compose product_shoot job the
  // segment worker must never touch.
  const decoyId = (await pool.query(
    `SELECT tanaghom.create_creative_job('00000000-0000-4000-8000-000000000431','product_shoot','cpu','{"operation":"compose","preset":"clean_white"}',$1,$2,0,3) AS id`,
    [randomUUID(), randomUUID()],
  )).rows[0].id;
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

  async function uploadPng({ headers, key, filename, title }) {
    const form = new FormData();
    form.set("file", new Blob([await productPhoto()], { type: "image/png" }), filename);
    form.set("title", title);
    const response = await fetch(`${dashboardOrigin}/api/creative/uploads`, {
      method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: form,
    });
    const text = await response.text();
    assert.equal(response.status, 200, text.slice(0, 300));
    return JSON.parse(text);
  }

  const anonymous = await fetch(`${dashboardOrigin}/api/creative/segment/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "e2e-segment-anon" }, body: JSON.stringify({}),
  });
  assert.equal(anonymous.status, 401);
  for (const [headers, name] of [[viewer, "viewer"], [reviewer, "reviewer"]]) {
    const denied = await postJson("/api/creative/segment/jobs", headers,
      { source_version_id: "00000000-0000-4000-8000-000000000000", correlation_id: randomUUID() }, `e2e-segment-deny-${name}`);
    assert.equal(denied.status, 403, `segment submit ${name}`);
  }

  const uploadBody = await uploadPng({ headers: operator, key: "e2e-segment-up", filename: "product.png", title: "Segment product" });
  const badEngine = await postJson("/api/creative/segment/jobs", owner,
    { source_version_id: uploadBody.version_id, engine: "rmbg", correlation_id: randomUUID() }, "e2e-segment-bad-engine");
  assert.equal(badEngine.status, 400);
  const badRefine = await postJson("/api/creative/segment/jobs", owner,
    { source_version_id: uploadBody.version_id, refine: { feather_px: 99 }, correlation_id: randomUUID() }, "e2e-segment-bad-refine");
  assert.equal(badRefine.status, 400);
  const badSource = await postJson("/api/creative/segment/jobs", owner,
    { source_version_id: randomUUID(), correlation_id: randomUUID() }, "e2e-segment-bad-source");
  assert.equal(badSource.status, 404);

  // Cross-tenant source: org-B upload is invisible to org A.
  const orgBUpload = await (async () => {
    const form = new FormData();
    form.set("file", new Blob([await productPhoto()], { type: "image/png" }), "orgb.png");
    form.set("title", "org b photo");
    const response = await fetch(`${dashboardOrigin}/api/creative/uploads`, {
      method: "POST", headers: { ...orgBOwner, "Idempotency-Key": "e2e-segment-up-b" }, body: form,
    });
    return response.json();
  })();
  const foreignSource = await postJson("/api/creative/segment/jobs", owner,
    { source_version_id: orgBUpload.version_id, correlation_id: randomUUID() }, "e2e-segment-foreign");
  assert.equal(foreignSource.status, 404);
  console.log("PASS segment submit guards (roles, engine, refine, sources)");

  const segKey = randomUUID();
  const segCorrelation = randomUUID();
  const submitted = await postJson("/api/creative/segment/jobs", owner,
    { source_version_id: uploadBody.version_id, engine: "local-deterministic", refine: { feather_px: 1 }, correlation_id: segCorrelation }, segKey);
  const submittedText = await submitted.text();
  assert.equal(submitted.status, 200, submittedText.slice(0, 300));
  const segJob = JSON.parse(submittedText);
  assert.ok(segJob.job_id);
  const replayed = await postJson("/api/creative/segment/jobs", owner,
    { source_version_id: uploadBody.version_id, engine: "local-deterministic", refine: { feather_px: 1 }, correlation_id: segCorrelation }, segKey);
  assert.equal(replayed.status, 200);
  assert.equal((await replayed.json()).job_id, segJob.job_id);
  assert.equal(replayed.headers.get("Idempotency-Replayed"), "true");
  console.log("PASS segment submit + idempotency replay");

  // Runtime segment worker under the least-privilege role.
  const { executeSegmentJob } = await import("../packages/creative-runtime/render/segment-worker.mjs");
  const { createLocalFsStorage } = await import("../packages/creative-runtime/storage/local-fs.mjs");
  const workerStorage = createLocalFsStorage({ dir: uploadDir });
  const claimed = await workerDb.query(`SELECT * FROM tanaghom.claim_creative_segment_job('worker-segment-e2e',120)`);
  assert.ok(claimed.rows.find((candidate) => candidate.job_id === segJob.job_id));
  const segResult = await executeSegmentJob({ db: workerDb, storage: workerStorage, jobId: segJob.job_id, worker: "worker-segment-e2e" });
  const segJobRow = await pool.query(`SELECT status, output_asset_ids FROM tanaghom.creative_jobs WHERE id = $1`, [segJob.job_id]);
  assert.equal(segJobRow.rows[0].status, "succeeded");
  assert.equal(segJobRow.rows[0].output_asset_ids.length, 1);
  const segVersions = await pool.query(
    `SELECT v.id, v.version, v.mime, v.width, v.height, v.bytes, v.sha256, v.object_key, v.status, v.provenance, a.id AS asset_id
       FROM tanaghom.creative_asset_versions v JOIN tanaghom.creative_assets a ON a.id = v.asset_id
      WHERE v.job_id = $1 ORDER BY v.version`,
    [segJob.job_id],
  );
  assert.equal(segVersions.rows.length, 2);
  assert.equal(segVersions.rows[0].mime, "image/png");
  assert.equal(segVersions.rows[0].provenance.kind, "mask");
  assert.equal(segVersions.rows[0].provenance.engine, "local-deterministic");
  assert.equal(segVersions.rows[0].provenance.source_asset_version_id, uploadBody.version_id);
  assert.equal(segVersions.rows[0].provenance.correlation_id, segCorrelation);
  assert.equal(segVersions.rows[1].provenance.kind, "cutout");
  assert.equal(segVersions.rows[1].provenance.mask_version_id, segVersions.rows[0].id);
  assert.deepEqual(segVersions.rows.map((row) => row.asset_id), [segVersions.rows[0].asset_id, segVersions.rows[0].asset_id]);
  const storedMask = await workerStorage.get(segVersions.rows[0].object_key);
  assert.equal(storedMask.bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const auditSeg = await pool.query(
    `SELECT count(*)::int AS n FROM tanaghom.agent_actions_log WHERE correlation_id = $1 AND action_type IN ('creative.job_succeeded','creative.asset_version_created')`,
    [segCorrelation],
  );
  assert.ok(auditSeg.rows[0].n >= 3);
  console.log(JSON.stringify({
    case_id: "seg-local-01", job_id: segJob.job_id, asset_id: segVersions.rows[0].asset_id,
    mask_version_id: segVersions.rows[0].id, cutout_version_id: segVersions.rows[1].id,
    mask_sha256: segVersions.rows[0].sha256, cutout_sha256: segVersions.rows[1].sha256,
    width: segVersions.rows[0].width, result: "succeeded",
  }));
  console.log("PASS segment worker persists mask v1 + cutout v2 with lineage");

  // Cutout feeds Product Studio scene composition with the local pipeline.
  const { localSharpAdapter } = await import("../packages/creative-runtime/adapters/local-sharp.mjs");
  const { sha256Hex } = await import("../packages/creative-runtime/storage/keys.mjs");
  const cutoutPreview = await fetch(`${dashboardOrigin}/api/creative/assets/versions/${segVersions.rows[1].id}/preview`, { headers: owner });
  assert.equal(cutoutPreview.status, 200);
  const cutoutBytes = Buffer.from(await cutoutPreview.arrayBuffer());
  const sceneSubmit = await postJson("/api/creative/product/generate", operator,
    { source_version_id: segVersions.rows[1].id, preset: "clean_white" }, "e2e-segment-scene");
  assert.equal(sceneSubmit.status, 200);
  const sceneJobId = (await sceneSubmit.json()).job_id;
  // Priority bump (harness-only clock/queue control) so the generic CPU
  // claim deterministically picks the scene job ahead of the decoy.
  await pool.query(`UPDATE tanaghom.creative_jobs SET priority = 100 WHERE id = $1`, [sceneJobId]);
  const sceneClaimed = await workerDb.query(`SELECT * FROM tanaghom.claim_creative_job('cpu','worker-segment-scene',120)`);
  assert.ok(sceneClaimed.rows.find((candidate) => candidate.job_id === sceneJobId));
  await workerDb.query(`SELECT tanaghom.mark_creative_job_running($1,'worker-segment-scene')`, [sceneJobId]);
  const scene = await localSharpAdapter.execute({
    operation: "compose", foregroundBytes: cutoutBytes,
    preset: { code: "clean_white", background: { kind: "solid", color: "#ffffff" }, relight: { brightness: 1.0, saturation: 1.0 }, output: { width: 512, height: 512 } },
  });
  const sceneKey = `t/10000000-0000-4000-8000-000000000001/product_shoot/${sceneJobId}/v1.png`;
  await workerStorage.put(sceneKey, scene.bytes, "image/png");
  const sceneVersionId = (await workerDb.query(
    `SELECT tanaghom.create_creative_asset_version($1,'worker-segment-scene',NULL,'Cutout scene','image/png',512,512,NULL,$2::bigint,$3,$4,NULL,$5,NULL,NULL,'composite') AS id`,
    [sceneJobId, scene.bytes.length, sha256Hex(scene.bytes), sceneKey, JSON.stringify(scene.provenance)],
  )).rows[0].id;
  const sceneDone = await workerDb.query(`SELECT tanaghom.complete_creative_job($1,'worker-segment-scene',$2,NULL) AS s`, [sceneJobId, sceneVersionId]);
  assert.equal(sceneDone.rows[0].s, "succeeded");
  console.log(JSON.stringify({ case_id: "seg-product-01", job_id: sceneJobId, version_id: sceneVersionId, result: "succeeded" }));
  console.log("PASS Product Studio composes the segment cutout");

  // Fidelity review + approval on the cutout.
  const fidelity = await postJson(`/api/creative/assets/versions/${segVersions.rows[1].id}/fidelity`, reviewer,
    { checklist: { logo: "pass", package_text: "pass", shape: "pass", proportions: "pass", primary_colors: "pass", markings: "unreviewed" }, overall: "passed" }, "e2e-segment-fid");
  assert.equal(fidelity.status, 200);
  const approve = await postJson(`/api/creative/assets/versions/${segVersions.rows[1].id}/decision`, reviewer,
    { decision: "approved" }, "e2e-segment-approve");
  assert.equal(approve.status, 200);
  const viewerDecide = await postJson(`/api/creative/assets/versions/${segVersions.rows[1].id}/decision`, viewer,
    { decision: "rejected", feedback: "x" }, "e2e-segment-viewer-decide");
  assert.equal(viewerDecide.status, 403);
  console.log("PASS fidelity review + approval path with role enforcement");

  // Cancellation lands cancelled without persistence.
  const cancelGen = await postJson("/api/creative/segment/jobs", owner,
    { source_version_id: uploadBody.version_id, correlation_id: randomUUID() }, "e2e-segment-cancel-create");
  const cancelJobId = (await cancelGen.json()).job_id;
  const cancelClaimed = await workerDb.query(`SELECT * FROM tanaghom.claim_creative_segment_job('worker-segment-cancel',120)`);
  assert.ok(cancelClaimed.rows.find((candidate) => candidate.job_id === cancelJobId));
  const cancelRequest = await fetch(`${dashboardOrigin}/api/creative/jobs/${cancelJobId}/cancel`, {
    method: "POST", headers: { ...owner, "Content-Type": "application/json", "Idempotency-Key": "e2e-segment-cancel" },
  });
  assert.equal(cancelRequest.status, 200);
  await assert.rejects(
    executeSegmentJob({ db: workerDb, storage: workerStorage, jobId: cancelJobId, worker: "worker-segment-cancel" }),
    /segment_cancel_requested/,
  );
  const cancelRow = await pool.query(`SELECT status FROM tanaghom.creative_jobs WHERE id = $1`, [cancelJobId]);
  assert.equal(cancelRow.rows[0].status, "cancelled");
  console.log(JSON.stringify({ case_id: "seg-cancel-01", job_id: cancelJobId, result: "cancelled" }));
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
  console.log("PASS filtered claim never touches compose jobs");

  // Browser journeys for the surfaces.
  const { runCreativeSegmentationBrowser } = await import("./creative-segmentation-browser.mjs");
  await runCreativeSegmentationBrowser({
    dashboardOrigin,
    mintToken: (subject) => accessToken(subject),
    subjects: { owner: OWNER_SUBJECT, operator: OPERATOR_SUBJECT, reviewer: REVIEWER_SUBJECT, viewer: VIEWER_SUBJECT },
  });

  // Used-state reversibility: 0045 drops functions (vocabulary restored).
  const jobsBefore = await pool.query(`SELECT count(*)::int AS n FROM tanaghom.creative_jobs WHERE capability='product_shoot' AND lane='cpu'`);
  await pool.query(readFileSync("packages/database/migrations/0045_creative_segmentation.down.sql", "utf8"));
  await assert.rejects(pool.query(`SELECT tanaghom.get_creative_segment_input($1,'worker-segment-e2e')`, [segJob.job_id]));
  await pool.query(readFileSync("packages/database/migrations/0045_creative_segmentation.up.sql", "utf8"));
  const jobsAfter = await pool.query(`SELECT count(*)::int AS n FROM tanaghom.creative_jobs WHERE capability='product_shoot' AND lane='cpu'`);
  assert.equal(jobsAfter.rows[0].n, jobsBefore.rows[0].n);
  console.log("PASS used 0045 down/up reversibility");
  console.log("PASS: creative segmentation exit gate demonstrated end to end.");
} finally {
  if (dashboard && dashboard.exitCode === null) dashboard.kill("SIGTERM");
  authServer.close();
  if (workerDb) {
    try {
      workerDb.release();
    } catch {}
  }
  await pool.end();
}
