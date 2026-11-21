import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { customerSafeText } from "../apps/dashboard/lib/agent-blocker-copy.ts";
import { describeSessionDevice } from "../apps/dashboard/lib/session-device.ts";

const root = path.resolve(import.meta.dirname, "..");

test("§5a describeSessionDevice turns raw UA + IP into readable EN/AR device labels", () => {
  const chromeWin = describeSessionDevice(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 | ip:203.0.113.42",
    "en",
  );
  assert.equal(chromeWin.label, "Chrome on Windows");
  assert.equal(chromeWin.ip, "203.0.113.42");

  const safariIosAr = describeSessionDevice(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 | ip:198.51.100.7",
    "ar",
  );
  assert.equal(safariIosAr.label, "Safari على iOS");
  assert.equal(safariIosAr.ip, "198.51.100.7");

  const legacyNode = describeSessionDevice("node", "en");
  assert.equal(legacyNode.label, "Previous web session");
  assert.equal(legacyNode.ip, null);
});

test("§5a auth routes forward real User-Agent, auth store filters idle sessions, and per-session + revoke-others are wired", () => {
  for (const file of [
    "apps/dashboard/app/api/auth/login/route.ts",
    "apps/dashboard/app/api/auth/signup/route.ts",
    "apps/dashboard/app/api/auth/refresh/route.ts",
  ]) {
    const src = readFileSync(path.join(root, file), "utf8");
    assert.match(src, /"user-agent"/, `${file} must forward client user-agent`);
  }

  const sessionsRoute = readFileSync(path.join(root, "apps/dashboard/app/api/auth/sessions/route.ts"), "utf8");
  assert.match(sessionsRoute, /scope === "others"/);

  const server = readFileSync(path.join(root, "deployment/dashboard-demo/auth/server.mjs"), "utf8");
  assert.match(server, /function sessionClientAgent/);
  assert.match(server, /async function handleToken[\s\S]*?const address = addressOf\(request\);[\s\S]*?grantType === "password"[\s\S]*?grantType === "refresh_token"/);
  assert.match(server, /store\.revokeOtherSessions/);

  const store = readFileSync(path.join(root, "deployment/dashboard-demo/auth/store.mjs"), "utf8");
  assert.match(store, /SESSION_IDLE_MS/);
  assert.match(store, /LIMIT 25/);
  assert.match(store, /async revokeOtherSessions/);

  const sessionList = readFileSync(path.join(root, "apps/dashboard/components/session-list.tsx"), "utf8");
  assert.match(sessionList, /describeSessionDevice/);
  assert.match(sessionList, /scope=others/);
  assert.match(sessionList, /copy\.sessionsRevoke/);

  const securityPage = readFileSync(path.join(root, "apps/dashboard/app/settings/security/page.tsx"), "utf8");
  assert.match(securityPage, /<SessionList copy=\{authCopy\(locale\)\} locale=\{locale\} \/>/);
});

test("§5b /agents customer UI hides internal infrastructure names while keeping contract headings", () => {
  const agents = readFileSync(path.join(root, "apps/dashboard/components/agents-workspace.tsx"), "utf8");
  assert.match(agents, /Specialized workers/);
  assert.match(agents, /What blocks this role/);
  assert.match(agents, /Open Agent Studio/);
  // The helper moved to a React-free module so it can be executed in tests.
  assert.equal(customerSafeText("n8n and PostgreSQL with Gemma"), "automation runtime and workspace records with AI model");
  assert.match(readFileSync(path.join(root, "apps/dashboard/lib/agent-blocker-copy.ts"), "utf8"), /export function customerSafeText/);
  assert.doesNotMatch(agents, /PostgreSQL is the customer-facing source of truth/);
  assert.doesNotMatch(agents, /Versioned n8n workflows/);
  assert.doesNotMatch(agents, /Release available/);
  assert.doesNotMatch(agents, /Imported · inactive/);
  assert.doesNotMatch(agents, /worker\.workflow_version|worker\.job_types|worker\.runtime_verified_at/);
});
