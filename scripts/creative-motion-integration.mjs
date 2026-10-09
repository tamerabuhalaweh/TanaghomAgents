// P3 motion disposable integration. Requires DATABASE_TEST_URL (fresh
// PostgreSQL), a built dashboard (`npm run build:dashboard` first), and a
// deployment-style ffmpeg on PATH (E2E evidence only, never bundled).
// Spins a stub JWKS auth server; no providers, GPU, billing, credentials,
// or production contact. The motion worker executes under
// SET ROLE tanaghom_creative_worker (EXECUTE-only).
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

const uploadDir = mkdtempSync(join(tmpdir(), "motion-e2e-uploads-"));

const authPort = 43421;
const dashboardPort = 43422;
const authOrigin = `http://127.0.0.1:${authPort}`;
const dashboardOrigin = `http://127.0.0.1:${dashboardPort}`;
const OWNER_SUBJECT = "92000000-0000-4000-8000-000000000031";
const OPERATOR_SUBJECT = "92000000-0000-4000-8000-000000000033";
const REVIEWER_SUBJECT = "92000000-0000-4000-8000-000000000034";
const VIEWER_SUBJECT = "92000000-0000-4000-8000-000000000032";
const ORGB_OWNER_SUBJECT = "92000000-0000-4000-8000-000000000041";
const ORG_B_ID = "83000000-0000-4000-8000-000000000041";
const PRODUCT_PROMO = "a1000000-0000-4000-8000-000000000001";
const CAROUSEL_EDU = "a1000000-0000-4000-8000-000000000006";
const MOTION_AR_FADE = "b1000000-0000-4000-8000-000000000001";
const MOTION_AR_STORY = "b1000000-0000-4000-8000-000000000003";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = { ...await exportJWK(publicKey), kid: "creative-motion-key", alg: "RS256", use: "sig" };

