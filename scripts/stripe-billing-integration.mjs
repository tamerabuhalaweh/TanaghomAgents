import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

import { SignJWT, exportJWK, generateKeyPair } from "jose";
import pg from "pg";

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required");

const authPort = 43195;
const dashboardPort = 43196;
const stripePort = 43197;
const authOrigin = `http://127.0.0.1:${authPort}`;
const dashboardOrigin = `http://127.0.0.1:${dashboardPort}`;
const stripeOrigin = `http://127.0.0.1:${stripePort}`;
const ownerSubject = "90000000-0000-4000-8000-000000000001";
const operatorSubject = "90000000-0000-4000-8000-000000000201";
const viewerSubject = "90000000-0000-4000-8000-000000000202";
const tenantBSubject = "90000000-0000-4000-8000-000000000203";
const tenantBOrganization = "90000000-0000-4000-8000-000000000210";
const operatorId = "90000000-0000-4000-8000-000000000221";
const viewerId = "90000000-0000-4000-8000-000000000222";
const tenantBActorId = "90000000-0000-4000-8000-000000000223";
const stripeSecret = "sk_test_tanaghom_integration";
const webhookSecret = "whsec_tanaghom_integration";
const growthPrice = "price_growth_integration";
const periodEnd = 1_900_000_000;
const startedAt = 1_800_000_000;
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = { ...await exportJWK(publicKey), kid: "billing-integration-key", alg: "RS256", use: "sig" };

let dashboard;
let dashboardOutput = "";
let stripeRequests = 0;
let lastCheckoutForm;
let lastCustomerForm;
let lastPortalForm;

async function token(subject, email) {
  return new SignJWT({ role: "authenticated", email })
    .setProtectedHeader({ alg: "RS256", kid: "billing-integration-key" })
    .setIssuer(`${authOrigin}/auth/v1`)
    .setAudience("authenticated")
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const authServer = createServer((request, response) => {
  if (request.url === "/auth/v1/.well-known/jwks.json") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ keys: [publicJwk] }));
    return;
  }
  response.writeHead(404).end();
});

const stripeServer = createServer(async (request, response) => {
  stripeRequests += 1;
  assert.equal(request.headers.authorization, `Bearer ${stripeSecret}`);
  assert.equal(request.headers["content-type"], "application/x-www-form-urlencoded");
  const body = new URLSearchParams(await requestBody(request));
  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }
  if (request.url === "/v1/customers") {
    lastCustomerForm = body;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "cus_TenantAIntegration" }));
    return;
  }
  if (request.url === "/v1/checkout/sessions") {
    lastCheckoutForm = body;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      id: "cs_test_tenant_a",
      url: "https://checkout.stripe.test/session/cs_test_tenant_a",
    }));
    return;
  }
  if (request.url === "/v1/billing_portal/sessions") {
    lastPortalForm = body;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ url: "https://billing.stripe.test/session/portal" }));
    return;
  }
  response.writeHead(404).end();
});

const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });

function cookieHeaderFromToken(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function billing(accessToken) {
  const response = await fetch(`${dashboardOrigin}/api/billing`, {
    headers: cookieHeaderFromToken(accessToken),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, `GET /api/billing failed: ${JSON.stringify(body)}`);
  return body;
}

function event(type, created, object, id = `evt_${randomUUID()}`) {
  return { id, type, created, data: { object } };
}

async function webhook(payload, { signature, raw } = {}) {
  const body = raw ?? JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signatureHeader = signature ?? `t=${timestamp},v1=${createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`, "utf8").digest("hex")}`;
  const response = await fetch(`${dashboardOrigin}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signatureHeader },
    body,
  });
  const json = await response.json().catch(() => ({}));
  return { response, json };
}

