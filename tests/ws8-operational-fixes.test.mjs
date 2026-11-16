import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { onboardingStrings } from "../apps/dashboard/lib/i18n/onboarding.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("system monitoring uses uuid casts, no forbidden controls read, and derived runtime controls", async () => {
  const monitoring = await read("apps/dashboard/lib/server/system-monitoring.ts");

  assert.match(monitoring, /conversation_capacity_status WHERE organization_id=\$1::uuid/);
  assert.match(monitoring, /notification_delivery_status WHERE organization_id=\$1::uuid/);
  assert.match(monitoring, /integration_connection_status\s+WHERE organization_id=\$1::uuid/);
  assert.match(monitoring, /SELECT id FROM tanaghom\.campaigns WHERE organization_id=\$1::uuid/);
  assert.match(monitoring, /app_users WHERE organization_id=\$1::uuid/);
  assert.doesNotMatch(monitoring, /organization_id=\$1[^:]/, "every organization clause must cast $1::uuid");
  assert.doesNotMatch(monitoring, /FROM tanaghom\.automation_platform_controls/, "the API role cannot select the controls table");

  assert.match(monitoring, /POSTIZ_AUTOMATION_RUNTIME_READY/);
  assert.match(monitoring, /GHL_ACTION_RUNTIME_READY/);
  assert.match(monitoring, /Draft-only mode enforced; external publishing requires human approval\./);
  assert.match(monitoring, /Proposal-only mode enforced; automatic CRM actions are disabled\./);
  assert.match(monitoring, /const capacityRow = capacity\.rows\[0\]/);
  assert.match(monitoring, /\{ \.\.\.capacityDefaults, social_publishing_review: 0 \}/);
  assert.match(monitoring, /delivery\.rows\[0\] \?\? deliveryDefaults/);
});

test("system view is bilingual and uses customer-facing operational labels", async () => {
  const view = await read("apps/dashboard/components/system-view.tsx");

  assert.match(view, /useLocale\(\)/);
  assert.match(view, /AI Model Worker/);
  assert.match(view, /CRM Integration/);
  assert.match(view, /Social Publishing/);
  assert.match(view, /Failed background tasks/);
  assert.match(view, /مراقبة النظام/);
  assert.match(view, /عامل نموذج الذكاء الاصطناعي/);
  assert.doesNotMatch(view, /"Gemma"/);
  assert.doesNotMatch(view, /"GoHighLevel"/);
  assert.doesNotMatch(view, /Dead letters/);
  assert.doesNotMatch(view, /indeterminate_actions/);
});

test("workspace runtime never exposes the raw latch reason and labels draft-save mode", async () => {
  const service = await read("apps/dashboard/lib/server/agency-workspace.ts");
  const component = await read("apps/dashboard/components/agency-workspace.tsx");

  assert.doesNotMatch(service, /reason:!isConfigured\?"The model worker is not connected yet\.":!c\?\.enabled\|\|c\.emergency_stop\?c\?\.reason/);
  assert.doesNotMatch(component, /operator review required before new inference/);
  assert.match(service, /AI drafting is in draft-save mode on this environment/);
  assert.match(service, /AI specialist generation is temporarily paused/);
  assert.match(component, /Draft-save mode/);
  assert.match(component, /وضع حفظ المسودات/);
  assert.match(component, /AI specialists ready/);
  assert.match(component, /المختصون جاهزون/);
  assert.match(component, /Save assignment brief/);
  assert.match(component, /حفظ موجز المهمة/);
  assert.match(component, /Save & start now.*activates when the live model worker is connected/s);
});

