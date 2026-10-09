// P2b design/carousel disposable integration. Requires DATABASE_TEST_URL (fresh
// PostgreSQL) and a built dashboard (`npm run build:dashboard` first). Spins a
// stub JWKS auth server; no providers, GPU, credentials, or production contact.
// The render path is local-only: HTML builder + bundled Cairo + Chromium
// screenshots of the preview route (no network from render).
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

// Private upload dir shared by the dashboard under test and the render
// worker under test: uploads land here, exports land here, nothing leaves.
const uploadDir = mkdtempSync(join(tmpdir(), "design-e2e-uploads-"));

const authPort = 43321;
const dashboardPort = 43322;
const authOrigin = `http://127.0.0.1:${authPort}`;
const dashboardOrigin = `http://127.0.0.1:${dashboardPort}`;
const OWNER_SUBJECT = "91000000-0000-4000-8000-000000000031";
const OPERATOR_SUBJECT = "91000000-0000-4000-8000-000000000033";
const REVIEWER_SUBJECT = "91000000-0000-4000-8000-000000000034";
const VIEWER_SUBJECT = "91000000-0000-4000-8000-000000000032";
const ORGB_OWNER_SUBJECT = "91000000-0000-4000-8000-000000000041";
const ORG_B_ID = "82000000-0000-4000-8000-000000000041";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = { ...await exportJWK(publicKey), kid: "creative-design-key", alg: "RS256", use: "sig" };

