import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTs(path, stubs = {}) {
  const requireCjs = createRequire(import.meta.url);
  const ts = requireCjs("typescript");
  const source = read(path);
  const js = ts.transpileModule(source, {
    fileName: path.split("/").pop(),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  const req = (id) => {
    if (id === "server-only") return {};
    if (id in stubs) return stubs[id];
    throw new Error(`unexpected import: ${id}`);
  };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  return mod.exports;
}

test("Packet M Item 10 (#281): /api/audit scopes null-actor rows via organization_id and job/workspace fallbacks with zero new migration", () => {
  const route = read("apps/dashboard/app/api/audit/route.ts");
  assert.match(route, /LEFT JOIN tanaghom\.app_users AS actor ON actor\.id = log\.actor_user_id/);
  assert.match(route, /LEFT JOIN tanaghom\.agent_jobs AS job ON job\.id = log\.job_id/);
  assert.match(route, /LEFT JOIN tanaghom\.campaigns AS job_campaign ON job_campaign\.id = job\.campaign_id/);
  assert.match(route, /LEFT JOIN tanaghom\.agency_workspaces AS workspace/);
  assert.match(route, /WHERE log\.organization_id = \$1::uuid/);
  assert.match(route, /log\.organization_id IS NULL AND COALESCE\(job_campaign\.organization_id, workspace\.organization_id\) = \$1::uuid/);
  assert.doesNotMatch(route, /JOIN tanaghom\.app_users AS actor ON actor\.id = log\.actor_user_id\s+WHERE/);

  // 0051 + 0052 already added organization_id and the trigger; Packet M adds 0 migrations (leaving 0054 for Packet L).
  const migrations = readdirSync(new URL("../packages/database/migrations", import.meta.url)).filter((name) => name.endsWith(".up.sql"));
  assert.equal(migrations.length, 51);
  assert.equal(migrations.at(-1), "0054_workspace_image_quotas.up.sql");
});

test("Packet M Item 12: signup enforces per-IP and per-account limits, login challenges with Turnstile after 3 failures", () => {
  const limiter = loadTs("apps/dashboard/lib/server/auth-rate-limit.ts");
  limiter.resetAuthRateLimits();

  const now = 1_700_000_000_000;
  // Per-account limit (default 3) blocks even when client IP rotates.
  assert.equal(limiter.checkAndRecordSignupAttempt("203.0.113.1", "Founder@Example.org", now).allowed, true);
  assert.equal(limiter.checkAndRecordSignupAttempt("203.0.113.2", "founder@example.org", now + 1000).allowed, true);
  assert.equal(limiter.checkAndRecordSignupAttempt("203.0.113.3", "founder@example.org", now + 2000).allowed, true);
  const blockedAccount = limiter.checkAndRecordSignupAttempt("203.0.113.4", "founder@example.org", now + 3000);
  assert.equal(blockedAccount.allowed, false);
  assert.ok(blockedAccount.retryAfter > 0);

  // Per-IP limit (default 5) blocks even when email rotates.
  limiter.resetAuthRateLimits();
  for (let i = 0; i < 5; i += 1) {
    assert.equal(limiter.checkAndRecordSignupAttempt("198.51.100.9", `user${i}@corp.example`, now + i * 100).allowed, true);
  }
  const blockedIp = limiter.checkAndRecordSignupAttempt("198.51.100.9", "user99@corp.example", now + 1000);
  assert.equal(blockedIp.allowed, false);
  assert.ok(blockedIp.retryAfter > 0);

  // Progressive Turnstile challenge after 3 failures, cleared on success.
  limiter.resetAuthRateLimits();
  assert.equal(limiter.requiresTurnstileChallenge("login", "198.51.100.1", "alice@corp.example", now), false);
  limiter.recordAuthFailure("login", "198.51.100.1", "alice@corp.example", now);
  limiter.recordAuthFailure("login", "198.51.100.1", "alice@corp.example", now + 100);
  assert.equal(limiter.requiresTurnstileChallenge("login", "198.51.100.1", "alice@corp.example", now + 200), false);
  limiter.recordAuthFailure("login", "198.51.100.1", "alice@corp.example", now + 300);
  assert.equal(limiter.requiresTurnstileChallenge("login", "198.51.100.1", "alice@corp.example", now + 400), true);
  limiter.clearAuthFailures("login", "198.51.100.1", "alice@corp.example");
  assert.equal(limiter.requiresTurnstileChallenge("login", "198.51.100.2", "alice@corp.example", now + 500), false);

  // Route wiring: signup forwards 429 + Retry-After instead of 503; login challenges with Turnstile.
  const signupRoute = read("apps/dashboard/app/api/auth/signup/route.ts");
  assert.match(signupRoute, /checkAndRecordSignupAttempt/);
  assert.match(signupRoute, /if \(upstream\.status === 429\)/);
  assert.match(signupRoute, /"Retry-After": String\(retryAfter\)/);
  assert.match(signupRoute, /captcha_required/);

  const loginRoute = read("apps/dashboard/app/api/auth/login/route.ts");
  assert.match(loginRoute, /requiresTurnstileChallenge\("login"/);
  assert.match(loginRoute, /verifyTurnstileToken/);
  assert.match(loginRoute, /email_not_verified/);

  const loginForm = read("apps/dashboard/components/login-form.tsx");
  assert.match(loginForm, /TurnstileWidget/);
  assert.match(loginForm, /captchaRequired/);
  assert.match(loginForm, /email_not_verified/);

  const signupForm = read("apps/dashboard/components/signup-form.tsx");
  assert.match(signupForm, /too_many_attempts/);
  assert.match(signupForm, /retry-after/);
});

test("Packet M Item 12: global CSP defaults to Report-Only, switches cleanly to enforce, and attaches in proxy.ts", () => {
  const csp = loadTs("apps/dashboard/lib/server/csp.ts");
  const defaultHeader = csp.buildGlobalCspHeader({});
  assert.equal(defaultHeader.header, "Content-Security-Policy-Report-Only");
  assert.match(defaultHeader.value, /default-src 'self'/);
  assert.match(defaultHeader.value, /object-src 'none'/);
  assert.match(defaultHeader.value, /frame-ancestors 'self'/);
  assert.match(defaultHeader.value, /https:\/\/challenges\.cloudflare\.com/);
  assert.match(defaultHeader.value, /report-uri \/api\/csp-report/);

  const enforced = csp.buildGlobalCspHeader({ CSP_MODE: "enforce" });
  assert.equal(enforced.header, "Content-Security-Policy");
  assert.equal(csp.buildGlobalCspHeader({ CSP_MODE: "off" }), null);

  const proxy = read("apps/dashboard/proxy.ts");
  assert.match(proxy, /buildGlobalCspHeader/);
  assert.match(proxy, /applyGlobalCsp/);

  const reportRoute = read("apps/dashboard/app/api/csp-report/route.ts");
  assert.match(reportRoute, /MAX_REPORT_BYTES = 8_192/);
  assert.match(reportRoute, /csp_violation_report/);
});

test("Packet M Item 13: email verification enforcement flag, AppShell unverified banner, and password-reset controls", () => {
  const authServer = read("deployment/dashboard-demo/auth/server.mjs");
  assert.match(authServer, /AUTH_REQUIRE_VERIFIED_EMAIL/);
  assert.match(authServer, /email_not_verified/);
  assert.match(authServer, /AUTH_SIGNUP_PAIR_LIMIT/);
  assert.doesNotMatch(authServer, /email\|/);

  const shell = read("apps/dashboard/components/app-shell.tsx");
  assert.match(shell, /email-verify-banner/);
  assert.match(shell, /\/api\/auth\/verify-email\/resend/);
  assert.match(shell, /email_verified === false/);

  const compose = read("deployment/dashboard-demo/compose.yml");
  assert.match(compose, /CSP_MODE: \$\{CSP_MODE:-report-only\}/);
  assert.match(compose, /AUTH_REQUIRE_VERIFIED_EMAIL: \$\{AUTH_REQUIRE_VERIFIED_EMAIL:-false\}/);
  assert.match(compose, /AUTH_SIGNUP_ACCOUNT_LIMIT:/);
  assert.match(compose, /AUTH_TURNSTILE_FAILURE_THRESHOLD:/);
});