test("overview fetches setup progress, shows the setup banner, and links an active campaign brief", async () => {
  const overview = await read("apps/dashboard/components/overview-dashboard.tsx");

  assert.match(overview, /\/api\/settings\/onboarding/);
  assert.match(overview, /\/api\/creative\/brand-kits/);
  assert.match(overview, /\/api\/admin\/knowledge/);
  assert.match(overview, /Continue workspace setup/);
  assert.match(overview, /أكمل إعداد مساحة عملك/);
  assert.match(overview, /href="\/onboarding"/);
  assert.match(overview, /New campaign brief/);
  assert.match(overview, /موجز حملة جديد/);
  assert.match(overview, /href="\/workspace"/);
  assert.doesNotMatch(overview, /The foundation is ready/);
  assert.doesNotMatch(overview, /disabled title=\{ar \? "إنشاء الحملات/);
});

test("onboarding is four honest steps with a ready-to-launch tab title", () => {
  const en = onboardingStrings.en;
  const ar = onboardingStrings.ar;

  assert.equal(en.stepLabel, "Step 1 of 4 · Business profile");
  assert.equal(en.step2Label, "Step 2 of 4 · Brand kit");
  assert.equal(en.step3Label, "Step 3 of 4 · First knowledge");
  assert.match(en.step4Label, /^Step 4 of 4/);
  assert.equal(en.readyTabTitle, "Ready to launch");
  assert.equal(ar.stepLabel, "الخطوة 1 من 4 · ملف النشاط التجاري");
  assert.equal(ar.step2Label, "الخطوة 2 من 4 · الهوية البصرية");
  assert.equal(ar.step3Label, "الخطوة 3 من 4 · أول معرفة");
  assert.match(ar.step4Label, /^الخطوة 4 من 4/);
  assert.equal(ar.readyTabTitle, "جاهز للانطلاق");
  for (const copy of [en, ar]) {
    assert.equal(copy.readyChecklist.length, 3);
    assert.equal(copy.checklistActions.length, 3);
    assert.ok(copy.knowledgeRequiredHint.trim());
  }
});

test("onboarding brand step edits an existing kit inline through a new version", async () => {
  const brand = await read("apps/dashboard/components/onboarding-brand-step.tsx");
  const knowledge = await read("apps/dashboard/components/onboarding-knowledge-step.tsx");
  const wizard = await read("apps/dashboard/components/onboarding-wizard.tsx");

  assert.match(brand, /\/api\/creative\/brand-kits\/\$\{kit\.kit_id\}/);
  assert.match(brand, /`\/api\/creative\/brand-kits\/\$\{existing\.kit_id\}\/versions`/);
  assert.doesNotMatch(brand, /v\{existing\.current_version\}/);
  assert.match(knowledge, /<details className="onboarding-wide onboarding-disclosure">/);
  assert.match(knowledge, /copy\.knowledgeAdvancedLabel/);
  assert.match(knowledge, /copy\.knowledgeRequiredHint/);
  assert.match(wizard, /copy\.readyTabTitle/);
  assert.match(wizard, /authenticatedFetch\("\/api\/settings\/onboarding"/);
  assert.match(wizard, /authenticatedFetch\("\/api\/creative\/brand-kits"/);
  assert.match(wizard, /authenticatedFetch\("\/api\/admin\/knowledge"/);
  assert.match(wizard, /copy\.checklistActions\[index\]/);
  assert.match(wizard, /checklist\.saved\[index\]/);
});

test("public marketing and legal routes bypass auth and the app shell", async () => {
  const proxy = await read("apps/dashboard/proxy.ts");
  const frame = await read("apps/dashboard/components/root-frame.tsx");
  const page = await read("apps/dashboard/app/page.tsx");
  const privacy = await read("apps/dashboard/components/public-pages.tsx");
  const pricing = await read("apps/dashboard/app/pricing/page.tsx");
  const privacyRoute = await read("apps/dashboard/app/privacy/page.tsx");
  const termsRoute = await read("apps/dashboard/app/terms/page.tsx");

  for (const route of ["/", "/pricing", "/privacy", "/terms"]) {
    assert.ok(proxy.includes(`"${route}"`), `${route} must be public in proxy.ts`);
    assert.ok(frame.includes(`"${route}"`), `${route} must bypass the authenticated shell`);
  }
  assert.match(page, /PublicLandingPage locale=\{locale\}/);
  assert.match(page, /requireTenant/);
  assert.match(page, /<OverviewDashboard \/>/);
  assert.match(page, /<AppShell>/);
  assert.match(pricing, /PublicPricingPage/);
  assert.match(privacyRoute, /PublicPrivacyPage/);
  assert.match(termsRoute, /PublicTermsPage/);
  assert.match(privacy, /\/settings\/channels/);
  assert.match(privacy, /Disconnecting social channels and purging tokens/);
  assert.match(privacy, /revokes and purges its OAuth tokens/);
});

test("no SQL migration was added for WS8", async () => {
  const migrations = (await readdir(new URL("../packages/database/migrations", import.meta.url)))
    .filter((file) => file.endsWith(".up.sql"))
    .sort();
  assert.equal(migrations.length, 49);
  assert.equal(migrations.at(-1), "0052_security_hardening.up.sql");
});