async function accessToken(subject) {
  return new SignJWT({ role: "authenticated", email: "design@example.test" })
    .setProtectedHeader({ alg: "RS256", kid: "creative-design-key" })
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
  assert.equal(latestMigration, "0039_creative_design_render");
  await pool.query(readFileSync(`packages/database/migrations/${latestMigration}.down.sql`, "utf8"));
  console.log(`PASS unused ${latestMigration} down`);
  await pool.query(readFileSync(`packages/database/migrations/${latestMigration}.up.sql`, "utf8"));
  console.log(`PASS unused ${latestMigration} up`);
  psqlFile("packages/database/tests/creative_design.sql");
  psqlFile("packages/database/seeds/creative_templates.sql");
  const globals = await pool.query(`SELECT count(*)::int AS n FROM tanaghom.creative_templates WHERE organization_id IS NULL`);
  assert.equal(globals.rows[0].n, 8);
  console.log("PASS design seed starters readable");

  await pool.query(
    `INSERT INTO tanaghom.organizations (id, slug, name, is_active)
     VALUES ($1, 'design-e2e-org-b', 'Design E2E Org B', true) ON CONFLICT (id) DO NOTHING`,
    [ORG_B_ID],
  );
  await pool.query(
    `INSERT INTO tanaghom.app_users (id, organization_id, email, display_name, kind, role, auth_subject, accepted_at) VALUES
     ('00000000-0000-4000-8000-000000000131', '10000000-0000-4000-8000-000000000001', 'design-owner@example.test', 'Design Owner', 'human', 'owner', $1, now()),
     ('00000000-0000-4000-8000-000000000133', '10000000-0000-4000-8000-000000000001', 'design-operator@example.test', 'Design Operator', 'human', 'operator', $2, now()),
     ('00000000-0000-4000-8000-000000000134', '10000000-0000-4000-8000-000000000001', 'design-reviewer@example.test', 'Design Reviewer', 'human', 'reviewer', $3, now()),
     ('00000000-0000-4000-8000-000000000132', '10000000-0000-4000-8000-000000000001', 'design-viewer@example.test', 'Design Viewer', 'human', 'viewer', $4, now()),
     ('00000000-0000-4000-8000-000000000141', $5, 'orgb-owner@example.test', 'Org B Owner', 'human', 'owner', $6, now())
     ON CONFLICT (id) DO NOTHING`,
    [OWNER_SUBJECT, OPERATOR_SUBJECT, REVIEWER_SUBJECT, VIEWER_SUBJECT, ORG_B_ID, ORGB_OWNER_SUBJECT],
  );

  authServer.listen(authPort, "127.0.0.1");
  await once(authServer, "listening");

  // Least-privilege proof: every render-worker database call below runs as
  // tanaghom_creative_worker (EXECUTE-only, no table SELECT). All harness
  // assertions stay on the superuser pool.
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

  // Flags OFF by default: design creation refuses safely.
  await bootDashboard({});
  const ownerProbe = await bearer(OWNER_SUBJECT);
  const off = await fetch(`${dashboardOrigin}/api/creative/designs`, {
    method: "POST", headers: { ...ownerProbe, "Content-Type": "application/json", "Idempotency-Key": "e2e-design-off" },
    body: JSON.stringify({}),
  });
  assert.equal(off.status, 503);
  console.log("PASS design flags off by default");
  await stopDashboard();

  await bootDashboard({ CREATIVE_STUDIO_ENABLED: "true", DESIGN_STUDIO_ENABLED: "true", CAROUSEL_BUILDER_ENABLED: "true", CREATIVE_UPLOAD_DIR: uploadDir });
  await pool.query(`UPDATE tanaghom.creative_controls SET enabled=true, emergency_stop=false, reason='Disposable design e2e'`);
  // Foreign-capability decoy: an older product_shoot CPU job the design
  // worker must never touch (filtered claim proof alongside the SQL test).
  const decoyId = (await pool.query(
    `SELECT tanaghom.create_creative_job('00000000-0000-4000-8000-000000000131','product_shoot','cpu','{}',$1,$2,0,3) AS id`,
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

  const anonymous = await fetch(`${dashboardOrigin}/api/creative/designs`, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "e2e-design-anon" }, body: JSON.stringify({}),
  });
  assert.equal(anonymous.status, 401);
  const viewerDenied = await postJson("/api/creative/designs", viewer,
    { kind: "ad", name: "x", spec: {} }, "e2e-design-deny-viewer");
  assert.equal(viewerDenied.status, 403);
  const operatorDenied = await postJson("/api/creative/designs", operator,
    { kind: "ad", name: "x", spec: {} }, "e2e-design-deny-operator");
  assert.equal(operatorDenied.status, 403);

  const adSpec = {
    kind: "ad", locale: "ar", direction: "rtl",
    canvas: { width: 1080, height: 1080 }, background: { color: "#ffffff" },
    nodes: [{ id: "headline-1", type: "text", role: "headline", x: 90, y: 120, width: 900, height: 220, text: "عرض اليوم", font_size: 96, font_weight: 800, align: "start", color: "#111111" }],
  };
  const createKey = randomUUID();
  const created = await postJson("/api/creative/designs", owner, { kind: "ad", name: "عرض اليوم", spec: adSpec }, createKey);
  const createdText = await created.text();
  assert.equal(created.status, 200, createdText.slice(0, 300));
  const design = JSON.parse(createdText);
  assert.equal(design.ok, true);
  assert.ok(design.template_id);
  const replayed = await postJson("/api/creative/designs", owner, { kind: "ad", name: "عرض اليوم", spec: adSpec }, createKey);
  assert.equal(replayed.status, 200);
  assert.equal((await replayed.json()).template_id, design.template_id);
  assert.equal(replayed.headers.get("Idempotency-Replayed"), "true");
  console.log("PASS design create + idempotency replay");

  const badSpec = await postJson(`/api/creative/designs/${design.template_id}/versions`, owner,
    { spec: { ...adSpec, nodes: [] } }, "e2e-design-bad");
  assert.equal(badSpec.status, 400);
  const versioned = await postJson(`/api/creative/designs/${design.template_id}/versions`, owner,
    { spec: { ...adSpec, background: { color: "#f8fafc" } } }, "e2e-design-v2");
  assert.equal(versioned.status, 200);
  const versionBody = await versioned.json();
  assert.equal(versionBody.ok, true);
  assert.notEqual(versionBody.version_id, design.template_id);
  const detail = await fetch(`${dashboardOrigin}/api/creative/designs/${design.template_id}`, { headers: owner });
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.versions.length, 2);
  assert.equal(detailBody.versions[1].version, 2);
  const globalVersion = await postJson(`/api/creative/designs/a1000000-0000-4000-8000-000000000001/versions`, owner,
    { spec: adSpec }, "e2e-design-global-version");
  assert.equal(globalVersion.status, 403);
  console.log("PASS design versioning append-only; globals immutable by tenants");

  const foreign = await fetch(`${dashboardOrigin}/api/creative/designs/${design.template_id}`, { headers: orgBOwner });
  assert.equal(foreign.status, 404);
  console.log("PASS design cross-tenant isolation");

  const renderKey = randomUUID();
  const rendered = await postJson(`/api/creative/designs/${design.template_id}/render`, operator,
    { format: "1:1", version: 2 }, renderKey);
  const renderedText = await rendered.text();
  assert.equal(rendered.status, 200, renderedText.slice(0, 300));
  const job = JSON.parse(renderedText);
  assert.ok(job.job_id);
  // Worker path: claim then resolve the render input through the DB reader.
  const claimed = await workerDb.query(`SELECT * FROM tanaghom.claim_creative_design_job('worker-design-e2e',120)`);
  const claimedRow = claimed.rows.find((candidate) => candidate.job_id === job.job_id);
  assert.ok(claimedRow, "render job claimed by worker");
  const input = await pool.query(`SELECT tanaghom.get_creative_render_input($1,'worker-design-e2e') AS input`, [job.job_id]);
  assert.equal(input.rows[0].input.template.id, versionBody.version_id);
  assert.equal(input.rows[0].input.template.version, 2);
  console.log("PASS design render job resolves through worker reader");

  const preview = await fetch(`${dashboardOrigin}/api/creative/designs/${design.template_id}/preview?format=1:1`, { headers: owner });
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-type") ?? "", /text\/html/);
  const html = await preview.text();
  assert.match(html, /dir="rtl"/);
  assert.match(html, /عرض اليوم/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(preview.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.match(preview.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  console.log("PASS design preview renders local-only HTML with restrictive CSP");

  // Runtime export worker: the claimed ad render job executes through the
  // Creative Runtime worker (never the preview HTTP route) with real
  // Chromium capture, PNG validation, private storage, versioned asset
  // persistence, and controlled completion.
  const { executeDesignRenderJob } = await import("../packages/creative-runtime/render/worker.mjs");
  const { capturePng } = await import("../packages/creative-runtime/render/chromium.mjs");
  const { createLocalFsStorage } = await import("../packages/creative-runtime/storage/local-fs.mjs");
  const { chromium } = await import("@playwright/test");
  const workerStorage = createLocalFsStorage({ dir: uploadDir });
  const workerNetwork = { attempted: 0, blocked: 0 };
  async function offlineCapture({ html: pageHtml, width, height }) {
    const shot = await capturePng({ chromium, html: pageHtml, width, height });
    workerNetwork.attempted += shot.attemptedExternal;
    workerNetwork.blocked += shot.blockedExternal;
    return shot;
  }
  const adResult = await executeDesignRenderJob({
    db: workerDb, storage: workerStorage, capture: offlineCapture,
    jobId: job.job_id, worker: "worker-design-e2e",
  });
  assert.equal(adResult.slides.length, 1);
  assert.equal(workerNetwork.attempted, 0);
  const adJobRow = await pool.query(`SELECT status, output_asset_ids FROM tanaghom.creative_jobs WHERE id = $1`, [job.job_id]);
  assert.equal(adJobRow.rows[0].status, "succeeded");
  const adVersions = await pool.query(
    `SELECT v.id, v.version, v.mime, v.width, v.height, v.bytes, v.sha256, v.object_key, v.status, v.provenance, a.id AS asset_id, a.capability
       FROM tanaghom.creative_asset_versions v JOIN tanaghom.creative_assets a ON a.id = v.asset_id
      WHERE v.job_id = $1 ORDER BY v.version`,
    [job.job_id],
  );
  assert.equal(adVersions.rows.length, 1);
  assert.equal(adVersions.rows[0].mime, "image/png");
  assert.equal(adVersions.rows[0].width, 1080);
  assert.equal(adVersions.rows[0].status, "draft");
  assert.equal(adVersions.rows[0].provenance.page_index, 0);
  assert.equal(adVersions.rows[0].provenance.design_version, 2);
  assert.equal(adVersions.rows[0].provenance.correlation_id, job.correlation_id);
  assert.match(adVersions.rows[0].provenance.font_sha256, /^[0-9a-f]{64}$/);
  const storedAd = await workerStorage.get(adVersions.rows[0].object_key);
  assert.ok(storedAd && storedAd.bytes.length > 8);
  assert.equal(storedAd.bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const auditAd = await pool.query(
    `SELECT count(*)::int AS n FROM tanaghom.agent_actions_log WHERE correlation_id = $1 AND action_type IN ('creative.job_succeeded','creative.asset_version_created')`,
    [job.correlation_id],
  );
  assert.equal(auditAd.rows[0].n, 2);
  console.log(JSON.stringify({
    case_id: "render-ad-01", job_id: job.job_id, asset_id: adVersions.rows[0].asset_id,
    version_id: adVersions.rows[0].id, sha256: adVersions.rows[0].sha256,
    bytes: adVersions.rows[0].bytes, network_attempted: workerNetwork.attempted, result: "succeeded",
  }));
  console.log("PASS render worker persists ad export with provenance and audit");

  // Reviewer approves the exported ad version; viewers cannot decide.
  const approve = await postJson(`/api/creative/assets/versions/${adVersions.rows[0].id}/decision`, reviewer,
    { decision: "approved" }, "e2e-design-approve");
  assert.equal(approve.status, 200);
  const approvedRow = await pool.query(`SELECT status FROM tanaghom.creative_asset_versions WHERE id = $1`, [adVersions.rows[0].id]);
  assert.equal(approvedRow.rows[0].status, "approved");
  const viewerDecide = await postJson(`/api/creative/assets/versions/${adVersions.rows[0].id}/decision`, viewer,
    { decision: "rejected", feedback: "x" }, "e2e-design-viewer-decide");
  assert.equal(viewerDecide.status, 403);
  console.log("PASS reviewer approval path with role enforcement");

  // Carousel render job: one job, six ordered slide outputs, one asset, one
  // correlation lineage.
  const carouselRenderedText = await (async () => {
    const response = await postJson(`/api/creative/designs/a1000000-0000-4000-8000-000000000006/render`, operator,
      { format: "1:1" }, "e2e-design-carousel-render");
    const text = await response.text();
    assert.equal(response.status, 200, text.slice(0, 300));
    return text;
  })();
  const carouselJob = JSON.parse(carouselRenderedText);
  const carouselClaimed = await workerDb.query(`SELECT * FROM tanaghom.claim_creative_design_job('worker-design-carousel',120)`);
  assert.ok(carouselClaimed.rows.find((candidate) => candidate.job_id === carouselJob.job_id));
  const carouselResult = await executeDesignRenderJob({
    db: workerDb, storage: workerStorage, capture: offlineCapture,
    jobId: carouselJob.job_id, worker: "worker-design-carousel",
  });
  assert.equal(carouselResult.slides.length, 6);
  assert.equal(workerNetwork.attempted, 0);
  const carouselVersions = await pool.query(
    `SELECT v.id, v.version, v.provenance, a.id AS asset_id
       FROM tanaghom.creative_asset_versions v JOIN tanaghom.creative_assets a ON a.id = v.asset_id
      WHERE v.job_id = $1 ORDER BY v.version`,
    [carouselJob.job_id],
  );
  assert.equal(carouselVersions.rows.length, 6);
  assert.deepEqual(carouselVersions.rows.map((row) => row.provenance.page_index), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(carouselVersions.rows.map((row) => row.asset_id), Array(6).fill(carouselVersions.rows[0].asset_id));
  for (const row of carouselVersions.rows) {
    assert.equal(row.provenance.correlation_id, carouselJob.correlation_id);
    assert.equal(row.provenance.page_count, 6);
  }
  const carouselJobRow = await pool.query(`SELECT status FROM tanaghom.creative_jobs WHERE id = $1`, [carouselJob.job_id]);
  assert.equal(carouselJobRow.rows[0].status, "succeeded");
  console.log(JSON.stringify({
    case_id: "render-carousel-01", job_id: carouselJob.job_id, asset_id: carouselVersions.rows[0].asset_id,
    versions: carouselVersions.rows.length, network_attempted: workerNetwork.attempted, result: "succeeded",
  }));
  console.log("PASS carousel render persists ordered slides under one lineage");

  // Reviewer rejects one carousel slide with feedback.
  const reject = await postJson(`/api/creative/assets/versions/${carouselVersions.rows[1].id}/decision`, reviewer,
    { decision: "rejected", feedback: "Slide two headline wraps poorly." }, "e2e-design-reject");
  assert.equal(reject.status, 200);
  const rejectedRow = await pool.query(`SELECT status FROM tanaghom.creative_asset_versions WHERE id = $1`, [carouselVersions.rows[1].id]);
  assert.equal(rejectedRow.rows[0].status, "rejected");
  console.log("PASS reviewer rejection path with feedback");

  // Source-asset path: an uploaded private image becomes a design image node
  // and renders through tenant-checked worker resolution.
  const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const uploadForm = new FormData();
  uploadForm.set("file", new Blob([PNG_1X1], { type: "image/png" }), "source.png");
  uploadForm.set("title", "design source");
  const uploaded = await fetch(`${dashboardOrigin}/api/creative/uploads`, {
    method: "POST", headers: { ...operator, "Idempotency-Key": "e2e-design-upload" }, body: uploadForm,
  });
  const uploadedText = await uploaded.text();
  assert.equal(uploaded.status, 200, uploadedText.slice(0, 300));
  const uploadBody = JSON.parse(uploadedText);
  const imageSpec = {
    kind: "ad", locale: "en", direction: "ltr",
    canvas: { width: 1080, height: 1080 }, background: { color: "#ffffff" },
    nodes: [
      { id: "photo-1", type: "image", role: "product", x: 90, y: 120, width: 500, height: 500, asset_version_id: uploadBody.version_id },
      { id: "headline-1", type: "text", role: "headline", x: 90, y: 660, width: 900, height: 160, text: "With photo", font_size: 72, font_weight: 700, align: "start", color: "#111111" },
    ],
  };
  const imageDesign = JSON.parse(await (async () => {
    const response = await postJson("/api/creative/designs", owner, { kind: "ad", name: "photo ad", spec: imageSpec }, "e2e-design-image-create");
    const text = await response.text();
    assert.equal(response.status, 200, text.slice(0, 300));
    return text;
  })());
  const imageRendered = JSON.parse(await (async () => {
    const response = await postJson(`/api/creative/designs/${imageDesign.template_id}/render`, operator, { format: "1:1" }, "e2e-design-image-render");
    const text = await response.text();
    assert.equal(response.status, 200, text.slice(0, 300));
    return text;
  })());
  const imageClaimed = await workerDb.query(`SELECT * FROM tanaghom.claim_creative_design_job('worker-design-image',120)`);
  assert.ok(imageClaimed.rows.find((candidate) => candidate.job_id === imageRendered.job_id));
  const imageResult = await executeDesignRenderJob({
    db: workerDb, storage: workerStorage, capture: offlineCapture,
    jobId: imageRendered.job_id, worker: "worker-design-image",
  });
  assert.equal(imageResult.slides.length, 1);
  const imageVersions = await pool.query(`SELECT provenance FROM tanaghom.creative_asset_versions WHERE job_id = $1`, [imageRendered.job_id]);
  assert.deepEqual(imageVersions.rows[0].provenance.source_asset_version_ids, [uploadBody.version_id]);
  console.log("PASS render worker resolves tenant-checked private source assets");

  // Worker-role boundary: direct table SELECT stays denied under the role
  // that just executed three render jobs successfully.
  await assert.rejects(
    workerDb.query(`SELECT * FROM tanaghom.creative_asset_versions LIMIT 1`),
    /permission denied/,
  );
  await assert.rejects(
    workerDb.query(`SELECT * FROM tanaghom.creative_jobs LIMIT 1`),
    /permission denied/,
  );
  console.log("PASS worker role remains EXECUTE-only");

  // Filtered-claim proof: the foreign decoy is still queued and unclaimed
  // after every design claim in this run.
  const decoy = await pool.query(`SELECT status, claimed_by FROM tanaghom.creative_jobs WHERE id = $1`, [decoyId]);
  assert.equal(decoy.rows[0].status, "queued");
  assert.equal(decoy.rows[0].claimed_by, null);
  console.log("PASS filtered claim never touches foreign CPU jobs");

  // Browser journeys for the new surfaces + render evidence.
  const { runCreativeDesignBrowser } = await import("./creative-design-browser.mjs");
  await runCreativeDesignBrowser({
    dashboardOrigin,
    mintToken: (subject) => accessToken(subject),
    subjects: { owner: OWNER_SUBJECT, operator: OPERATOR_SUBJECT, viewer: VIEWER_SUBJECT },
    designs: [
      { case_id: "ad-mixed-01", template: "product-promo", id: "a1000000-0000-4000-8000-000000000001", format: "1:1", pages: 1 },
      { case_id: "ad-en-01", template: "announcement", id: "a1000000-0000-4000-8000-000000000002", format: "1:1", pages: 1 },
      { case_id: "ad-price-cta-01", template: "event-course", id: "a1000000-0000-4000-8000-000000000005", format: "4:5", pages: 1 },
      { case_id: "ad-story-01", template: "story-promo", id: "a1000000-0000-4000-8000-000000000008", format: "9:16", pages: 1 },
      { case_id: "car-ar-6-01", template: "carousel-edu", id: "a1000000-0000-4000-8000-000000000006", format: "1:1", pages: 6 },
      { case_id: "car-mixed-01", template: "carousel-offer", id: "a1000000-0000-4000-8000-000000000007", format: "1:1", pages: 6 },
      { case_id: "ad-created-01", template: "created-ad", id: design.template_id, format: "1:1", pages: 1 },
    ],
  });

  // Used-state reversibility: 0039 drops only the reader function, so down/up
  // restores byte-identical behavior with evidence rows retained.
  const jobsBefore = await pool.query(`SELECT count(*)::int AS n FROM tanaghom.creative_jobs WHERE capability='design' AND lane='cpu'`);
  await pool.query(readFileSync("packages/database/migrations/0039_creative_design_render.down.sql", "utf8"));
  await assert.rejects(pool.query(`SELECT tanaghom.get_creative_render_input($1,'worker-design-e2e')`, [job.job_id]));
  await pool.query(readFileSync("packages/database/migrations/0039_creative_design_render.up.sql", "utf8"));
  const inputAgain = await pool.query(`SELECT tanaghom.get_creative_render_input($1,'worker-design-e2e') AS input`, [job.job_id]);
  assert.equal(inputAgain.rows[0].input.template.id, versionBody.version_id);
  const jobsAfter = await pool.query(`SELECT count(*)::int AS n FROM tanaghom.creative_jobs WHERE capability='design' AND lane='cpu'`);
  assert.equal(jobsAfter.rows[0].n, jobsBefore.rows[0].n);
  console.log("PASS used 0039 down/up reversibility");
  console.log("PASS: creative design exit gate demonstrated end to end.");
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
