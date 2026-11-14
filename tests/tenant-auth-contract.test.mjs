import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("signup creates an organisation, owner membership, and profile in one transaction", async () => {
  const store = await read("deployment/dashboard-demo/auth/store.mjs");
  assert.match(store, /async signup\(/);
  assert.match(store, /BEGIN/);
  assert.match(store, /COMMIT/);
  assert.match(store, /ROLLBACK/);
  assert.match(store, /INSERT INTO tanaghom\.organizations[\s\S]*'trialing'/);
  assert.match(store, /INSERT INTO tanaghom\.memberships[\s\S]*'owner'/);
  assert.match(store, /INSERT INTO tanaghom\.app_users[\s\S]*'owner'/);
  assert.match(store, /email_taken/);
  // The organization name is the only tenant input; ids are generated server-side.
  assert.doesNotMatch(store, /organizationId:\s*body/);
});

test("the signup route is same-origin, bilingual, and sets HttpOnly sessions", async () => {
  const route = await read("apps/dashboard/app/api/auth/signup/route.ts");
  assert.match(route, /hasValidSameOrigin/);
  assert.match(route, /invalid_origin/);
  assert.match(route, /locale: body\.locale === "ar" \? "ar" : "en"/);
  assert.match(route, /setSessionCookies/);
  assert.match(route, /email_taken/);
  assert.doesNotMatch(route, /organization_id/, "the client cannot choose a tenant id");
});

test("signup and session UI ship English and Arabic copy", async () => {
  const copy = await read("apps/dashboard/lib/i18n/auth.ts");
  assert.match(copy, /signupTitle: "Create your workspace"/);
  assert.match(copy, /signupTitle: "أنشئ مساحة عملك"/);
  assert.match(copy, /sessionsTitle: "Active sessions"/);
  assert.match(copy, /sessionsTitle: "الجلسات النشطة"/);

  const page = await read("apps/dashboard/app/signup/page.tsx");
  assert.match(page, /creativeLocale/);
  assert.match(page, /dir=\{dir\}/);
  assert.match(page, /SignupForm/);

  const sessions = await read("apps/dashboard/components/session-list.tsx");
  assert.match(sessions, /\/api\/auth\/sessions/);
  assert.match(sessions, /reauthenticate/);
});

test("authorization is derived from the live session row and tenant membership", async () => {
  const authorization = await read("apps/dashboard/lib/server/authorization.ts");
  assert.match(authorization, /UPDATE tanaghom\.sessions/);
  assert.match(authorization, /expires_at > now\(\)/);
  assert.match(authorization, /last_seen_at > now\(\) - interval '30 minutes'/);
  assert.match(authorization, /JOIN tanaghom\.memberships m/);
  assert.match(authorization, /m\.is_active/);
  assert.match(authorization, /au\.organization_id = \$3::uuid/);
  assert.match(authorization, /identity\.organization_id/);
  assert.doesNotMatch(authorization, /searchParams|body\.organization/);
});

test("the proxy protects every page except the public auth entry points", async () => {
  const proxy = await read("apps/dashboard/proxy.ts");
  for (const path of ["/login", "/signup", "/verify-email", "/forgot-password", "/reset-password", "/accept-invite"]) {
    assert.ok(proxy.includes(`"${path}"`), `${path} must be public`);
  }
  assert.match(proxy, /tanaghom_access_token/);
  assert.match(proxy, /NextResponse\.redirect/);
});

test("session management lists and revokes only the caller's sessions", async () => {
  const server = await read("deployment/dashboard-demo/auth/server.mjs");
  assert.match(server, /store\.listSessions\(identity\.user\.sub, identity\.claims\.session_id\)/);
  assert.match(server, /store\.revokeSession\(id, identity\.user\.sub\)/);
  assert.match(server, /reauthenticate/);

  const route = await read("apps/dashboard/app/api/auth/sessions/route.ts");
  assert.match(route, /ACCESS_COOKIE/);
  assert.match(route, /hasValidSameOrigin/);
  assert.match(route, /session_id_required/);
});
