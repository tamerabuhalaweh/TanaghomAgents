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

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required");

const authPort = 43321;
const dashboardPort = 43322;
const authOrigin = `http://127.0.0.1:${authPort}`;
const dashboardOrigin = `http://127.0.0.1:${dashboardPort}`;
const OWNER_SUBJECT = "91000000-0000-4000-8000-000000000031";
const OPERATOR_SUBJECT = "91000000-0000-4000-8000-000000000033";
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
     ('00000000-0000-4000-8000-000000000132', '10000000-0000-4000-8000-000000000001', 'design-viewer@example.test', 'Design Viewer', 'human', 'viewer', $3, now()),
     ('00000000-0000-4000-8000-000000000141', $4, 'orgb-owner@example.test', 'Org B Owner', 'human', 'owner', $5, now())
     ON CONFLICT (id) DO NOTHING`,
    [OWNER_SUBJECT, OPERATOR_SUBJECT, VIEWER_SUBJECT, ORG_B_ID, ORGB_OWNER_SUBJECT],
  );

  authServer.listen(authPort, "127.0.0.1");
  await once(authServer, "listening");

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

  await bootDashboard({ CREATIVE_STUDIO_ENABLED: "true", DESIGN_STUDIO_ENABLED: "true" });
  await pool.query(`UPDATE tanaghom.creative_controls SET enabled=true, emergency_stop=false, reason='Disposable design e2e'`);
  const owner = await bearer(OWNER_SUBJECT);
  const operator = await bearer(OPERATOR_SUBJECT);
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
  const claimed = await pool.query(`SELECT * FROM tanaghom.claim_creative_job('cpu','worker-design-e2e',120)`);
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
  console.log("PASS design preview renders local-only HTML");

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
  await pool.end();
}
