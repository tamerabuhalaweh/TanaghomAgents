import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import pg from "pg";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required");

const authPort = 43191;
const dashboardPort = 43192;
const providerPort = 43193;
const authOrigin = `http://127.0.0.1:${authPort}`;
const dashboardOrigin = `http://127.0.0.1:${dashboardPort}`;
const providerOrigin = `http://127.0.0.1:${providerPort}`;
const subject = "90000000-0000-4000-8000-000000000001";
const invitedSubject = "90000000-0000-4000-8000-000000000002";
const ownerId = "00000000-0000-4000-8000-000000000001";
const campaignId = "20000000-0000-4000-8000-000000000001";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = { ...await exportJWK(publicKey), kid: "integration-key", alg: "RS256", use: "sig" };
let refreshGeneration = 0;
let providerDraftRequests = 0;
let providerAnalyticsRequests = 0;
let providerGhlRequests = 0;

async function accessToken(seconds, tokenSubject = subject, email = "owner@example.test") {
  return new SignJWT({ role: "authenticated", email })
    .setProtectedHeader({ alg: "RS256", kid: "integration-key" })
    .setIssuer(`${authOrigin}/auth/v1`)
    .setAudience("authenticated")
    .setSubject(tokenSubject)
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
  if (request.method === "POST" && url.pathname === "/auth/v1/invite") {
    const body = await jsonBody(request);
    if (request.headers.authorization !== "Bearer integration-secret-key" || body.email !== "reviewer@example.test") {
      response.writeHead(403).end(); return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: invitedSubject, email: body.email }));
    return;
  }
  if (request.method === "PUT" && url.pathname === "/auth/v1/user") {
    const body = await jsonBody(request);
    if (typeof body.password !== "string" || body.password.length < 12) {
      response.writeHead(400).end(); return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: invitedSubject, email: "reviewer@example.test" }));
    return;
  }
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

