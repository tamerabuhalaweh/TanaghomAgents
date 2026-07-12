import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import pg from "pg";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required");

const authPort = 43191;
const dashboardPort = 43192;
const authOrigin = `http://127.0.0.1:${authPort}`;
const dashboardOrigin = `http://127.0.0.1:${dashboardPort}`;
const subject = "90000000-0000-4000-8000-000000000001";
const ownerId = "00000000-0000-4000-8000-000000000001";
const campaignId = "20000000-0000-4000-8000-000000000001";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = { ...await exportJWK(publicKey), kid: "integration-key", alg: "RS256", use: "sig" };
let refreshGeneration = 0;

async function accessToken(seconds) {
  return new SignJWT({ role: "authenticated", email: "owner@example.test" })
    .setProtectedHeader({ alg: "RS256", kid: "integration-key" })
    .setIssuer(`${authOrigin}/auth/v1`)
    .setAudience("authenticated")
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .sign(privateKey);
}

async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const authServer = createServer(async (request, response) => {
  if (request.url === "/auth/v1/.well-known/jwks.json") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ keys: [publicJwk] }));
    return;
  }
  const url = new URL(request.url, authOrigin);
  if (request.method !== "POST" || url.pathname !== "/auth/v1/token") {
    response.writeHead(404).end();
    return;
  }
  const body = await jsonBody(request);
  if (url.searchParams.get("grant_type") === "password") {
    if (body.email !== "owner@example.test" || body.password !== "integration-only") {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_grant" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      access_token: await accessToken(2), refresh_token: "refresh-0", expires_in: 2,
    }));
    return;
  }
  if (url.searchParams.get("grant_type") === "refresh_token") {
    if (body.refresh_token !== `refresh-${refreshGeneration}`) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_refresh_token" }));
      return;
    }
    refreshGeneration += 1;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      access_token: await accessToken(3600),
      refresh_token: `refresh-${refreshGeneration}`,
      expires_in: 3600,
    }));
    return;
  }
  response.writeHead(400).end();
});

function cookies(response) {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]);
}

