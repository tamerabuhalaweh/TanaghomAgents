import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = new URL("../apps/dashboard/", import.meta.url);

test("dashboard exposes the Phase 2 operational routes", async () => {
  const routes = ["app/page.tsx", "app/approvals/page.tsx", "app/campaigns/page.tsx", "app/agents/page.tsx", "app/leads/page.tsx", "app/reports/page.tsx", "app/system/page.tsx"];
  await Promise.all(routes.map((route) => readFile(new URL(route, dashboard), "utf8")));
});

test("live approval workspace queues decisions without direct external calls", async () => {
  const source = await readFile(new URL("components/approval-workspace.tsx", dashboard), "utf8");
  assert.match(source, /Publishing work has been queued/);
  assert.doesNotMatch(source, /axios|https?:\/\//);
});

test("dashboard includes reduced-motion and responsive navigation behavior", async () => {
  const css = await readFile(new URL("app/globals.css", dashboard), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.mobile-navigation/);
  assert.match(css, /min-height: 2\.75rem/);
});

test("server API verifies Supabase JWTs and keeps fixture UI disconnected", async () => {
  const auth = await readFile(new URL("lib/server/auth.ts", dashboard), "utf8");
  const approvals = await readFile(new URL("app/api/approvals/route.ts", dashboard), "utf8");
  const readme = await readFile(new URL("README.md", dashboard), "utf8");
  assert.match(auth, /jwtVerify/);
  assert.match(auth, /audience: "authenticated"/);
  assert.match(approvals, /pending_approval/);
  assert.doesNotMatch(approvals, /UPDATE|INSERT|DELETE/);
  assert.match(readme, /They do not call n8n or an external service/);
});

test("approval decisions are transactional, idempotent, audited, and queued", async () => {
  const source = await readFile(new URL("lib/server/content-decision.ts", dashboard), "utf8");
  assert.match(source, /api_idempotency_keys/);
  assert.match(source, /content_approvals/);
  assert.match(source, /agent_actions_log/);
  assert.match(source, /outbox_events/);
  assert.match(source, /BEGIN/);
  assert.match(source, /COMMIT/);
  assert.match(source, /ROLLBACK/);
  assert.doesNotMatch(source, /fetch\(|axios|https?:\/\//);
});

test("login uses server-mediated Supabase Auth and HttpOnly session cookies", async () => {
  const route = await readFile(new URL("app/api/auth/login/route.ts", dashboard), "utf8");
  const form = await readFile(new URL("components/login-form.tsx", dashboard), "utf8");
  assert.match(route, /grant_type=password/);
  assert.match(route, /httpOnly: true/);
  assert.match(route, /sameSite: "strict"/);
  assert.doesNotMatch(form, /SUPABASE|publishable|apikey/);
});

test("page protection stays optimistic while data authorization remains server-side", async () => {
  const proxy = await readFile(new URL("proxy.ts", dashboard), "utf8");
  const session = await readFile(new URL("app/api/auth/session/route.ts", dashboard), "utf8");
  const decision = await readFile(new URL("lib/server/content-decision.ts", dashboard), "utf8");
  assert.match(proxy, /tanaghom_access_token/);
  assert.match(proxy, /NextResponse\.redirect/);
  assert.match(session, /authorize/);
  assert.match(decision, /enforceSameOriginForCookieMutation/);
});

test("approvals and audit activity load live data with honest operational states", async () => {
  const approvals = await readFile(new URL("components/approval-workspace.tsx", dashboard), "utf8");
  const activity = await readFile(new URL("components/live-activity.tsx", dashboard), "utf8");
  assert.match(approvals, /fetch\("\/api\/approvals"/);
  assert.match(approvals, /Approval queue is clear/);
  assert.match(approvals, /approval request failed/);
  assert.match(activity, /fetch\("\/api\/audit\?limit=20"/);
  assert.doesNotMatch(approvals, /@\/data\/fixtures/);
  assert.doesNotMatch(activity, /@\/data\/fixtures/);
});

test("shared shell uses live session identity and no fixture notification counts", async () => {
  const shell = await readFile(new URL("components/app-shell.tsx", dashboard), "utf8");
  const profile = await readFile(new URL("components/session-profile.tsx", dashboard), "utf8");
  assert.match(shell, /SessionProfile/);
  assert.match(profile, /fetch\("\/api\/auth\/session"/);
  assert.doesNotMatch(shell, /Kim Morgan|count: 3|2 alerts/);
});
