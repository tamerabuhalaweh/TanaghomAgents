import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const baseUrl = (process.env.DEMO_BASE_URL ?? "http://127.0.0.1:3210").replace(/\/$/, "");
const usersFile = process.env.DEMO_AUTH_USERS_FILE ?? "/run/secrets/auth_users";
const writeMode = process.env.SMOKE_WRITE === "1";
assert.equal(
  process.env.SMOKE_REJECT !== "1" || writeMode,
  true,
  "SMOKE_REJECT=1 requires SMOKE_WRITE=1",
);
const smokeApprovalId = process.env.SMOKE_APPROVAL_ID ?? "22000000-0000-4000-8000-000000000003";
const smokeRejectId = process.env.SMOKE_REJECT_ID ?? "22000000-0000-4000-8000-000000000002";
const pass = (message) => console.log(`PASS ${message}`);

const users = JSON.parse(readFileSync(usersFile, "utf8")).users;
const owner = users.find((user) => user.email === "owner@demo.tanaghom.test");
const reviewer = users.find((user) => user.email === "reviewer@demo.tanaghom.test");
assert.ok(owner && reviewer, "demo owner and reviewer fixtures are required");

class CookieJar {
  constructor() { this.values = new Map(); }
  absorb(response) {
    const list = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
    for (const header of list) {
      const pair = header.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index > 0) this.values.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
  header(extra = "") {
    const values = [...this.values].map(([name, value]) => `${name}=${value}`);
    if (extra) values.push(extra);
    return values.join("; ");
  }
}

async function request(path, { method = "GET", jar, body, headers = {}, unauth = false } = {}) {
  const requestHeaders = { ...headers };
  if (!unauth && jar) requestHeaders.Cookie = headers.Cookie ?? jar.header();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  if (!unauth && jar) jar.absorb(response);
  return response;
}

async function json(response) {
  return response.json();
}

async function login(email, password) {
  const jar = new CookieJar();
  const response = await request("/api/auth/login", {
    method: "POST",
    jar,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `login failed for ${email}`);
  return jar;
}

async function page(jar, path, text) {
  const response = await request(path, { jar });
  assert.equal(response.status, 200, `${path} should render`);
  const html = await response.text();
  assert.ok(html.includes(text), `${path} should contain ${text}`);
}

assert.equal((await request("/api/approvals", { unauth: true })).status, 401);
assert.equal((await request("/api/admin/users", { unauth: true })).status, 401);
assert.equal((await request("/login")).status, 200);
pass("private routes reject unauthenticated access");

const badLogin = await request("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: owner.email, password: "wrong-demo-password" }),
});
assert.equal(badLogin.status, 401);
pass("invalid credentials rejected");

const ownerJar = await login(owner.email, owner.password);
pass("owner password login");

const refresh = await request("/api/auth/refresh", {
  method: "POST",
  jar: ownerJar,
  headers: { Origin: baseUrl },
});
assert.equal(refresh.status, 200);
pass("session refresh");

const health = await request("/api/health", { jar: ownerJar });
assert.equal(health.status, 200);
const healthBody = await json(health);
assert.equal(healthBody.ok, true);
assert.equal(healthBody.components.database, "connected");
pass("health endpoint");

const campaignsResponse = await request("/api/campaigns", { jar: ownerJar });
assert.equal(campaignsResponse.status, 200);
const campaigns = await json(campaignsResponse);
assert.ok(campaigns.campaigns.some((campaign) => campaign.name === "Demo Summer Camp"));
pass("campaign list");

const approvalsResponse = await request("/api/approvals", { jar: ownerJar });
assert.equal(approvalsResponse.status, 200);
const approvals = await json(approvalsResponse);
assert.ok(approvals.items.length >= 1, "a pending seeded approval item is required");
pass("approval inbox");

const teamResponse = await request("/api/admin/users", { jar: ownerJar });
assert.equal(teamResponse.status, 200);
const team = await json(teamResponse);
assert.ok(team.users.some((user) => user.email === "reviewer@demo.tanaghom.test"));
pass("team permissions");

const templates = await json(await request("/api/creative/templates", { jar: ownerJar }));
assert.ok(templates.templates.length >= 8);
const designs = await json(await request("/api/creative/designs", { jar: ownerJar }));
assert.ok(designs.designs.length >= 8);
const motions = await json(await request("/api/creative/motions", { jar: ownerJar }));
assert.ok(motions.motions.length >= 3);
const kits = await json(await request("/api/creative/brand-kits", { jar: ownerJar }));
assert.ok(kits.kits.some((kit) => kit.name === "Demo Brand Kit"));
pass("creative templates, brand kit, design and motion starters");

await page(ownerJar, "/", "Tanaghom");
await page(ownerJar, "/campaigns", "Campaigns");
await page(ownerJar, "/approvals", "Approvals");
await page(ownerJar, "/creative", "Creative Studio");
await page(ownerJar, "/creative/brand-kits", "Brand Kits");
await page(ownerJar, "/creative/templates", "Templates");
await page(ownerJar, "/creative/designs", "Designs");
await page(ownerJar, "/creative/motion", "Motion");
await page(ownerJar, "/team", "Team &amp; access");
pass("dashboard pages");

const arabic = await request("/creative", { jar: ownerJar, headers: { Cookie: ownerJar.header("tanaghom_locale=ar") } });
assert.equal(arabic.status, 200);
assert.ok((await arabic.text()).includes('dir="rtl"'));
pass("Arabic RTL creative interface");

const disabledGeneration = await request("/api/creative/generations", {
  method: "POST",
  jar: ownerJar,
  headers: { "Content-Type": "application/json", Origin: baseUrl },
  body: JSON.stringify({ capability: "image", prompt: "demo" }),
});
assert.equal(disabledGeneration.status, 503);
assert.equal((await json(disabledGeneration)).error, "image_generation_disabled");
pass("provider generation clearly disabled");

const reviewerJar = await login(reviewer.email, reviewer.password);
const reviewerApprovals = await request("/api/approvals", { jar: reviewerJar });
assert.equal(reviewerApprovals.status, 200);
const reviewerAdmin = await request("/api/admin/users", { jar: reviewerJar });
assert.equal(reviewerAdmin.status, 403);
pass("reviewer permissions");

if (writeMode) {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY+Avy/sPAAN+AfOGGscwAAAAAElFTkSuQmCC",
    "base64",
  );
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "demo-smoke.png");
  form.append("title", "Demo smoke upload");
  const upload = await request("/api/creative/uploads", {
    method: "POST",
    jar: ownerJar,
    headers: { Origin: baseUrl, "Idempotency-Key": `demo-upload-${Date.now()}` },
    body: form,
  });
  assert.equal(upload.status, 200);
  const uploaded = await json(upload);
  const preview = await request(`/api/creative/assets/versions/${uploaded.version_id}/preview`, { jar: ownerJar });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/png");
  assert.ok((await preview.arrayBuffer()).byteLength > 0);
  pass("private S3 upload and preview");

  const pending = await json(await request("/api/approvals", { jar: reviewerJar }));
  assert.ok(
    pending.items.some((item) => item.id === smokeApprovalId),
    "SMOKE_WRITE=1 requires a pending approval fixture; reset demo data before rerunning",
  );
  {
    const decision = await request(`/api/approvals/${smokeApprovalId}/decision`, {
      method: "POST",
      jar: reviewerJar,
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        "Idempotency-Key": `demo-decision-${Date.now()}`,
      },
      body: JSON.stringify({ decision: "approved", rejection_reason: null }),
    });
    assert.equal(decision.status, 200);
    pass("reviewer approval decision");
  }

  if (process.env.SMOKE_REJECT === "1") {
    const pendingReject = await json(await request("/api/approvals", { jar: reviewerJar }));
    assert.ok(
      pendingReject.items.some((item) => item.id === smokeRejectId),
      "SMOKE_REJECT=1 requires a pending rejection fixture; reset demo data before rerunning",
    );
    {
      const rejection = await request(`/api/approvals/${smokeRejectId}/decision`, {
        method: "POST",
        jar: reviewerJar,
        headers: {
          "Content-Type": "application/json",
          Origin: baseUrl,
          "Idempotency-Key": `demo-rejection-${Date.now()}`,
        },
        body: JSON.stringify({ decision: "rejected", rejection_reason: "Synthetic demo rejection" }),
      });
      assert.equal(rejection.status, 200);
      pass("reviewer rejection decision");
    }
  }
}

console.log("DEMO_SMOKE_PASSED");