function cookieValue(jar, name) {
  return jar.find((value) => value.startsWith(`${name}=`));
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

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
let dashboard;
try {
  authServer.listen(authPort, "127.0.0.1");
  await once(authServer, "listening");
  dashboard = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "apps/dashboard", "-p", String(dashboardPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_ENV: "integration",
      DATABASE_URL: databaseUrl,
      SUPABASE_URL: authOrigin,
      SUPABASE_PUBLISHABLE_KEY: "integration-publishable-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForDashboard(dashboard);

  const login = await fetch(`${dashboardOrigin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "integration-only" }),
  });
  assert.equal(login.status, 200);
  let jar = cookies(login);
  assert.ok(cookieValue(jar, "tanaghom_access_token"));
  assert.ok(cookieValue(jar, "tanaghom_refresh_token"));

  let session = await fetch(`${dashboardOrigin}/api/auth/session`, { headers: { Cookie: jar.join("; ") } });
  assert.equal(session.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 2_200));
  session = await fetch(`${dashboardOrigin}/api/auth/session`, { headers: { Cookie: jar.join("; ") } });
  assert.equal(session.status, 401);

  const refresh = await fetch(`${dashboardOrigin}/api/auth/refresh`, {
    method: "POST",
    headers: { Cookie: jar.join("; "), Origin: dashboardOrigin },
  });
  assert.equal(refresh.status, 200);
  jar = cookies(refresh);
  assert.match(cookieValue(jar, "tanaghom_refresh_token"), /refresh-1/);
  session = await fetch(`${dashboardOrigin}/api/auth/session`, { headers: { Cookie: jar.join("; ") } });
  assert.equal(session.status, 200);

  const strategy = await pool.query(
    `INSERT INTO tanaghom.campaign_strategies
       (campaign_id, version, positioning, key_messages, channels, posting_cadence, content_pillars, model_name, prompt_version)
     VALUES ($1, 90, 'Integration strategy', '["safe"]', '["test"]', '{"daily":0}', '["proof"]', 'fake-model', 'integration-v1')
     RETURNING id`,
    [campaignId],
  );
  const createContent = async (generation) => (await pool.query(
    `INSERT INTO tanaghom.content_items
       (campaign_id, strategy_id, generation, channel, content_type, draft_copy, media_brief, status)
     VALUES ($1, $2, $3, 'test', 'post', 'Integration draft', 'No external media', 'pending_approval')
     RETURNING id`,
    [campaignId, strategy.rows[0].id, generation],
  )).rows[0].id;
  const contentId = await createContent(1);
  const decisionHeaders = {
    Cookie: jar.join("; "), Origin: dashboardOrigin, "Content-Type": "application/json",
  };
  const decisionBody = JSON.stringify({ decision: "approved", rejection_reason: null });
  const first = await fetch(`${dashboardOrigin}/api/approvals/${contentId}/decision`, {
    method: "POST", headers: { ...decisionHeaders, "Idempotency-Key": "integration-replay-1" }, body: decisionBody,
  });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).delivery, "queued");
  const replay = await fetch(`${dashboardOrigin}/api/approvals/${contentId}/decision`, {
    method: "POST", headers: { ...decisionHeaders, "Idempotency-Key": "integration-replay-1" }, body: decisionBody,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("Idempotency-Replayed"), "true");
  const conflicting = await fetch(`${dashboardOrigin}/api/approvals/${contentId}/decision`, {
    method: "POST",
    headers: { ...decisionHeaders, "Idempotency-Key": "integration-replay-1" },
    body: JSON.stringify({ decision: "rejected", rejection_reason: "conflicting replay" }),
  });
  assert.equal(conflicting.status, 409);
  assert.equal((await conflicting.json()).error, "idempotency_key_reused");
  const stale = await fetch(`${dashboardOrigin}/api/approvals/${contentId}/decision`, {
    method: "POST", headers: { ...decisionHeaders, "Idempotency-Key": "integration-stale-1" }, body: decisionBody,
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, "content_not_pending_approval");
  const committed = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM tanaghom.content_approvals WHERE content_item_id = $1) approvals,
       (SELECT count(*)::int FROM tanaghom.outbox_events WHERE aggregate_id = $1) outbox,
       (SELECT count(*)::int FROM tanaghom.agent_actions_log WHERE entity_id = $1) audit,
       (SELECT count(*)::int FROM tanaghom.api_idempotency_keys WHERE actor_user_id = $2 AND idempotency_key LIKE 'integration-%') idempotency`,
    [contentId, ownerId],
  );
  assert.deepEqual(committed.rows[0], { approvals: 1, outbox: 1, audit: 1, idempotency: 1 });

  const atomicContentId = await createContent(2);
  await pool.query(`CREATE FUNCTION tanaghom.integration_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'integration outbox failure'; END $$`);
  await pool.query(`CREATE TRIGGER integration_reject_outbox BEFORE INSERT ON tanaghom.outbox_events FOR EACH ROW EXECUTE FUNCTION tanaghom.integration_reject_outbox()`);
  const failed = await fetch(`${dashboardOrigin}/api/approvals/${atomicContentId}/decision`, {
    method: "POST", headers: { ...decisionHeaders, "Idempotency-Key": "integration-atomic-1" }, body: decisionBody,
  });
  assert.equal(failed.status, 503);
  const rolledBack = await pool.query(
    `SELECT
       (SELECT status FROM tanaghom.content_items WHERE id = $1) status,
       (SELECT count(*)::int FROM tanaghom.content_approvals WHERE content_item_id = $1) approvals,
       (SELECT count(*)::int FROM tanaghom.agent_actions_log WHERE entity_id = $1) audit,
       (SELECT count(*)::int FROM tanaghom.api_idempotency_keys WHERE actor_user_id = $2 AND idempotency_key = 'integration-atomic-1') idempotency`,
    [atomicContentId, ownerId],
  );
  assert.deepEqual(rolledBack.rows[0], { status: "pending_approval", approvals: 0, audit: 0, idempotency: 0 });

  const invalidRefresh = await fetch(`${dashboardOrigin}/api/auth/refresh`, {
    method: "POST",
    headers: { Cookie: "tanaghom_refresh_token=invalid", Origin: dashboardOrigin },
  });
  assert.equal(invalidRefresh.status, 401);
  assert.equal(cookies(invalidRefresh).filter((value) => /tanaghom_(access|refresh)_token=/.test(value)).length, 2);
  console.log("PASS: session rotation and approval API transaction contracts verified.");
} finally {
  if (dashboard && dashboard.exitCode === null) dashboard.kill("SIGTERM");
  authServer.close();
  await pool.end();
}
