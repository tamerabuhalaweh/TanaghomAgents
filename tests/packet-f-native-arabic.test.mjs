import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { formatArabicCount } from "../apps/dashboard/lib/i18n/format.ts";
import * as clientDialects from "../apps/dashboard/lib/i18n/dialects.ts";
import * as runtimeDialects from "../packages/agent-runtime/dialects.mjs";
import { workspaceRequest } from "../packages/agent-runtime/workspace.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const forms = {
  zero: "لا عناصر",
  one: "عنصر واحد",
  two: "عنصران",
  few: "{count} عناصر",
  many: "{count} عنصرًا",
  other: "{count} عنصر",
};

test("formatArabicCount handles zero, one, two, few, many and other with Western digits", () => {
  assert.equal(formatArabicCount(0, forms), "لا عناصر");
  assert.equal(formatArabicCount(1, forms), "عنصر واحد");
  assert.equal(formatArabicCount(2, forms), "عنصران");
  assert.equal(formatArabicCount(3, forms), "3 عناصر");
  assert.equal(formatArabicCount(11, forms), "11 عنصرًا");
  assert.equal(formatArabicCount(100, forms), "100 عنصر");
  for (const value of [0, 1, 2, 3, 11, 100]) {
    assert.doesNotMatch(formatArabicCount(value, forms), /[\u0660-\u0669\u06F0-\u06F9]/);
  }
});

test("country inference distinguishes Amman from Oman in English and Arabic", () => {
  assert.equal(clientDialects.inferDialectFromLocation("Riyadh, Saudi Arabia"), "sa");
  assert.equal(clientDialects.inferDialectFromLocation("جدة"), "sa");
  assert.equal(clientDialects.inferDialectFromLocation("Dubai, UAE"), "gulf");
  assert.equal(clientDialects.inferDialectFromLocation("الدوحة"), "gulf");
  assert.equal(clientDialects.inferDialectFromLocation("Amman, Jordan"), "levant");
  assert.equal(clientDialects.inferDialectFromLocation("عمّان"), "levant");
  assert.notEqual(clientDialects.inferDialectFromLocation("عمّان"), "gulf");
  assert.equal(clientDialects.inferDialectFromLocation("Oman"), "gulf");
  assert.equal(clientDialects.inferDialectFromLocation("عمان"), "gulf");
  assert.equal(clientDialects.inferDialectFromLocation("Beirut, Lebanon"), "levant");
  assert.equal(clientDialects.inferDialectFromLocation("Cairo, Egypt"), "egypt");
  assert.equal(clientDialects.inferDialectFromLocation("مصر"), "egypt");
  assert.equal(clientDialects.inferDialectFromLocation("Berlin"), "msa");
  assert.equal(clientDialects.inferDialectFromLocation(null), "msa");
});

test("campaign dialect wins, then brand kit, then country, then White Arabic", () => {
  assert.equal(clientDialects.resolveArabicDialect({
    campaignDialect: "egypt", brandKitDialect: "sa", location: "Dubai",
  }), "egypt");
  assert.equal(clientDialects.resolveArabicDialect({
    campaignDialect: "invalid", brandKitDialect: "levant", location: "Riyadh",
  }), "levant");
  assert.equal(clientDialects.resolveArabicDialect({ brandKitDialect: null, location: "Amman" }), "levant");
  assert.equal(clientDialects.resolveArabicDialect({ location: "Berlin" }), "msa");
});

test("runtime and dashboard dialect registries stay in exact parity", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(runtimeDialects.DIALECTS)), JSON.parse(JSON.stringify(clientDialects.DIALECTS)));
  assert.deepEqual([...runtimeDialects.DIALECT_IDS], [...clientDialects.DIALECT_IDS]);
  const fixtures = [
    null, "", "Riyadh", "Saudi Arabia", "Dubai", "UAE", "Amman", "عمّان", "عمان", "Oman",
    "Beirut", "Cairo", "مصر", "Paris", "سلطنة عمان", "رام الله",
  ];
  for (const fixture of fixtures) {
    assert.equal(runtimeDialects.inferDialectFromLocation(fixture), clientDialects.inferDialectFromLocation(fixture), String(fixture));
  }
});

