import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const easternDigits = /[\u0660-\u0669\u06F0-\u06F9]/;

test("Arabic UI ships Western digits only", () => {
  const files = [
    "apps/dashboard/components/agency-workspace.tsx",
    "apps/dashboard/components/billing-settings.tsx",
    "apps/dashboard/components/overview-dashboard.tsx",
    "apps/dashboard/components/public-pages.tsx",
    "apps/dashboard/components/security-settings.tsx",
    "apps/dashboard/components/super-admin-console.tsx",
    "apps/dashboard/lib/i18n/auth-email.ts",
    "apps/dashboard/lib/i18n/auth.ts",
    "apps/dashboard/lib/i18n/onboarding.ts",
  ];
  for (const file of files) assert.doesNotMatch(read(file), easternDigits, file);
});

test("Arabic formatters pin ar-SA-u-nu-latn and normalize typed digits", () => {
  const format = read("apps/dashboard/lib/i18n/format.ts");
  assert.match(format, /ARABIC_NUMERIC_LOCALE = "ar-SA-u-nu-latn"/);
  assert.match(format, /ARABIC_DATE_LOCALE = "ar-SA-u-nu-latn"/);
  assert.match(format, /export function normalizeDigits/);
  assert.match(format, /export function normalizeNumericInput/);
  assert.match(format, /month: "long"/);
  assert.match(format, /\$\{number\}%/);
});

test("Arabic typography loads IBM Plex Sans Arabic with W3C RTL rules", () => {
  const layout = read("apps/dashboard/app/layout.tsx");
  const css = read("apps/dashboard/app/globals.css");
  assert.match(layout, /IBM_Plex_Sans_Arabic/);
  assert.match(layout, /weight: \["400", "500", "700"\]/);
  assert.match(layout, /display: "swap"/);
  assert.match(layout, /--font-arabic/);
  assert.match(css, /html:lang\(ar\) \{ font-size: 106\.25%; \}/);
  assert.match(css, /letter-spacing: 0 !important/);
  assert.match(css, /line-height: 1\.7/);
  assert.match(css, /line-height: 1\.35/);
  assert.match(css, /scaleX\(-1\)/);
});

test("Arabic super-admin maps operational circuit-breaker reasons", () => {
  const consoleSource = read("apps/dashboard/components/super-admin-console.tsx");
  assert.match(consoleSource, /operational: "يعمل بشكل طبيعي"/);
  assert.match(consoleSource, /breakerReason\(snapshot\.ai_circuit_breaker\.reason, locale\)/);
});

test("public Arabic copy isolates Latin tokens and keeps launch copy", () => {
  const page = read("apps/dashboard/components/public-pages.tsx");
  assert.match(page, /<bdi dir="ltr">LAUNCH100<\/bdi>/);
  assert.match(page, /لا يُنشر شيء حتى تقول نعم\./);
  assert.match(page, /مبني بالعربية\. وليس مترجمًا إليها\./);
  assert.match(page, /خطّط\. أنشئ\. وافق\. انشر\. قِس\. في مكان واحد\./);
});

test("public Arabic prices and the footer copyright read natively", () => {
  const page = read("apps/dashboard/components/public-pages.tsx");
  assert.match(page, /formatNumber\(launch100Active \? tier\.promo : tier\.list, "ar"\)\} دولارًا/);
  assert.match(page, /formatNumber\(tier\.list, "ar"\)\} دولارًا/);
  assert.match(page, /formatNumber\(15, "ar"\)\} دولارًا/);
  assert.match(page, /© \$\{new Date\(\)\.getFullYear\(\)\} إعلاني/);
  assert.match(page, /© \$\{new Date\(\)\.getFullYear\(\)\} E3lani/);
  assert.doesNotMatch(page, /2026 ?(?:Tanaghom|E3lani)/);
});

test("Arabic currency spelling is standardized across every component", () => {
  for (const file of [
    "apps/dashboard/components/public-pages.tsx",
    "apps/dashboard/components/billing-settings.tsx",
    "apps/dashboard/components/campaigns-view.tsx",
    "apps/dashboard/components/super-admin-console.tsx",
  ]) assert.doesNotMatch(read(file), /دولاراً/, file);
});

test("overview localizes every campaign status key", () => {
  const overview = read("apps/dashboard/components/overview-dashboard.tsx");
  for (const [key, label] of Object.entries({
    active: "نشطة",
    draft: "مسودة",
    waiting_review: "جاهز لمراجعتك",
    approved: "معتمدة",
    paused: "متوقفة",
    rejected: "طُلب التعديل",
  })) assert.match(overview, new RegExp(`${key}: "${label}"`), key);
  assert.match(overview, /campaignStage\(campaign, ar\)/);
});

test("AI workspace localizes the new-assignment prompt and specialist subtitles", () => {
  const workspace = read("apps/dashboard/components/agency-workspace.tsx");
  const names = read("apps/dashboard/lib/i18n/agent-names.ts");
  assert.match(workspace, /أنشئ حملة أو مهمة جديدة/);
  assert.match(workspace, /Create a Campaign \/ Task/);
  assert.match(workspace, /ما الذي تريد أن يجهّزه الفريق؟/);
  assert.match(workspace, /What should the team create\?/);
  assert.match(workspace, /agentDeliverableLabel\(p\.deliverable, ar\)/);
  assert.match(workspace, /agentDeliverableLabel\(data\.profiles\.find/);
  assert.match(names, /"campaign strategy": "استراتيجية الحملة"/);
  assert.match(names, /"delivery summary": "ملخص التسليم"/);
});