const providerServer = createServer(async (request, response) => {
  const url = new URL(request.url, providerOrigin);
  const ghlRequest = url.pathname.includes("/locations/") || url.pathname.endsWith("/contacts/upsert");
  const expectedAuthorization = ghlRequest
    ? "Bearer integration-customer-ghl-token"
    : "integration-customer-postiz-key";
  if (request.headers.authorization !== expectedAuthorization) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  if (ghlRequest) assert.equal(request.headers.version, "v3");
  if (request.method === "GET" && url.pathname === "/public/v1/locations/location-test-1") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ location: { id: "location-test-1", name: "Integration GHL Location" } }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/public/v1/contacts/upsert") {
    providerGhlRequests += 1;
    const body = await jsonBody(request);
    assert.equal(body.locationId, "location-test-1");
    assert.equal(body.source, "Tanaghom");
    assert.equal(body.createNewIfDuplicateAllowed, false);
    assert.equal(body.email, "ghl-api-lead@example.test");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ new: true, contact: { id: "ghl-api-contact-1", locationId: "location-test-1" } }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/public/v1/is-connected") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ connected: true }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/public/v1/integrations") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify([{ id: "integration-test-channel", name: "Test Instagram", identifier: "instagram", profile: "@tanaghom-test", disabled: false }]));
    return;
  }
  if (request.method === "POST" && url.pathname === "/public/v1/posts") {
    providerDraftRequests += 1;
    const body = await jsonBody(request);
    assert.equal(body.type, "draft");
    assert.equal(body.posts[0].integration.id, "integration-test-channel");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify([{ postId: "gateway-draft-1", integration: "integration-test-channel" }]));
    return;
  }
  if (request.method === "GET" && url.pathname === "/public/v1/analytics/post/gateway-draft-1") {
    providerAnalyticsRequests += 1;
    assert.equal(url.searchParams.get("date"), "30");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify([
      { label: "Impressions", data: [{ total: "1500", date: "2026-07-12" }], percentageChange: 12.5 },
      { label: "Likes", data: [{ total: "120", date: "2026-07-12" }], percentageChange: 8.1 },
    ]));
    return;
  }
  response.writeHead(404).end();
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
  providerServer.listen(providerPort, "127.0.0.1");
  await once(providerServer, "listening");
  dashboard = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "apps/dashboard", "-p", String(dashboardPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_ENV: "integration",
      DATABASE_URL: databaseUrl,
      SUPABASE_URL: authOrigin,
      SUPABASE_PUBLISHABLE_KEY: "integration-publishable-key",
      SUPABASE_SECRET_KEY: "integration-secret-key",
      POSTIZ_HANDOFF_ENABLED: "true",
      POSTIZ_AUTOMATION_RUNTIME_READY: "true",
      POSTIZ_PERFORMANCE_SYNC_ENABLED: "true",
      GHL_CONTACT_HANDOFF_ENABLED: "true",
      GHL_CONTACT_SYNC_ENABLED: "true",
      TANAGHOM_INTEGRATION_GATEWAY_URL: dashboardOrigin,
      INTEGRATION_CREDENTIAL_KEY: Buffer.alloc(32, 7).toString("base64"),
      INTEGRATION_CREDENTIAL_KEY_VERSION: "1",
      INTEGRATION_WORKER_TOKEN: "integration-worker-token-at-least-32-characters",
      INTEGRATION_TEST_BASE_URLS: `${providerOrigin}/public/v1`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForDashboard(dashboard);

  await pool.query(`UPDATE tanaghom.automation_platform_controls
    SET emergency_stop=false, reason='Disposable dashboard integration test'
    WHERE provider IN ('postiz','ghl')`);

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

  const campaignDraftPayload = {
    name: "Dashboard API lifecycle campaign.test",
    brief: "Promote a verified family creativity workshop without invented claims or external actions.",
    product_type: "course",
    audience: "Parents aged 28 to 50 with school-age children",
    geography: "Amman, Jordan",
    languages: ["en", "ar"],
    budget_target: "0",
    revenue_target: "0",
    currency: "JOD",
    content_item_target: "2",
  };
  const campaignCreateHeaders = {
    Cookie: jar.join("; "), Origin: dashboardOrigin, "Content-Type": "application/json",
    "Idempotency-Key": "integration-campaign-create-1",
  };
  const campaignCreate = await fetch(`${dashboardOrigin}/api/campaigns`, {
    method: "POST", headers: campaignCreateHeaders, body: JSON.stringify(campaignDraftPayload),
  });
  assert.equal(campaignCreate.status, 201);
  const campaignCreateBody = await campaignCreate.json();
  const lifecycleCampaignId = campaignCreateBody.campaign.campaign_id;
  assert.match(lifecycleCampaignId, /^[0-9a-f-]{36}$/);
  const campaignCreateReplay = await fetch(`${dashboardOrigin}/api/campaigns`, {
    method: "POST", headers: campaignCreateHeaders, body: JSON.stringify(campaignDraftPayload),
  });
  assert.equal(campaignCreateReplay.status, 201);
  assert.equal(campaignCreateReplay.headers.get("idempotency-replayed"), "true");
  assert.equal((await campaignCreateReplay.json()).campaign.campaign_id, lifecycleCampaignId);

  const campaignDetail = await fetch(`${dashboardOrigin}/api/campaigns/${lifecycleCampaignId}`, {
    headers: { Cookie: jar.join("; ") },
  });
  assert.equal(campaignDetail.status, 200);
  const campaignDetailBody = await campaignDetail.json();
  assert.equal(campaignDetailBody.campaign.status, "draft");
  assert.equal(campaignDetailBody.permissions.can_operate, true);
  assert.deepEqual(campaignDetailBody.strategies, []);
  assert.deepEqual(campaignDetailBody.content, []);

  const strategyHeaders = {
    Cookie: jar.join("; "), Origin: dashboardOrigin,
    "Idempotency-Key": "integration-campaign-strategy-1",
  };
  const strategyStart = await fetch(`${dashboardOrigin}/api/campaigns/${lifecycleCampaignId}/strategy`, {
    method: "POST", headers: strategyHeaders,
  });
  assert.equal(strategyStart.status, 200);
  const strategyStartBody = await strategyStart.json();
  assert.equal(strategyStartBody.result.job_status, "queued");
  const strategyReplay = await fetch(`${dashboardOrigin}/api/campaigns/${lifecycleCampaignId}/strategy`, {
    method: "POST", headers: strategyHeaders,
  });
  assert.equal(strategyReplay.status, 200);
  assert.equal(strategyReplay.headers.get("idempotency-replayed"), "true");
  assert.equal((await strategyReplay.json()).result.job_id, strategyStartBody.result.job_id);
  const campaignProviderBoundary = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM tanaghom.posts WHERE content_item_id IN
         (SELECT id FROM tanaghom.content_items WHERE campaign_id=$1)) posts,
       (SELECT count(*)::int FROM tanaghom.external_operations
         WHERE correlation_id IN (SELECT correlation_id FROM tanaghom.agent_jobs WHERE campaign_id=$1)) operations`,
    [lifecycleCampaignId],
  );
  assert.deepEqual(campaignProviderBoundary.rows[0], { posts: 0, operations: 0 });

  const supervisorInbox = await fetch(`${dashboardOrigin}/api/conversations`, { headers: { Cookie: jar.join("; ") } });
  assert.equal(supervisorInbox.status, 200);
  const supervisorInboxBody = await supervisorInbox.json();
  assert.equal(supervisorInboxBody.current_user.role, "owner");
  assert.equal(supervisorInboxBody.policy.conversation_emergency_stop, true);
  assert.deepEqual(supervisorInboxBody.conversations, []);
  const clearConversationStop = await fetch(`${dashboardOrigin}/api/conversations/emergency`, {
    method: "POST", headers: { Cookie: jar.join("; "), Origin: dashboardOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ active: false, reason: "Dashboard integration controlled resume test", command_id: randomUUID() }),
  });
  assert.equal(clearConversationStop.status, 200);
  const restoreConversationStop = await fetch(`${dashboardOrigin}/api/conversations/emergency`, {
    method: "POST", headers: { Cookie: jar.join("; "), Origin: dashboardOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ active: true, reason: "Dashboard integration test complete", command_id: randomUUID() }),
  });
  assert.equal(restoreConversationStop.status, 200);

  const initialIntegrations = await fetch(`${dashboardOrigin}/api/admin/integrations`, { headers: { Cookie: jar.join("; ") } });
  assert.equal(initialIntegrations.status, 200);
  const initialIntegrationsBody = await initialIntegrations.json();
  assert.equal(initialIntegrationsBody.secure_storage_configured, true);
  assert.equal(initialIntegrationsBody.postiz_automation.mode, "manual");
  const savedPostiz = await fetch(`${dashboardOrigin}/api/admin/integrations/postiz`, {
    method: "PUT",
    headers: { Cookie: jar.join("; "), Origin: dashboardOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ secret: "integration-customer-postiz-key", base_url: `${providerOrigin}/public/v1/is-connected`, configuration: {} }),
  });
  assert.equal(savedPostiz.status, 200);
  const savedPostizBody = await savedPostiz.json();
  assert.equal(savedPostizBody.connection.credential_mask, "••••••••-key");
  assert.equal(savedPostizBody.connection.base_url, `${providerOrigin}/public/v1`);
  assert.doesNotMatch(JSON.stringify(savedPostizBody), /integration-customer-postiz-key/);
  const encryptedCredential = await pool.query(`SELECT encode(credential_ciphertext, 'hex') ciphertext,
    credential_nonce, credential_auth_tag FROM tanaghom.integration_connections WHERE provider='postiz'`);
  assert.ok(encryptedCredential.rows[0].ciphertext.length > 20);
  assert.equal(encryptedCredential.rows[0].credential_nonce.length, 12);
  assert.equal(encryptedCredential.rows[0].credential_auth_tag.length, 16);
  assert.doesNotMatch(encryptedCredential.rows[0].ciphertext, /integration-customer-postiz-key/);
  const testedPostiz = await fetch(`${dashboardOrigin}/api/admin/integrations/postiz/test`, {
    method: "POST", headers: { Cookie: jar.join("; "), Origin: dashboardOrigin },
  });
  assert.equal(testedPostiz.status, 200);
  assert.equal((await testedPostiz.json()).connection.status, "connected");
  const savedGhl = await fetch(`${dashboardOrigin}/api/admin/integrations/ghl`, {
    method: "PUT",
    headers: { Cookie: jar.join("; "), Origin: dashboardOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: "integration-customer-ghl-token",
      base_url: `${providerOrigin}/public/v1`,
      configuration: { location_id: "location-test-1" },
    }),
  });
  assert.equal(savedGhl.status, 200);
  assert.doesNotMatch(JSON.stringify(await savedGhl.json()), /integration-customer-ghl-token/);
  const testedGhl = await fetch(`${dashboardOrigin}/api/admin/integrations/ghl/test`, {
    method: "POST", headers: { Cookie: jar.join("; "), Origin: dashboardOrigin },
  });
  assert.equal(testedGhl.status, 200);
  assert.equal((await testedGhl.json()).connection.status, "connected");

  const ghlLeadId = "65000000-0000-4000-8000-000000000030";
  await pool.query(`INSERT INTO tanaghom.leads (id,campaign_id,name,contact_email,status)
    VALUES ($1,$2,'GHL API Lead','ghl-api-lead@example.test','qualified')`, [ghlLeadId, campaignId]);
  const ghlHandoffHeaders = {
    Cookie: jar.join("; "), Origin: dashboardOrigin,
    "Idempotency-Key": "integration-ghl-contact-1",
  };
  const ghlHandoff = await fetch(`${dashboardOrigin}/api/leads/${ghlLeadId}/ghl-contact`, {
    method: "POST", headers: ghlHandoffHeaders,
  });
  assert.equal(ghlHandoff.status, 202);
  const ghlHandoffBody = await ghlHandoff.json();
  const ghlHandoffReplay = await fetch(`${dashboardOrigin}/api/leads/${ghlLeadId}/ghl-contact`, {
    method: "POST", headers: ghlHandoffHeaders,
  });
  assert.equal(ghlHandoffReplay.status, 202);
  assert.equal(ghlHandoffReplay.headers.get("Idempotency-Replayed"), "true");
  const claimedGhl = await pool.query("SELECT * FROM tanaghom.claim_ghl_contact_job()");
  assert.equal(claimedGhl.rows[0].job_id, ghlHandoffBody.job_id);
  const preparedGhl = await pool.query("SELECT * FROM tanaghom.prepare_ghl_contact_upsert($1::uuid)", [ghlHandoffBody.job_id]);
  const ghlGateway = await fetch(`${dashboardOrigin}/api/internal/integrations/ghl/contact`, {
    method: "POST",
    headers: { Authorization: "Bearer integration-worker-token-at-least-32-characters", "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: ghlHandoffBody.job_id, request_body: preparedGhl.rows[0].request_body }),
  });
  assert.equal(ghlGateway.status, 200);
  const ghlGatewayBody = await ghlGateway.json();
  assert.equal(ghlGatewayBody.contact.id, "ghl-api-contact-1");
  assert.equal(providerGhlRequests, 1);
  const ghlGatewayReplay = await fetch(`${dashboardOrigin}/api/internal/integrations/ghl/contact`, {
    method: "POST",
    headers: { Authorization: "Bearer integration-worker-token-at-least-32-characters", "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: ghlHandoffBody.job_id, request_body: preparedGhl.rows[0].request_body }),
  });
  assert.equal(ghlGatewayReplay.status, 409);
  assert.equal(providerGhlRequests, 1);
  await pool.query("SELECT tanaghom.complete_ghl_contact_upsert($1::uuid,$2::jsonb)", [
    ghlHandoffBody.job_id,
    JSON.stringify({ contract_version: "phase5.ghl-contact-upsert-result.v1", provider_contact_id: "ghl-api-contact-1", location_id: "location-test-1", created: true }),
  ]);
  assert.equal((await pool.query("SELECT ghl_contact_id FROM tanaghom.leads WHERE id=$1", [ghlLeadId])).rows[0].ghl_contact_id, "ghl-api-contact-1");
  const mappedPostiz = await fetch(`${dashboardOrigin}/api/admin/integrations/postiz/channels`, {
    method: "PUT",
    headers: { Cookie: jar.join("; "), Origin: dashboardOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ mappings: [{ channel: "instagram", provider_integration_id: "integration-test-channel" }] }),
  });
  assert.equal(mappedPostiz.status, 200);
  const automaticMode = await fetch(`${dashboardOrigin}/api/admin/automation/postiz`, {
    method: "PUT",
    headers: { Cookie: jar.join("; "), Origin: dashboardOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "automatic" }),
  });
  assert.equal(automaticMode.status, 200);
  assert.equal((await automaticMode.json()).automation.mode, "automatic");

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
     VALUES ($1, $2, $3, 'instagram', 'post', 'Integration draft', 'No external media', 'pending_approval')
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
  const firstBody = await first.json();
  assert.equal(firstBody.delivery, "queued");
  assert.equal(firstBody.postiz_draft.queued, true);
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
       (SELECT count(*)::int FROM tanaghom.api_idempotency_keys
         WHERE actor_user_id = $2
           AND idempotency_key IN ('integration-replay-1','integration-stale-1')) idempotency`,
    [contentId, ownerId],
  );
  assert.deepEqual(committed.rows[0], { approvals: 1, outbox: 2, audit: 2, idempotency: 1 });

  const library = await fetch(`${dashboardOrigin}/api/content`, { headers: { Cookie: jar.join("; ") } });
  assert.equal(library.status, 200);
  const libraryBody = await library.json();
  assert.ok(libraryBody.items.some((item) => item.id === contentId && item.status === "approved"));
  assert.equal(libraryBody.integration.postiz_ready, true);
  assert.equal(libraryBody.integration.can_request_draft, true);

  const handoffHeaders = {
    Cookie: jar.join("; "), Origin: dashboardOrigin, "Idempotency-Key": "integration-postiz-1",
  };
  const handoff = await fetch(`${dashboardOrigin}/api/content/${contentId}/postiz-draft`, {
    method: "POST", headers: handoffHeaders,
  });
  assert.equal(handoff.status, 202);
  const handoffBody = await handoff.json();
  assert.equal(handoffBody.status, "queued");
  assert.equal(handoffBody.delivery, "queued_for_inactive_workflow");
  const handoffReplay = await fetch(`${dashboardOrigin}/api/content/${contentId}/postiz-draft`, {
    method: "POST", headers: handoffHeaders,
  });
  assert.equal(handoffReplay.status, 202);
  assert.equal(handoffReplay.headers.get("Idempotency-Replayed"), "true");
  const handoffState = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM tanaghom.agent_jobs
         WHERE job_type='content.postiz.draft' AND input->>'content_item_id'=($1::uuid)::text) jobs,
       (SELECT count(*)::int FROM tanaghom.external_operations
         WHERE idempotency_key='postiz-draft:' || ($1::uuid)::text) operations,
       (SELECT count(*)::int FROM tanaghom.posts WHERE content_item_id=$1::uuid) posts`,
    [contentId],
  );
  assert.deepEqual(handoffState.rows[0], { jobs: 1, operations: 0, posts: 0 });
  const claimed = await pool.query(`SELECT * FROM tanaghom.claim_postiz_draft_job()`);
  assert.equal(claimed.rows[0].job_id, handoffBody.job_id);
  const prepared = await pool.query(`SELECT * FROM tanaghom.prepare_postiz_draft($1::uuid)`, [handoffBody.job_id]);
  const gateway = await fetch(`${dashboardOrigin}/api/internal/integrations/postiz/draft`, {
    method: "POST",
    headers: { Authorization: "Bearer integration-worker-token-at-least-32-characters", "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: handoffBody.job_id, request_body: prepared.rows[0].request_body }),
  });
  assert.equal(gateway.status, 200);
  const gatewayBody = await gateway.json();
  assert.equal(gatewayBody[0].postId, "gateway-draft-1");
  assert.equal(providerDraftRequests, 1);
  const gatewayReplay = await fetch(`${dashboardOrigin}/api/internal/integrations/postiz/draft`, {
    method: "POST",
    headers: { Authorization: "Bearer integration-worker-token-at-least-32-characters", "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: handoffBody.job_id, request_body: prepared.rows[0].request_body }),
  });
  assert.equal(gatewayReplay.status, 409);
  assert.equal(providerDraftRequests, 1);
  await pool.query(`SELECT tanaghom.complete_postiz_draft($1::uuid, $2::text, $3::jsonb)`, [
    handoffBody.job_id, gatewayBody[0].postId, JSON.stringify(gatewayBody[0]),
  ]);
  const queuedLibrary = await fetch(`${dashboardOrigin}/api/content`, { headers: { Cookie: jar.join("; ") } });
  const queuedLibraryBody = await queuedLibrary.json();
  assert.ok(queuedLibraryBody.items.some((item) => item.id === contentId && item.handoff_status === "succeeded" && item.post_status === "draft"));

  const livePost = await pool.query(`UPDATE tanaghom.posts
    SET status='live'
    WHERE content_item_id=$1::uuid RETURNING id`, [contentId]);
  const performanceJob = await pool.query(
    `SELECT * FROM tanaghom.queue_postiz_performance_sync($1::uuid, $2::uuid, 30)`,
    [livePost.rows[0].id, ownerId],
  );
  const claimedPerformance = await pool.query(`SELECT * FROM tanaghom.claim_postiz_performance_job()`);
  assert.equal(claimedPerformance.rows[0].job_id, performanceJob.rows[0].job_id);
  const preparedPerformance = await pool.query(
    `SELECT * FROM tanaghom.prepare_postiz_performance_sync($1::uuid)`,
    [performanceJob.rows[0].job_id],
  );
  const analyticsGateway = await fetch(`${dashboardOrigin}/api/internal/integrations/postiz/analytics`, {
    method: "POST",
    headers: { Authorization: "Bearer integration-worker-token-at-least-32-characters", "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: performanceJob.rows[0].job_id,
      request_body: preparedPerformance.rows[0].request_body,
    }),
  });
  assert.equal(analyticsGateway.status, 200);
  assert.equal(providerAnalyticsRequests, 1);
  assert.equal((await analyticsGateway.json())[0].label, "Impressions");
  await pool.query(`SELECT tanaghom.complete_postiz_performance_sync($1::uuid, $2::jsonb)`, [
    performanceJob.rows[0].job_id,
    JSON.stringify({
      contract_version: "phase4.postiz-performance-result.v1",
      metrics: [
        { metric_key: "impressions", metric_label: "Impressions", observed_on: "2026-07-12", value: "1500" },
        { metric_key: "likes", metric_label: "Likes", observed_on: "2026-07-12", value: "120" },
      ],
    }),
  ]);
  const operations = await fetch(`${dashboardOrigin}/api/operations`, { headers: { Cookie: jar.join("; ") } });
  assert.equal(operations.status, 200);
  const operationsBody = await operations.json();
  assert.equal(Number(operationsBody.performance.impressions), 1500);
  assert.ok(operationsBody.post_performance.some((post) =>
    post.id === livePost.rows[0].id && Number(post.metrics.impressions) === 1500));
  assert.ok(operationsBody.campaign_performance.some((campaign) =>
    campaign.campaign_id === campaignId && Number(campaign.impressions) === 1500));
  assert.deepEqual(
    {
      business_roles: operationsBody.agent_registry.summary.business_roles,
      specialized_workers: operationsBody.agent_registry.summary.specialized_workers,
      imported: operationsBody.agent_registry.summary.imported,
      active: operationsBody.agent_registry.summary.active,
    },
    { business_roles: 4, specialized_workers: 8, imported: 4, active: 0 },
  );
  assert.deepEqual(
    operationsBody.agent_registry.roles.map((role) => role.code),
    ["campaign_strategist", "content_producer", "publisher_monitor", "sales_crm"],
  );
  assert.equal(
    operationsBody.agent_registry.roles.flatMap((role) => role.workers).length,
    8,
  );
  assert.ok(operationsBody.agent_registry.roles.flatMap((role) => role.workers)
    .every((worker) => worker.blockers.some((condition) =>
      condition.code === "workflow_inactive" || condition.code === "workflow_not_imported")));
  assert.deepEqual(
    operationsBody.skill_registry.summary,
    { total: 8, platform: 8, organization: 0, published: 8 },
  );
  assert.equal(operationsBody.skill_registry.contract_version, "tanaghom.skill-registry.v1");
  assert.equal(new Set(operationsBody.skill_registry.skills.map((skill) => skill.code)).size, 8);
  assert.equal(
    operationsBody.skill_registry.skills.flatMap((skill) => skill.bindings).length,
    8,
  );
  assert.ok(operationsBody.skill_registry.skills.every((skill) =>
    skill.organization_id === null
    && skill.lifecycle_state === "published"
    && skill.permission_manifest.operations.length > 0
    && !JSON.stringify(skill.permission_manifest).includes("*")));

  const pauseMode = await fetch(`${dashboardOrigin}/api/admin/automation/postiz`, {
    method: "PUT",
    headers: { Cookie: jar.join("; "), Origin: dashboardOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "paused" }),
  });
  assert.equal(pauseMode.status, 200);
  const pausedContentId = await createContent(4);
  const approveWhilePaused = await fetch(`${dashboardOrigin}/api/approvals/${pausedContentId}/decision`, {
    method: "POST",
    headers: { ...decisionHeaders, "Idempotency-Key": "integration-paused-approval" },
    body: decisionBody,
  });
  assert.equal(approveWhilePaused.status, 200);
  assert.equal((await approveWhilePaused.json()).postiz_draft.reason, "paused");
  const blockedByPause = await fetch(`${dashboardOrigin}/api/content/${pausedContentId}/postiz-draft`, {
    method: "POST",
    headers: { ...handoffHeaders, "Idempotency-Key": "integration-postiz-paused" },
  });
  assert.equal(blockedByPause.status, 409);
  assert.equal((await blockedByPause.json()).error, "postiz_automation_paused");

  const unapprovedContentId = await createContent(2);
  const blockedHandoff = await fetch(`${dashboardOrigin}/api/content/${unapprovedContentId}/postiz-draft`, {
    method: "POST",
    headers: { ...handoffHeaders, "Idempotency-Key": "integration-postiz-unapproved" },
  });
  assert.equal(blockedHandoff.status, 409);
  assert.equal((await blockedHandoff.json()).error, "content_not_approved");

  const disconnectedPostiz = await fetch(`${dashboardOrigin}/api/admin/integrations/postiz`, {
    method: "DELETE", headers: { Cookie: jar.join("; "), Origin: dashboardOrigin },
  });
  assert.equal(disconnectedPostiz.status, 200);
  const disconnectedState = await pool.query(`SELECT status, credential_ciphertext IS NULL AS secret_destroyed,
    (SELECT count(*)::int FROM tanaghom.publishing_channels WHERE provider='postiz') mappings
    FROM tanaghom.integration_connections WHERE provider='postiz'`);
  assert.deepEqual(disconnectedState.rows[0], { status: "disconnected", secret_destroyed: true, mappings: 0 });

  const team = await fetch(`${dashboardOrigin}/api/admin/users`, { headers: { Cookie: jar.join("; ") } });
  assert.equal(team.status, 200);
  assert.equal((await team.json()).current_user_id, ownerId);
  const invite = await fetch(`${dashboardOrigin}/api/admin/users`, {
    method: "POST",
    headers: { Cookie: jar.join("; "), Origin: dashboardOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "reviewer@example.test", display_name: "Integration Reviewer", role: "reviewer" }),
  });
  assert.equal(invite.status, 201);
  const invitedUserId = (await invite.json()).user_id;
  const ownDemotion = await fetch(`${dashboardOrigin}/api/admin/users/${ownerId}`, {
    method: "PATCH",
    headers: { Cookie: jar.join("; "), Origin: dashboardOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "viewer", is_active: true }),
  });
  assert.equal(ownDemotion.status, 409);
  assert.equal((await ownDemotion.json()).error, "cannot_change_own_owner_access");

  const inviteToken = await accessToken(3600, invitedSubject, "reviewer@example.test");
  const accepted = await fetch(`${dashboardOrigin}/api/auth/accept-invite`, {
    method: "POST",
    headers: { Authorization: `Bearer ${inviteToken}`, Origin: dashboardOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "integration-reviewer-pass", refresh_token: "integration-invite-refresh" }),
  });
  assert.equal(accepted.status, 200);
  assert.ok(cookieValue(cookies(accepted), "tanaghom_access_token"));
  const invitedRecord = await pool.query(
    `SELECT role, is_active, accepted_at IS NOT NULL AS accepted,
            (SELECT count(*)::int FROM tanaghom.agent_actions_log WHERE entity_id = $1) AS audits
       FROM tanaghom.app_users WHERE id = $1`, [invitedUserId],
  );
  assert.deepEqual(invitedRecord.rows[0], { role: "reviewer", is_active: true, accepted: true, audits: 2 });

  const atomicContentId = await createContent(3);
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
  console.log("PASS: sessions, controlled campaign lifecycle, approvals, encrypted integrations, Postiz performance, contact-only GHL sync, gateway isolation, Content Library, and invitations verified.");
} finally {
  if (dashboard && dashboard.exitCode === null) dashboard.kill("SIGTERM");
  authServer.close();
  providerServer.close();
  await pool.query("DROP TRIGGER IF EXISTS integration_reject_outbox ON tanaghom.outbox_events").catch(() => {});
  await pool.query("DROP FUNCTION IF EXISTS tanaghom.integration_reject_outbox()").catch(() => {});
  await pool.end();
}
