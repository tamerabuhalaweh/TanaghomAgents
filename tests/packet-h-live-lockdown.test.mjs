import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("super-admin fails closed in production and refuses customer test identities", () => {
  const service = read("apps/dashboard/lib/server/super-admin.ts");
  assert.match(service, /CUSTOMER_TEST_EMAIL_DOMAINS = \["example\.com", "tanaghom\.test"\]/);
  assert.match(service, /export function isCustomerTestEmail/);
  // Every test domain is refused in production, including the demo platform org.
  assert.doesNotMatch(service, /PLATFORM_OPS_TEST_IDENTITY/);
  assert.match(service, /if \(production && !options\.allowTestIdentities && isCustomerTestEmail\(normalized\)\) return false;/);
  assert.match(service, /if \(production && allowedEmails\.size === 0\) return false;/);
  assert.match(service, /if \(production && !options\.allowTestIdentities && isCustomerTestEmail\(normalized\)\) return false;/);
  assert.match(service, /allowTestIdentities\?: boolean/);
  // The organization-owner fallback must never be reachable in production.
  assert.match(service, /return user\.organizationId === PLATFORM_ORGANIZATION_ID && user\.role === "owner";/);
  const page = read("apps/dashboard/app/super-admin/page.tsx");
  assert.match(page, /notFound\(\)/);
  const route = read("apps/dashboard/app/api/super-admin/route.ts");
  assert.match(route, /error: "not_found"/);
  assert.match(route, /status: 404/);
});

test("Arabic copy carries no raw dollar glyph and /settings resolves", () => {
  const publicPages = read("apps/dashboard/components/public-pages.tsx");
  // Arabic pricing must never fall back to a raw converted dollar amount.
  assert.doesNotMatch(publicPages, /<bdi dir="ltr">\$\d{3}<\/bdi>/);
  assert.match(publicPages, /299 دولارًا/);
  assert.match(publicPages, /399 دولارًا/);
  const overview = read("apps/dashboard/components/overview-dashboard.tsx");
  const spend = overview.split("\n").find((line) => line.includes("data.performance.spend"));
  assert.ok(spend, "spend metric must exist");
  assert.match(spend, /دولارًا/);
  assert.doesNotMatch(spend, /<dd>\$\{formatNumber/);
  assert.match(spend, /:\s*`\$\$\{formatNumber/);
  const settings = read("apps/dashboard/app/settings/page.tsx");
  assert.match(settings, /redirect\("\/settings\/channels"\)/);
});

test("overview and campaigns share AI Workspace statuses and counts", () => {
  const operations = read("apps/dashboard/app/api/operations/route.ts");
  assert.match(operations, /workspace\.status IN \('queued','running','in_progress','paused','waiting_review','approved','rejected','failed'\)/);
  assert.match(operations, /WHEN 'in_progress' THEN 'running' ELSE workspace\.status END/);
  assert.match(operations, /'workspace\.'\|\|workspace\.status/);
  assert.match(operations, /status <> 'draft'\) AS campaigns_total/);
  assert.match(operations, /status IN \('approved', 'running', 'in_progress', 'waiting_review'\)\) AS campaigns_active/);
  assert.match(operations, /status = 'waiting_review'\) AS approvals_pending/);
  assert.match(operations, /agency_workspace_steps step/);
  // Step state lives on the pilot task, not the step row.
  assert.match(operations, /JOIN tanaghom\.agency_pilot_tasks task ON task\.id = step\.task_id[\s\S]{0,200}task\.status IN \('queued', 'in_progress'\)/);
  assert.match(operations, /AS jobs_open/);
  assert.doesNotMatch(operations, /approvedWorkspaceCampaigns/);
  const approvals = read("apps/dashboard/app/api/approvals/route.ts");
  assert.match(approvals, /'ai_workspace'::text AS source/);
  assert.match(approvals, /workspace\.status = 'waiting_review'/);
  assert.match(approvals, /tanaghom\.agency_workspace_result_hash\(workspace\.id\) AS result_hash/);
  assert.match(approvals, /AS deliverables/);
  const view = read("apps/dashboard/components/approval-workspace.tsx");
  assert.match(view, /source === "ai_workspace"/);
  assert.match(view, /authenticatedFetch\(\s*\n?\s*workspaceItem \? "\/api\/workspace"/);
  assert.match(view, /href=\{`\/workspace\?id=\$\{active\.id\}`\}/);
});

test("workspace surfaces failure reasons, retry budget, focus refresh and brand post cards", () => {
  const view = read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(view, /e\.event_type === "failed"/);
  assert.match(view, /reason\(e\.evidence\.error \?\? e\.evidence\.reason \?\? null\)/);
  assert.match(view, /إعادة المحاولة المستخدمة لهذه الحملة: \$\{formatNumber\(selected\.retries_used/);
  assert.match(view, /Failed or timed-out attempts with zero deliverables do not consume monthly campaign slots\./);
  assert.match(view, /window\.addEventListener\("focus", refresh\)/);
  assert.match(view, /document\.addEventListener\("visibilitychange", refresh\)/);
  assert.match(view, /WorkspacePostCards/);
  // Post cards belong to the content creator only, not to the strategy step.
  assert.match(view, /step\.profile_code === "content_creator" \? <WorkspacePostCards/);
  assert.doesNotMatch(view, /\["content_creator", "social_media_strategist"\]/);
  const cards = read("apps/dashboard/components/workspace-post-cards.tsx");
  assert.match(cards, /Download SVG/);
  assert.match(cards, /Download PNG/);
  assert.match(cards, /href="\/creative\/designs"/);
  assert.match(cards, /toBlob/);
  const service = read("apps/dashboard/lib/server/agency-workspace.ts");
  assert.match(service, /brand_kit:brandKit\.rows\[0\]/);
  assert.match(service, /retries_used:Number\(retries\.rows\[0\]\?\.used\)\|\|0/);
  assert.match(service, /retried_from_failed/);
});

test("billing reports the live cohort cap and unlimited flag", () => {
  const launch = read("apps/dashboard/lib/server/launch-control.ts");
  assert.match(launch, /cohort_cap: config\.cohort_cap,[\s\S]{0,80}cohort_unlimited: config\.cohort_unlimited,/);
  const billing = read("apps/dashboard/app/api/billing/route.ts");
  assert.match(billing, /launch_offer: launchOffer/);
});

test("deployment docs keep the platform owner out of customer test identities", () => {
  const example = read("deployment/dashboard-demo/.env.example");
  assert.match(example, /^SUPER_ADMIN_EMAILS=/m);
  assert.doesNotMatch(example, /customer\.20261112@example\.com/);
});