test("workspace prompt writes strategic Arabic and customer copy in the resolved dialect", () => {
  const task = {
    profile: "social_media_strategist",
    language: "ar",
    dialect: "egypt",
    model: "gemini-3.6-flash",
    title: "حملة دورة تصوير",
    brief: "أعدّ منشورات إنستغرام عضوية لدورة تصوير للمبتدئين في القاهرة.",
    source_facts: "الدورة من ثماني جلسات، وتبدأ في 3 فبراير، ولا يوجد ضمان توظيف.",
    shared_context: [],
    context_hash: `sha256:${"1".repeat(64)}`,
  };
  const request = workspaceRequest(task, 32768);
  const prompt = request.systemInstruction.parts[0].text;
  assert.match(prompt, /Modern Standard Arabic \(White Arabic\)/);
  assert.match(prompt, /Egyptian Arabic/);
  assert.match(prompt, /اللهجة المصرية/);
  assert.match(prompt, /hooks, posts, captions/);
  assert.match(prompt, /تناغم/);
  assert.equal(JSON.parse(request.contents[0].parts[0].text).dialect, "egypt");
  const english = workspaceRequest({ ...task, language: "en", dialect: undefined }, 32768);
  assert.doesNotMatch(english.systemInstruction.parts[0].text, /White Arabic|اللهجة/);
  assert.throws(() => workspaceRequest({ ...task, dialect: "french" }, 32768), /workspace_dialect_invalid/);
});

test("Arabic customer copy ships the White Arabic replacements and preserves the promo literal", () => {
  const files = [
    "apps/dashboard/components/agency-workspace.tsx",
    "apps/dashboard/components/approval-workspace.tsx",
    "apps/dashboard/components/content-library.tsx",
    "apps/dashboard/components/billing-settings.tsx",
    "apps/dashboard/components/channels-settings.tsx",
    "apps/dashboard/components/public-pages.tsx",
    "apps/dashboard/components/system-view.tsx",
    "apps/dashboard/components/super-admin-console.tsx",
    "apps/dashboard/components/creative/brand-kit-views.tsx",
    "apps/dashboard/lib/i18n/onboarding.ts",
  ].map(read).join("\n");
  for (const forbidden of [
    "الصندوق المجاني", "صندوق مجاني", "عامل نموذج الذكاء الاصطناعي", "قاطع الذكاء الاصطناعي",
    "الموجز الإعلامي", "مادة الإجابة المعتمدة", "ودودة ومحادثة", "لم تُسجَّل أي نبضة",
    "استراتيجي الحملات", "منتج المحتوى",
  ]) assert.doesNotMatch(files, new RegExp(forbidden));
  assert.match(files, /تجربة مجانية لحملة متكاملة/);
  assert.match(files, /محرك الذكاء الاصطناعي/);
  assert.match(files, /الإيقاف الطارئ للتوليد/);
  assert.match(files, /توصيف الوسائط والتصميم/);
  assert.match(files, /نص الإجابة المعتمدة/);
  assert.match(files, /لم تُسجّل أي استجابة من الخدمة بعد/);
  assert.match(read("apps/dashboard/components/public-pages.tsx"), /<bdi dir="ltr">LAUNCH100<\/bdi>/);
});

test("dialect selectors persist into brand kit rules and the workspace brief audit", () => {
  const brands = read("apps/dashboard/components/creative/brand-kit-views.tsx");
  const onboarding = read("apps/dashboard/components/onboarding-brand-step.tsx");
  const workspace = read("apps/dashboard/components/agency-workspace.tsx");
  const server = read("apps/dashboard/lib/server/agency-workspace.ts");
  assert.match(brands, /arabic_dialect: draft\.dialect/);
  assert.match(brands, /\.\.\.draft\.rules/);
  assert.match(brands, /brand-dialect-badge/);
  assert.match(onboarding, /arabic_dialect: dialect/);
  assert.match(onboarding, /\.\.\.rules/);
  assert.match(workspace, /dialect: language === "ar" \? dialect : undefined/);
  assert.match(workspace, /default_dialect/);
  assert.match(server, /workspace_dialect_invalid/);
  assert.match(server, /workspace\.brief_configured/);
  assert.match(server, /WHERE NOT EXISTS/);
  assert.match(server, /resolveArabicDialect/);
});
