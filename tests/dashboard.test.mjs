import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = new URL("../apps/dashboard/", import.meta.url);

test("dashboard exposes the Phase 2 operational routes", async () => {
  const routes = ["app/page.tsx", "app/approvals/page.tsx", "app/campaigns/page.tsx", "app/agents/page.tsx", "app/leads/page.tsx", "app/reports/page.tsx", "app/system/page.tsx"];
  await Promise.all(routes.map((route) => readFile(new URL(route, dashboard), "utf8")));
});

test("live approval workspace retains approved content without direct external calls", async () => {
  const source = await readFile(new URL("components/approval-workspace.tsx", dashboard), "utf8");
  assert.match(source, /available in the Content Library/);
  assert.doesNotMatch(source, /axios|https?:\/\//);
});

test("Phase 4 team management is owner-only and preserves the final admin", async () => {
  const team = await readFile(new URL("lib/server/team-management.ts", dashboard), "utf8");
  const adminApi = await readFile(new URL("app/api/admin/users/route.ts", dashboard), "utf8");
  const invite = await readFile(new URL("lib/server/supabase-admin.ts", dashboard), "utf8");
  assert.match(team, /authorize\(request, \["owner"\]\)/);
  assert.match(team, /last_owner_protected/);
  assert.match(team, /cannot_change_own_owner_access/);
  assert.match(team, /team\.user_(invited|updated)/);
  assert.match(adminApi, /kind = 'human'/);
  assert.match(invite, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch((await readFile(new URL("components/team-management.tsx", dashboard), "utf8")), /SUPABASE_SECRET_KEY|apikey/);
});

test("Content Library is live, keeps approval evidence, and guards Postiz handoff", async () => {
  const route = await readFile(new URL("app/api/content/route.ts", dashboard), "utf8");
  const component = await readFile(new URL("components/content-library.tsx", dashboard), "utf8");
  assert.match(route, /content_approvals/);
  assert.match(route, /tanaghom\.posts/);
  assert.match(route, /postiz_ready: false/);
  assert.match(component, /Send to Postiz as draft/);
  assert.match(component, /disabled=\{!integration\?\.postiz_ready\}/);
  assert.doesNotMatch(component, /@\/data\/fixtures|https?:\/\//);
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
  const cookies = await readFile(new URL("lib/server/session-cookies.ts", dashboard), "utf8");
  const form = await readFile(new URL("components/login-form.tsx", dashboard), "utf8");
  assert.match(route, /grant_type=password/);
  assert.match(route, /setSessionCookies/);
  assert.match(cookies, /httpOnly: true/);
  assert.match(cookies, /sameSite: "strict"/);
  assert.doesNotMatch(form, /SUPABASE|publishable|apikey/);
});

test("expired sessions rotate HttpOnly tokens once and retry the original request", async () => {
  const refresh = await readFile(new URL("app/api/auth/refresh/route.ts", dashboard), "utf8");
  const client = await readFile(new URL("lib/client/authenticated-fetch.ts", dashboard), "utf8");
  assert.match(refresh, /grant_type=refresh_token/);
  assert.match(refresh, /invalid_origin/);
  assert.match(refresh, /hasValidSameOrigin/);
  assert.match(refresh, /clearSessionCookies/);
  assert.match(refresh, /setSessionCookies/);
  assert.match(client, /refreshInFlight/);
  assert.match(client, /request\.clone/);
  assert.match(client, /return fetch\(retry\)/);
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
  assert.match(approvals, /authenticatedFetch\("\/api\/approvals"/);
  assert.match(approvals, /Approval queue is clear/);
  assert.match(approvals, /approval request failed/);
  assert.match(activity, /authenticatedFetch\("\/api\/audit\?limit=20"/);
  assert.doesNotMatch(approvals, /@\/data\/fixtures/);
  assert.doesNotMatch(activity, /@\/data\/fixtures/);
});

test("shared shell uses live session identity and no fixture notification counts", async () => {
  const shell = await readFile(new URL("components/app-shell.tsx", dashboard), "utf8");
  const profile = await readFile(new URL("components/session-profile.tsx", dashboard), "utf8");
  assert.match(shell, /SessionProfile/);
  assert.match(profile, /authenticatedFetch\("\/api\/auth\/session"/);
  assert.doesNotMatch(shell, /Kim Morgan|count: 3|2 alerts/);
});

test("operations API reads every remaining dashboard domain in one protected snapshot", async () => {
  const operations = await readFile(new URL("app/api/operations/route.ts", dashboard), "utf8");
  assert.match(operations, /authorize/);
  assert.match(operations, /BEGIN TRANSACTION READ ONLY/);
  for (const domain of ["campaigns", "agent_jobs", "leads", "posts", "notifications"]) {
    assert.match(operations, new RegExp(`tanaghom\\.${domain}`));
  }
  assert.doesNotMatch(operations, /INSERT|UPDATE|DELETE/);
});

test("remaining operational screens use the live snapshot without business fixtures", async () => {
  const components = await Promise.all([
    "overview-dashboard.tsx",
    "campaigns-view.tsx",
    "leads-view.tsx",
    "reports-view.tsx",
    "system-view.tsx",
  ].map((file) => readFile(new URL(`components/${file}`, dashboard), "utf8")));
  for (const source of components) {
    assert.match(source, /useOperations/);
    assert.doesNotMatch(source, /Summer Camp|339,800|1,248/);
  }
  const fixtures = await readFile(new URL("data/fixtures.ts", dashboard), "utf8");
  assert.doesNotMatch(fixtures, /export const (approvals|campaigns|recentActivity)/);
  assert.match(fixtures, /Configured role; live workflow begins/);
});

test("private dashboard canary is localhost-only, bounded, and secret-free by shape", async () => {
  const deployment = new URL("../../deployment/dashboard-canary/", dashboard);
  const compose = await readFile(new URL("docker-compose.yml", deployment), "utf8");
  const dockerfile = await readFile(new URL("Dockerfile", deployment), "utf8");
  const entrypoint = await readFile(new URL("entrypoint.sh", deployment), "utf8");
  const installer = await readFile(new URL("scripts/deploy-staged.sh", deployment), "utf8");
  const dockerignore = await readFile(new URL("../../.dockerignore", dashboard), "utf8");
  const databaseCa = await readFile(new URL("certificates/supabase-root-2021-ca.pem", deployment), "utf8");
  assert.match(compose, /127\.0\.0\.1:3200:3000/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\s+- ALL/);
  assert.match(compose, /mem_limit: 768m/);
  assert.match(compose, /NODE_EXTRA_CA_CERTS/);
  assert.match(dockerfile, /node:24\.18\.0-alpine3\.24@sha256:/);
  assert.match(entrypoint, /\/run\/secrets\/\$2/);
  assert.match(entrypoint, /SUPABASE_SECRET_KEY supabase_secret_key/);
  assert.match(installer, /protected unit changed state/);
  assert.match(installer, /candidate\.overlaps/);
  assert.match(installer, /cleanup/);
  assert.match(installer, /chown root:1000/);
  assert.match(installer, /chmod 0640/);
  assert.doesNotMatch(compose + dockerfile + entrypoint + installer, /sb_publishable_|postgresql:\/\/postgres\./);
  assert.match(dockerignore, /^\.env$/m);
  assert.match(dockerignore, /deployment\/\*\*\/secrets\/\*/);
  assert.equal(new X509Certificate(databaseCa).fingerprint256, "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA");
});

test("public dashboard ingress enables secure cookies without exposing n8n", async () => {
  const deployment = new URL("../../deployment/dashboard-public/", dashboard);
  const compose = await readFile(new URL("docker-compose.yml", deployment), "utf8");
  const nginx = await readFile(new URL("nginx/tanaghom.conf", deployment), "utf8");
  const deploy = await readFile(new URL("scripts/deploy.sh", deployment), "utf8");
  const rollback = await readFile(new URL("scripts/rollback.sh", deployment), "utf8");
  assert.match(compose, /APP_ENV: production/);
  assert.match(compose, /APP_BASE_URL: https:\/\/tanaghom\.38-247-187-232\.sslip\.io/);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3200/);
  assert.match(nginx, /limit_req zone=tanaghom_login/);
  assert.match(nginx, /Strict-Transport-Security/);
  assert.match(nginx, /X-Frame-Options "DENY"/);
  assert.match(deploy, /certbot certonly --webroot/);
  assert.match(deploy, /TANAGHOM_PUBLIC_DEPLOY_AUTHORIZED/);
  assert.match(rollback, /rm -f "\$NGINX_TARGET"/);
  assert.doesNotMatch(compose + nginx + deploy + rollback, /5678|webhook|n8n/);
});