async function accessToken(subject) {
  return new SignJWT({ role: "authenticated", email: "motion@example.test" })
    .setProtectedHeader({ alg: "RS256", kid: "creative-motion-key" })
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
  assert.equal(latestMigration, "0040_creative_motion_render");
  await pool.query(readFileSync(`packages/database/migrations/${latestMigration}.down.sql`, "utf8"));
  console.log(`PASS unused ${latestMigration} down`);
  await pool.query(readFileSync(`packages/database/migrations/${latestMigration}.up.sql`, "utf8"));
  console.log(`PASS unused ${latestMigration} up`);
  psqlFile("packages/database/tests/creative_motion.sql");
  psqlFile("packages/database/seeds/creative_templates.sql");
  psqlFile("packages/database/seeds/creative_motion_templates.sql");
  const globals = await pool.query(`SELECT count(*)::int AS n FROM tanaghom.creative_templates WHERE organization_id IS NULL AND kind = 'motion'`);
  assert.equal(globals.rows[0].n, 3);
  console.log("PASS motion seed starters readable");

  await pool.query(
    `INSERT INTO tanaghom.organizations (id, slug, name, is_active)
     VALUES ($1, 'motion-e2e-org-b', 'Motion E2E Org B', true) ON CONFLICT (id) DO NOTHING`,
    [ORG_B_ID],
  );
  await pool.query(
    `INSERT INTO tanaghom.app_users (id, organization_id, email, display_name, kind, role, auth_subject, accepted_at) VALUES
     ('00000000-0000-4000-8000-000000000231', '10000000-0000-4000-8000-000000000001', 'motion-owner@example.test', 'Motion Owner', 'human', 'owner', $1, now()),
     ('00000000-0000-4000-8000-000000000233', '10000000-0000-4000-8000-000000000001', 'motion-operator@example.test', 'Motion Operator', 'human', 'operator', $2, now()),
     ('00000000-0000-4000-8000-000000000234', '10000000-0000-4000-8000-000000000001', 'motion-reviewer@example.test', 'Motion Reviewer', 'human', 'reviewer', $3, now()),
     ('00000000-0000-4000-8000-000000000232', '10000000-0000-4000-8000-000000000001', 'motion-viewer@example.test', 'Motion Viewer', 'human', 'viewer', $4, now()),
     ('00000000-0000-4000-8000-000000000241', $5, 'orgb-owner@example.test', 'Org B Owner', 'human', 'owner', $6, now())
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

  // Flags OFF by default: motion creation refuses safely.
  await bootDashboard({});
  const ownerProbe = await bearer(OWNER_SUBJECT);
  const off = await fetch(`${dashboardOrigin}/api/creative/motions`, {
    method: "POST", headers: { ...ownerProbe, "Content-Type": "application/json", "Idempotency-Key": "e2e-motion-off" },
    body: JSON.stringify({}),
  });
  assert.equal(off.status, 503);
  console.log("PASS motion flags off by default");
  await stopDashboard();

  await bootDashboard({ CREATIVE_STUDIO_ENABLED: "true", MOTION_STUDIO_ENABLED: "true", CREATIVE_UPLOAD_DIR: uploadDir });
  await pool.query(`UPDATE tanaghom.creative_controls SET enabled=true, emergency_stop=false, reason='Disposable motion e2e'`);
  // Foreign-capability decoy: an older design CPU job the motion worker
  // must never touch.
  const decoyId = (await pool.query(
    `SELECT tanaghom.create_creative_job('00000000-0000-4000-8000-000000000231','design','cpu','{}',$1,$2,0,3) AS id`,
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

  const anonymous = await fetch(`${dashboardOrigin}/api/creative/motions`, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "e2e-motion-anon" }, body: JSON.stringify({}),
  });
  assert.equal(anonymous.status, 401);
  for (const [headers, name] of [[viewer, "viewer"], [operator, "operator"]]) {
    const denied = await postJson("/api/creative/motions", headers,
      { name: "x", design_template_id: PRODUCT_PROMO, spec: {} }, `e2e-motion-deny-${name}`);
    assert.equal(denied.status, 403, `motion create ${name}`);
  }

  const arSpec = {
    locale: "ar", direction: "rtl", fps: 24,
    scenes: [{ id: "scene-1", page_id: "page-1", duration_ms: 2000, transition: { preset: "fade", duration_ms: 500 } }],
    elements: [
      { node_id: "headline-1", preset: "slide", direction: "start", delay_ms: 0, duration_ms: 800, easing: "ease-out" },
      { node_id: "body-1", preset: "fade", delay_ms: 300, duration_ms: 800 },
      { node_id: "cta-1", preset: "scale", delay_ms: 600, duration_ms: 600 },
    ],
  };
  const createKey = randomUUID();
  const created = await postJson("/api/creative/motions", owner,
    { name: "حركة عربية", design_template_id: PRODUCT_PROMO, spec: arSpec }, createKey);
  const createdText = await created.text();
  assert.equal(created.status, 200, createdText.slice(0, 300));
  const motion = JSON.parse(createdText);
  assert.equal(motion.ok, true);
  assert.ok(motion.template_id);
  const replayed = await postJson("/api/creative/motions", owner,
    { name: "حركة عربية", design_template_id: PRODUCT_PROMO, spec: arSpec }, createKey);
  assert.equal(replayed.status, 200);
  assert.equal((await replayed.json()).template_id, motion.template_id);
  assert.equal(replayed.headers.get("Idempotency-Replayed"), "true");
  console.log("PASS motion create + idempotency replay");

  const badPreset = await postJson(`/api/creative/motions/${motion.template_id}/versions`, owner,
    { spec: { ...arSpec, elements: [{ node_id: "headline-1", preset: "spin" }] } }, "e2e-motion-bad");
  assert.equal(badPreset.status, 400);
  const badNode = await postJson(`/api/creative/motions/${motion.template_id}/versions`, owner,
    { spec: { ...arSpec, elements: [{ node_id: "ghost", preset: "fade" }] } }, "e2e-motion-bad-node");
  assert.equal(badNode.status, 400);
  const versioned = await postJson(`/api/creative/motions/${motion.template_id}/versions`, owner,
    { spec: { ...arSpec, captions: [{ text: "شاهد العرض", start_ms: 500, end_ms: 1800 }] } }, "e2e-motion-v2");
  assert.equal(versioned.status, 200);
  const versionBody = JSON.parse(await versioned.text());
  assert.notEqual(versionBody.version_id, motion.template_id);
  const globalVersion = await postJson(`/api/creative/motions/${MOTION_AR_FADE}/versions`, owner,
    { spec: arSpec }, "e2e-motion-global-version");
  assert.equal(globalVersion.status, 403);
  console.log("PASS motion versioning append-only; globals immutable by tenants");

  const foreign = await fetch(`${dashboardOrigin}/api/creative/motions/${motion.template_id}`, { headers: orgBOwner });
  assert.equal(foreign.status, 404);
  console.log("PASS motion cross-tenant isolation");

  // Runtime export worker under the least-privilege role: real Chromium
  // frames, fixed-argv FFmpeg encode, validated MP4, private storage.
  const { executeMotionRenderJob } = await import("../packages/creative-runtime/render/motion-worker.mjs");
  const { capturePng } = await import("../packages/creative-runtime/render/chromium.mjs");
  const { encodeMp4 } = await import("../packages/creative-runtime/render/mp4.mjs");
  const { createLocalFsStorage } = await import("../packages/creative-runtime/storage/local-fs.mjs");
  const { chromium } = await import("@playwright/test");
  const workerStorage = createLocalFsStorage({ dir: uploadDir });
  const workerNetwork = { attempted: 0, blocked: 0 };
  async function offlineCapture({ html, width, height, timeoutMs }) {
    const shot = await capturePng({ chromium, html, width, height, timeoutMs });
    workerNetwork.attempted += shot.attemptedExternal;
    workerNetwork.blocked += shot.blockedExternal;
    return shot;
  }
  async function offlineEncode({ ffmpegPath, args, frames, outputPath, timeoutMs }) {
    return encodeMp4({ ffmpegPath, args, frames, outputPath, timeoutMs });
  }

  async function renderAndExecute({ templateId, version, format, worker, label }) {
    const rendered = await postJson(`/api/creative/motions/${templateId}/render`, operator,
      { format, version }, `e2e-motion-render-${label}`);
    const renderedText = await rendered.text();
    assert.equal(rendered.status, 200, renderedText.slice(0, 300));
    const job = JSON.parse(renderedText);
    const claimed = await workerDb.query(`SELECT * FROM tanaghom.claim_creative_motion_job($1,120)`, [worker]);
    assert.ok(claimed.rows.find((candidate) => candidate.job_id === job.job_id), `${label} claimed`);
    const result = await executeMotionRenderJob({
      db: workerDb, storage: workerStorage, capture: offlineCapture, encode: offlineEncode,
      jobId: job.job_id, worker,
    });
    assert.equal(workerNetwork.attempted, 0, `${label} network`);
    return { job, result };
  }

  const ar = await renderAndExecute({ templateId: motion.template_id, version: 2, format: "1:1", worker: "worker-motion-e2e", label: "ar" });
  assert.equal(ar.result.output.frames, 48);
  const arJobRow = await pool.query(`SELECT status FROM tanaghom.creative_jobs WHERE id = $1`, [ar.job.job_id]);
  assert.equal(arJobRow.rows[0].status, "succeeded");
  const arVersions = await pool.query(
    `SELECT v.id, v.version, v.mime, v.width, v.height, v.duration_ms, v.bytes, v.sha256, v.object_key, v.status, v.provenance, a.id AS asset_id, a.capability
       FROM tanaghom.creative_asset_versions v JOIN tanaghom.creative_assets a ON a.id = v.asset_id
      WHERE v.job_id = $1 ORDER BY v.version`,
    [ar.job.job_id],
  );
  assert.equal(arVersions.rows.length, 1);
  assert.equal(arVersions.rows[0].mime, "video/mp4");
  assert.equal(arVersions.rows[0].width, 1080);
  assert.equal(arVersions.rows[0].capability, "motion");
  assert.equal(arVersions.rows[0].provenance.frames, 48);
  assert.equal(arVersions.rows[0].provenance.fps, 24);
  assert.equal(arVersions.rows[0].provenance.codec, "mpeg4");
  assert.equal(arVersions.rows[0].provenance.design_version, 1);
  assert.equal(arVersions.rows[0].provenance.correlation_id, ar.job.correlation_id);
  assert.match(arVersions.rows[0].provenance.font_sha256, /^[0-9a-f]{64}$/);
  const storedMp4 = await workerStorage.get(arVersions.rows[0].object_key);
  assert.ok(storedMp4 && storedMp4.bytes.length > 32);
  assert.equal(storedMp4.bytes.toString("ascii", 4, 8), "ftyp");
  const auditMotion = await pool.query(
    `SELECT count(*)::int AS n FROM tanaghom.agent_actions_log WHERE correlation_id = $1 AND action_type IN ('creative.job_succeeded','creative.asset_version_created')`,
    [ar.job.correlation_id],
  );
  assert.equal(auditMotion.rows[0].n, 2);
  console.log(JSON.stringify({
    case_id: "mot-ar-fade-01", job_id: ar.job.job_id, asset_id: arVersions.rows[0].asset_id,
    version_id: arVersions.rows[0].id, sha256: arVersions.rows[0].sha256, bytes: arVersions.rows[0].bytes,
    frames: 48, network_attempted: workerNetwork.attempted, result: "succeeded",
  }));
  console.log("PASS motion worker persists MP4 export with provenance and audit");

  const approve = await postJson(`/api/creative/assets/versions/${arVersions.rows[0].id}/decision`, reviewer,
    { decision: "approved" }, "e2e-motion-approve");
  assert.equal(approve.status, 200);
  const approvedRow = await pool.query(`SELECT status FROM tanaghom.creative_asset_versions WHERE id = $1`, [arVersions.rows[0].id]);
  assert.equal(approvedRow.rows[0].status, "approved");
  const viewerDecide = await postJson(`/api/creative/assets/versions/${arVersions.rows[0].id}/decision`, viewer,
    { decision: "rejected", feedback: "x" }, "e2e-motion-viewer-decide");
  assert.equal(viewerDecide.status, 403);
  console.log("PASS reviewer approval path with role enforcement");

  // Carousel motion: two scenes with transitions over two design pages.
  const carouselSpec = {
    locale: "ar", direction: "rtl", fps: 24,
    scenes: [
      { id: "scene-1", page_id: "slide-1", duration_ms: 1500, transition: { preset: "fade", duration_ms: 400 } },
      { id: "scene-2", page_id: "slide-2", duration_ms: 1500, transition: { preset: "slide", direction: "start", duration_ms: 500 } },
    ],
    elements: [
      { node_id: "slide-1-headline", scene_id: "scene-1", preset: "slide", direction: "start", delay_ms: 0, duration_ms: 700 },
      { node_id: "slide-2-headline", scene_id: "scene-2", preset: "fade", delay_ms: 100, duration_ms: 700 },
      { node_id: "slide-2-body", scene_id: "scene-2", preset: "reveal", direction: "start", delay_ms: 300, duration_ms: 700 },
    ],
  };
  const carouselMotion = JSON.parse(await (async () => {
    const response = await postJson("/api/creative/motions", owner,
      { name: "carousel motion", design_template_id: CAROUSEL_EDU, spec: carouselSpec }, "e2e-motion-carousel-create");
    const text = await response.text();
    assert.equal(response.status, 200, text.slice(0, 300));
    return text;
  })());
  const carousel = await renderAndExecute({ templateId: carouselMotion.template_id, format: "1:1", worker: "worker-motion-carousel", label: "carousel" });
  assert.equal(carousel.result.output.frames, 72);
  console.log(JSON.stringify({
    case_id: "mot-carousel-01", job_id: carousel.job.job_id, frames: 72,
    network_attempted: workerNetwork.attempted, result: "succeeded",
  }));
  console.log("PASS multi-scene carousel motion renders with transitions");

  // 9:16 Arabic story from the global starter.
  const story = await renderAndExecute({ templateId: MOTION_AR_STORY, format: "9:16", worker: "worker-motion-story", label: "story" });
  assert.equal(story.result.output.frames, 72);
  assert.equal(story.result.output.width, 1080);
  assert.equal(story.result.output.height, 1920);
  const storyVersions = await pool.query(`SELECT provenance FROM tanaghom.creative_asset_versions WHERE job_id = $1`, [story.job.job_id]);
  assert.equal(storyVersions.rows[0].provenance.design_version, 1);
  console.log(JSON.stringify({
    case_id: "mot-ar-story-01", job_id: story.job.job_id, frames: 72,
    network_attempted: workerNetwork.attempted, result: "succeeded",
  }));
  console.log("PASS 9:16 Arabic story motion renders");

  const reject = await postJson(
    `/api/creative/assets/versions/${(await pool.query(`SELECT id FROM tanaghom.creative_asset_versions WHERE job_id = $1`, [story.job.job_id])).rows[0].id}/decision`,
    reviewer, { decision: "rejected", feedback: "Caption timing feels rushed." }, "e2e-motion-reject");
  assert.equal(reject.status, 200);
  console.log("PASS reviewer rejection path with feedback");

  // Cancellation: request cancel after claim; the worker poll lands it.
  const cancelMotion = JSON.parse(await (async () => {
    const response = await postJson("/api/creative/motions", owner,
      { name: "cancel motion", design_template_id: PRODUCT_PROMO, spec: arSpec }, "e2e-motion-cancel-create");
    const text = await response.text();
    assert.equal(response.status, 200, text.slice(0, 300));
    return text;
  })());
  const cancelRendered = await postJson(`/api/creative/motions/${cancelMotion.template_id}/render`, operator,
    { format: "1:1" }, "e2e-motion-cancel-render");
  const cancelJob = JSON.parse(await cancelRendered.text());
  const cancelClaimed = await workerDb.query(`SELECT * FROM tanaghom.claim_creative_motion_job('worker-motion-cancel',120)`);
  assert.ok(cancelClaimed.rows.find((candidate) => candidate.job_id === cancelJob.job_id));
  const cancelRequest = await fetch(`${dashboardOrigin}/api/creative/jobs/${cancelJob.job_id}/cancel`, {
    method: "POST", headers: { ...owner, "Content-Type": "application/json", "Idempotency-Key": "e2e-motion-cancel" },
  });
  assert.equal(cancelRequest.status, 200);
  await assert.rejects(
    executeMotionRenderJob({
      db: workerDb, storage: workerStorage, capture: offlineCapture, encode: offlineEncode,
      jobId: cancelJob.job_id, worker: "worker-motion-cancel",
    }),
    /motion_cancel_requested/,
  );
  const cancelRow = await pool.query(`SELECT status FROM tanaghom.creative_jobs WHERE id = $1`, [cancelJob.job_id]);
  assert.equal(cancelRow.rows[0].status, "cancelled");
  console.log(JSON.stringify({ case_id: "mot-cancel-01", job_id: cancelJob.job_id, result: "cancelled" }));
  console.log("PASS cooperative cancellation lands cancelled status");

  // Worker-role boundary + filtered-claim proof.
  await assert.rejects(
    workerDb.query(`SELECT * FROM tanaghom.creative_asset_versions LIMIT 1`),
    /permission denied/,
  );
  await assert.rejects(
    workerDb.query(`SELECT * FROM tanaghom.creative_templates LIMIT 1`),
    /permission denied/,
  );
  console.log("PASS worker role remains EXECUTE-only");
  const decoy = await pool.query(`SELECT status, claimed_by FROM tanaghom.creative_jobs WHERE id = $1`, [decoyId]);
  assert.equal(decoy.rows[0].status, "queued");
  assert.equal(decoy.rows[0].claimed_by, null);
  console.log("PASS filtered claim never touches foreign CPU jobs");

  // Browser journeys for the new surfaces.
  const { runCreativeMotionBrowser } = await import("./creative-motion-browser.mjs");
  await runCreativeMotionBrowser({
    dashboardOrigin,
    mintToken: (subject) => accessToken(subject),
    subjects: { owner: OWNER_SUBJECT, operator: OPERATOR_SUBJECT, viewer: VIEWER_SUBJECT },
  });

  // Used-state reversibility: 0040 holds functions only.
  const jobsBefore = await pool.query(`SELECT count(*)::int AS n FROM tanaghom.creative_jobs WHERE capability='motion' AND lane='cpu'`);
  await pool.query(readFileSync("packages/database/migrations/0040_creative_motion_render.down.sql", "utf8"));
  await assert.rejects(pool.query(`SELECT tanaghom.get_creative_motion_input($1,'worker-motion-e2e')`, [ar.job.job_id]));
  await pool.query(readFileSync("packages/database/migrations/0040_creative_motion_render.up.sql", "utf8"));
  const jobsAfter = await pool.query(`SELECT count(*)::int AS n FROM tanaghom.creative_jobs WHERE capability='motion' AND lane='cpu'`);
  assert.equal(jobsAfter.rows[0].n, jobsBefore.rows[0].n);
  console.log("PASS used 0040 down/up reversibility");
  console.log("PASS: creative motion exit gate demonstrated end to end.");
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
