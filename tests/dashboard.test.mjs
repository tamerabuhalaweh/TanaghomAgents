import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = new URL("../apps/dashboard/", import.meta.url);

test("dashboard exposes the Phase 2 operational routes", async () => {
  const routes = ["app/page.tsx", "app/approvals/page.tsx", "app/campaigns/page.tsx", "app/agents/page.tsx", "app/leads/page.tsx", "app/reports/page.tsx", "app/system/page.tsx"];
  await Promise.all(routes.map((route) => readFile(new URL(route, dashboard), "utf8")));
});

test("fixture approval workspace clearly prevents external action", async () => {
  const source = await readFile(new URL("components/approval-workspace.tsx", dashboard), "utf8");
  assert.match(source, /Fixture mode:/);
  assert.match(source, /cannot publish content or call an external service/);
  assert.doesNotMatch(source, /fetch\(|axios|https?:\/\//);
});

test("dashboard includes reduced-motion and responsive navigation behavior", async () => {
  const css = await readFile(new URL("app/globals.css", dashboard), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.mobile-navigation/);
  assert.match(css, /min-height: 2\.75rem/);
});

test("server API verifies Supabase JWTs and keeps fixture mutations disconnected", async () => {
  const auth = await readFile(new URL("lib/server/auth.ts", dashboard), "utf8");
  const approvals = await readFile(new URL("app/api/approvals/route.ts", dashboard), "utf8");
  const readme = await readFile(new URL("README.md", dashboard), "utf8");
  assert.match(auth, /jwtVerify/);
  assert.match(auth, /audience: "authenticated"/);
  assert.match(approvals, /pending_approval/);
  assert.doesNotMatch(approvals, /UPDATE|INSERT|DELETE/);
  assert.match(readme, /Approval\s+mutations remain disabled/);
});