async function waitForDashboard(child) {
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; dashboardOutput += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; dashboardOutput += chunk; });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`dashboard exited early\n${output}`);
    try {
      const response = await fetch(`${dashboardOrigin}/api/health`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`dashboard did not become ready\n${output}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

try {
  authServer.listen(authPort, "127.0.0.1");
  await once(authServer, "listening");
  stripeServer.listen(stripePort, "127.0.0.1");
  await once(stripeServer, "listening");

  const ownerRow = await pool.query(
    `SELECT id, organization_id FROM tanaghom.app_users WHERE auth_subject = $1::uuid`,
    [ownerSubject],
  );
  assert.equal(ownerRow.rows.length, 1, "staging seed owner must exist");
  const ownerId = ownerRow.rows[0].id;
  const organizationId = ownerRow.rows[0].organization_id;

  await pool.query(
    `UPDATE tanaghom.organizations
        SET status = 'trialing', stripe_customer_id = NULL
      WHERE id = $1::uuid`,
    [organizationId],
  );
  // The production audit table is immutable by trigger. This disposable test
  // database needs a clean billing ledger between runs, so disable only the
  // delete guard for the cleanup statement and re-enable it immediately.
  await pool.query("ALTER TABLE tanaghom.agent_actions_log DISABLE TRIGGER audit_no_delete");
  try {
    await pool.query(
      `DELETE FROM tanaghom.agent_actions_log
        WHERE organization_id = $1::uuid AND action_type LIKE 'billing.%'`,
      [organizationId],
    );
  } finally {
    await pool.query("ALTER TABLE tanaghom.agent_actions_log ENABLE TRIGGER audit_no_delete");
  }
  await pool.query(
    `INSERT INTO tanaghom.organizations (id, slug, name, status, stripe_customer_id)
     VALUES ($1, 'billing-tenant-b', 'Billing Tenant B', 'trialing', 'cus_TenantBIntegration')
     ON CONFLICT (id) DO UPDATE SET status = 'trialing', stripe_customer_id = 'cus_TenantBIntegration'`,
    [tenantBOrganization],
  );
  await pool.query(
    `DELETE FROM tanaghom.app_users
      WHERE id = ANY($1::uuid[]) OR auth_subject = ANY($2::uuid[])`,
    [[operatorId, viewerId, tenantBActorId], [operatorSubject, viewerSubject, tenantBSubject]],
  );
  await pool.query(
    `INSERT INTO tanaghom.app_users
       (id, email, display_name, kind, role, organization_id, auth_subject, accepted_at)
     VALUES
       ($1, 'billing-operator@example.test', 'Billing Operator', 'human', 'operator', $4::uuid, $5::uuid, now()),
       ($2, 'billing-viewer@example.test', 'Billing Viewer', 'human', 'viewer', $4::uuid, $6::uuid, now()),
       ($3, 'billing-tenant-b@example.test', 'Billing Tenant B Owner', 'human', 'owner', $7::uuid, $8::uuid, now())`,
    [operatorId, viewerId, tenantBActorId, organizationId, operatorSubject, viewerSubject, tenantBOrganization, tenantBSubject],
  );

  dashboard = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "apps/dashboard", "-p", String(dashboardPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_ENV: "integration",
      APP_BASE_URL: dashboardOrigin,
      DATABASE_URL: databaseUrl,
      SUPABASE_URL: authOrigin,
      SUPABASE_JWKS_URL: `${authOrigin}/auth/v1/.well-known/jwks.json`,
      SUPABASE_PUBLISHABLE_KEY: "billing-integration-publishable-key",
      STRIPE_SECRET_KEY: stripeSecret,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      STRIPE_PRICE_ID_STARTER: "price_starter_integration",
      STRIPE_PRICE_ID_GROWTH: growthPrice,
      STRIPE_PRICE_ID_SCALE: "price_scale_integration",
      STRIPE_CURRENCY: "gbp",
      STRIPE_AUTOMATIC_TAX: "false",
      STRIPE_API_BASE_URL: stripeOrigin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForDashboard(dashboard);

  const ownerToken = await token(ownerSubject, "owner@example.test");
  const operatorToken = await token(operatorSubject, "billing-operator@example.test");
  const viewerToken = await token(viewerSubject, "billing-viewer@example.test");

  const initial = await billing(ownerToken);
  assert.equal(initial.subscription_status, "trialing");
  assert.equal(initial.billing_configured, true);
  assert.equal(initial.can_manage_billing, true);
  assert.equal(initial.has_stripe_customer, false);
  assert.equal(initial.plan_tier, null);
  assert.deepEqual(initial.plans.map((plan) => plan.id), ["starter", "growth", "scale"]);
  assert.deepEqual(initial.plans.map((plan) => plan.amount_minor), [24_900, 49_900, 79_900]);
  assert.equal(initial.currency, "gbp");

  const nonOwner = await billing(operatorToken);
  assert.equal(nonOwner.can_manage_billing, false);
  assert.equal(nonOwner.stripe_customer_id_masked, null);

  const operatorCheckout = await fetch(`${dashboardOrigin}/api/billing/checkout`, {
    method: "POST",
    headers: { ...cookieHeaderFromToken(operatorToken), "Content-Type": "application/json" },
    body: JSON.stringify({ plan_tier: "growth" }),
  });
  assert.equal(operatorCheckout.status, 403);

  const viewerPortal = await fetch(`${dashboardOrigin}/api/billing/portal`, {
    method: "POST",
    headers: cookieHeaderFromToken(viewerToken),
  });
  assert.equal(viewerPortal.status, 403);

  const invalidTier = await fetch(`${dashboardOrigin}/api/billing/checkout`, {
    method: "POST",
    headers: { ...cookieHeaderFromToken(ownerToken), "Content-Type": "application/json" },
    body: JSON.stringify({ plan_tier: "enterprise" }),
  });
  assert.equal(invalidTier.status, 400);
  assert.equal((await invalidTier.json()).error, "invalid_plan_tier");

  const checkout = await fetch(`${dashboardOrigin}/api/billing/checkout`, {
    method: "POST",
    headers: { ...cookieHeaderFromToken(ownerToken), "Content-Type": "application/json" },
    body: JSON.stringify({ plan_tier: "growth" }),
  });
  assert.equal(checkout.status, 200);
  const checkoutBody = await checkout.json();
  assert.match(checkoutBody.session_id, /^cs_test_/);
  assert.equal(checkoutBody.url, "https://checkout.stripe.test/session/cs_test_tenant_a");
  assert.equal(lastCustomerForm.get("metadata[organization_id]"), organizationId);
  assert.equal(lastCheckoutForm.get("mode"), "subscription");
  assert.equal(lastCheckoutForm.get("line_items[0][price]"), growthPrice);
  assert.equal(lastCheckoutForm.get("client_reference_id"), organizationId);
  assert.equal(lastCheckoutForm.get("metadata[plan_tier]"), "growth");
  assert.equal(lastCheckoutForm.get("success_url"), `${dashboardOrigin}/settings/billing?checkout=success`);
  assert.equal(lastCheckoutForm.get("cancel_url"), `${dashboardOrigin}/settings/billing?checkout=cancelled`);

  const persisted = await pool.query(
    "SELECT stripe_customer_id FROM tanaghom.organizations WHERE id = $1::uuid",
    [organizationId],
  );
  assert.equal(persisted.rows[0].stripe_customer_id, "cus_TenantAIntegration");
  assert.equal(stripeRequests, 2, "customer and checkout session calls are expected");

  const withCustomer = await billing(ownerToken);
  assert.equal(withCustomer.has_stripe_customer, true);
  assert.match(withCustomer.stripe_customer_id_masked, /^cus_.*\.\.\..{4}$/);

  const portal = await fetch(`${dashboardOrigin}/api/billing/portal`, {
    method: "POST",
    headers: cookieHeaderFromToken(ownerToken),
  });
  assert.equal(portal.status, 200);
  assert.equal((await portal.json()).url, "https://billing.stripe.test/session/portal");
  assert.equal(lastPortalForm.get("customer"), "cus_TenantAIntegration");
  assert.equal(lastPortalForm.get("return_url"), `${dashboardOrigin}/settings/billing`);

  const badSignature = await webhook(
    event("checkout.session.completed", startedAt, {
      id: "cs_test_tenant_a",
      customer: "cus_TenantAIntegration",
      metadata: { organization_id: organizationId, plan_tier: "growth" },
    }),
    { signature: `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` },
  );
  assert.equal(badSignature.response.status, 400);
  assert.equal(badSignature.json.error, "invalid_stripe_signature");

  const tooLarge = await webhook(
    {},
    { raw: "x".repeat(262_145), signature: `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` },
  );
  assert.equal(tooLarge.response.status, 413);

  const checkoutEvent = event("checkout.session.completed", startedAt + 10, {
    id: "cs_test_tenant_a",
    customer: "cus_TenantAIntegration",
    subscription: "sub_tenant_a",
    metadata: { organization_id: organizationId, plan_tier: "growth" },
    client_reference_id: organizationId,
  });
  const checkoutWebhook = await webhook(checkoutEvent);
  assert.equal(checkoutWebhook.response.status, 200);
  assert.equal(checkoutWebhook.json.received, true);

  const subscriptionEvent = event("customer.subscription.updated", startedAt + 20, {
    id: "sub_tenant_a",
    customer: "cus_TenantAIntegration",
    status: "active",
    currency: "gbp",
    current_period_end: periodEnd,
    cancel_at_period_end: false,
    metadata: { organization_id: organizationId, plan_tier: "growth" },
    items: { data: [{ price: { id: growthPrice } }] },
  });
  assert.equal((await webhook(subscriptionEvent)).response.status, 200);

  const active = await billing(ownerToken);
  assert.equal(active.subscription_status, "active");
  assert.equal(active.plan_tier, "growth");
  assert.equal(active.stripe_price_id, growthPrice);
  assert.equal(active.current_period_end, new Date(periodEnd * 1_000).toISOString());
  assert.equal(active.cancel_at_period_end, false);

  const failedEvent = event("invoice.payment_failed", startedAt + 30, {
    id: "in_tenant_a_failed",
    customer: "cus_TenantAIntegration",
    subscription: "sub_tenant_a",
    currency: "gbp",
    lines: { data: [{ price: { id: growthPrice }, period: { end: periodEnd } }] },
  });
  assert.equal((await webhook(failedEvent)).response.status, 200);
  const pastDue = await billing(ownerToken);
  assert.equal(pastDue.subscription_status, "past_due");
  assert.equal(pastDue.plan_tier, "growth");
  assert.equal(pastDue.current_period_end, new Date(periodEnd * 1_000).toISOString());

  const paidEvent = event("invoice.paid", startedAt + 40, {
    id: "in_tenant_a_paid",
    customer: "cus_TenantAIntegration",
    subscription: "sub_tenant_a",
    currency: "gbp",
    lines: { data: [{ price: { id: growthPrice }, period: { end: periodEnd } }] },
  });
  assert.equal((await webhook(paidEvent)).response.status, 200);
  assert.equal((await billing(ownerToken)).subscription_status, "active");

  const beforeDuplicate = await pool.query(
    `SELECT count(*)::int AS count FROM tanaghom.agent_actions_log
      WHERE organization_id = $1::uuid AND action_type LIKE 'billing.webhook.%'`,
    [organizationId],
  );
  const duplicate = await webhook(paidEvent);
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.json.duplicate, true);
  const afterDuplicate = await pool.query(
    `SELECT count(*)::int AS count FROM tanaghom.agent_actions_log
      WHERE organization_id = $1::uuid AND action_type LIKE 'billing.webhook.%'`,
    [organizationId],
  );
  assert.equal(afterDuplicate.rows[0].count, beforeDuplicate.rows[0].count);

  const deletedEvent = event("customer.subscription.deleted", startedAt + 50, {
    id: "sub_tenant_a",
    customer: "cus_TenantAIntegration",
    status: "canceled",
    currency: "gbp",
    metadata: { organization_id: organizationId },
    items: { data: [{ price: { id: growthPrice } }] },
  });
  assert.equal((await webhook(deletedEvent)).response.status, 200);
  const canceled = await billing(ownerToken);
  assert.equal(canceled.subscription_status, "canceled");

  const staleEvent = event("customer.subscription.updated", startedAt + 5, {
    id: "sub_tenant_a",
    customer: "cus_TenantAIntegration",
    status: "active",
    currency: "gbp",
    current_period_end: periodEnd,
    metadata: { organization_id: organizationId, plan_tier: "growth" },
    items: { data: [{ price: { id: growthPrice } }] },
  });
  const stale = await webhook(staleEvent);
  assert.equal(stale.response.status, 200);
  assert.equal(stale.json.stale_ignored, true);
  assert.equal((await billing(ownerToken)).subscription_status, "canceled");

  const staleRow = await pool.query(
    `SELECT payload FROM tanaghom.agent_actions_log
      WHERE organization_id = $1::uuid AND payload->>'stripe_event_id' = $2`,
    [organizationId, staleEvent.id],
  );
  assert.equal(staleRow.rows[0].payload.stale_ignored, true);
  assert.equal(staleRow.rows[0].payload.plan_tier, "growth");

  const conflictEvent = event("customer.subscription.updated", startedAt + 60, {
    id: "sub_tenant_a",
    customer: "cus_TenantBIntegration",
    status: "active",
    metadata: { organization_id: organizationId, plan_tier: "growth" },
  });
  const conflict = await webhook(conflictEvent);
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.json.error, "stripe_customer_conflict");
  const tenantB = await pool.query(
    "SELECT status, stripe_customer_id FROM tanaghom.organizations WHERE id = $1::uuid",
    [tenantBOrganization],
  );
  assert.deepEqual(tenantB.rows[0], { status: "trialing", stripe_customer_id: "cus_TenantBIntegration" });

  console.log("STRIPE_BILLING_INTEGRATION_PASSED");
} catch (error) {
  console.error("DASHBOARD_OUTPUT_START");
  console.error(dashboardOutput.slice(-12_000));
  console.error("DASHBOARD_OUTPUT_END");
  throw error;
} finally {
  await stopChild(dashboard);
  await pool.end().catch(() => undefined);
  await new Promise((resolve) => authServer.close(resolve));
  await new Promise((resolve) => stripeServer.close(resolve));
}
