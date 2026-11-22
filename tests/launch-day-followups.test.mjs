import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as creativeI18n from "../apps/dashboard/lib/i18n/creative.ts";
import * as formatI18n from "../apps/dashboard/lib/i18n/format.ts";
import { buildLoginRedirectUrl, safeNextPath } from "../apps/dashboard/lib/safe-next-path.ts";
import * as seo from "../apps/dashboard/lib/seo.ts";

const root = path.resolve(import.meta.dirname, "..");
const requireCjs = createRequire(import.meta.url);
const ts = requireCjs("typescript");
const read = (relPath) => readFileSync(path.join(root, relPath), "utf8");

function loadTsModule(relPath, extraImports = {}) {
  const source = read(relPath);
  const js = ts.transpileModule(source, {
    fileName: path.basename(relPath),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  const resolve = (id) => {
    if (id in extraImports) return extraImports[id];
    if (id === "react") return requireCjs("react");
    if (id === "react/jsx-runtime") return requireCjs("react/jsx-runtime");
    if (id.startsWith("node:")) return requireCjs(id);
    throw new Error(`unexpected import in ${relPath}: ${id}`);
  };
  new Function("require", "module", "exports", js)(resolve, mod, mod.exports);
  return mod.exports;
}

test("Item 1: support email Tamer@itis-uk.org renders across EN/AR landing FAQ, footer, legal pages, and contact surfaces", () => {
  assert.equal(seo.SUPPORT_EMAIL, "Tamer@itis-uk.org");
  assert.equal(seo.SUPPORT_EMAIL_HREF, "mailto:Tamer@itis-uk.org");

  const publicPages = loadTsModule("apps/dashboard/components/public-pages.tsx", {
    "lucide-react": new Proxy({}, { get: () => () => null }),
    "next/link": function LinkStub({ href, children, ...props }) {
      return createElement("a", { href, ...props }, children);
    },
    "@/components/brand-mark": { BrandMark: () => null },
    "@/components/creative/locale-toggle": { LocaleToggle: () => null },
    "@/components/waitlist-form": { WaitlistForm: () => null },
    "@/lib/i18n/creative": creativeI18n,
    "@/lib/i18n/format": formatI18n,
    "@/lib/seo": seo,
  });

  const { PublicLandingPage, PublicPricingPage, PublicPrivacyPage, PublicTermsPage } = publicPages;

  for (const locale of ["en", "ar"]) {
    for (const [name, Component] of [
      ["landing", PublicLandingPage],
      ["pricing", PublicPricingPage],
      ["privacy", PublicPrivacyPage],
      ["terms", PublicTermsPage],
    ]) {
      const html = renderToStaticMarkup(createElement(Component, { locale }));
      assert.match(html, /mailto:Tamer@itis-uk\.org/, `${name} (${locale}) missing mailto support link`);
      assert.match(html, /Tamer@itis-uk\.org/, `${name} (${locale}) missing support email`);
      assert.doesNotMatch(html, /operator who provisioned|مشغّل إعلاني الذي أنشأ مساحتك/);
    }
    const landingHtml = renderToStaticMarkup(createElement(PublicLandingPage, { locale }));
    assert.match(landingHtml, locale === "ar" ? /كيف أتواصل مع الدعم؟/ : /How do I contact support\?/);
  }

  for (const file of [
    "apps/dashboard/app/login/page.tsx",
    "apps/dashboard/components/app-shell.tsx",
    "apps/dashboard/components/billing-settings.tsx",
    "apps/dashboard/app/llms.txt/route.ts",
  ]) {
    const src = read(file);
    assert.match(src, /SUPPORT_EMAIL|Tamer@itis-uk\.org/, `${file} must surface support email`);
  }
});

test("Item 2: SUPER_ADMIN_EMAILS allows Tamer.abuhalaweh@gmail.com case-insensitively in production while rejecting customers", () => {
  const superAdmin = loadTsModule("apps/dashboard/lib/server/super-admin.ts", {
    "server-only": {},
    "@/lib/server/authorization": { authorize: async () => ({}) },
    "@/lib/server/database": { database: () => ({}) },
    "@/lib/server/launch-control": {
      PLATFORM_ORGANIZATION_ID: "10000000-0000-4000-8000-000000000001",
      listWaitlist: async () => [],
      loadLaunchConfig: async () => ({}),
      loadLaunchOffer: async () => ({}),
      lockLaunchControl: async () => {},
      normalizeLaunchConfig: (v) => v,
      waitlistQueuePosition: async () => 0,
      writeLaunchConfig: async () => {},
    },
    "@/lib/server/postiz-tenant": { postizWorkspaceConfigured: () => false },
    "@/lib/server/stripe-billing": { PLAN_DEFINITIONS: {}, isStripeCheckoutConfigured: () => false },
    "@/lib/server/workspace-quotas": {
      PLAN_MONTHLY_TOKENS: {},
      SANDBOX_MONTHLY_TOKEN_LIMIT: 100000,
      estimatedAiCostUsd: () => 0,
    },
  });

  const allowed = new Set(["tamer.abuhalaweh@gmail.com"]);
  const platformOwner = { organizationId: "10000000-0000-4000-8000-000000000001", role: "owner" };
  assert.equal(
    superAdmin.isPlatformSuperAdmin(platformOwner, "Tamer.abuhalaweh@gmail.com", allowed, { environment: "production" }),
    true,
  );
  assert.equal(
    superAdmin.isPlatformSuperAdmin(platformOwner, "tamer.abuhalaweh@gmail.com", allowed, { environment: "production" }),
    true,
  );
  assert.equal(
    superAdmin.isPlatformSuperAdmin(platformOwner, "customer.20261112@example.com", allowed, { environment: "production" }),
    false,
  );
  assert.equal(
    superAdmin.isPlatformSuperAdmin(platformOwner, "tamer.abuhalaweh@gmail.com", new Set(), { environment: "production" }),
    false,
  );
});

test("Item 3a & 3b: safeNextPath validates ?next= redirects, workspace & creative use authenticatedFetch/keep-alive, and TTL defaults to 3600s", () => {
  assert.equal(safeNextPath("/workspace?id=abc-123"), "/workspace?id=abc-123");
  assert.equal(safeNextPath("/super-admin"), "/super-admin");
  assert.equal(safeNextPath("/campaigns/42?tab=brief#top"), "/campaigns/42?tab=brief#top");
  assert.equal(safeNextPath("https://evil.com/steal"), "/");
  assert.equal(safeNextPath("//evil.com/steal"), "/");
  assert.equal(safeNextPath("/\\evil.com"), "/");
  assert.equal(safeNextPath("/foo\\bar"), "/");
  assert.equal(safeNextPath("javascript:alert(1)"), "/");
  assert.equal(safeNextPath("/login?next=/workspace"), "/");
  assert.equal(safeNextPath(""), "/");
  assert.equal(safeNextPath(null), "/");

  assert.equal(buildLoginRedirectUrl("/workspace", "?id=abc-123"), "/login?next=%2Fworkspace%3Fid%3Dabc-123");
  assert.equal(buildLoginRedirectUrl("/"), "/login");
  assert.equal(buildLoginRedirectUrl("/login", "?reset=1"), "/login");

  const workspace = read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(workspace, /authenticatedFetch\(`\/api\/workspace/);
  assert.match(workspace, /authenticatedFetch\("\/api\/workspace"/);
  assert.match(workspace, /markSessionActive\(\)/);
  assert.doesNotMatch(workspace, /window\.location\.assign\("\/login"\)/);

  const creativeApi = read("apps/dashboard/components/creative/api.tsx");
  assert.match(creativeApi, /authenticatedFetch\(path/);

  const authFetch = read("apps/dashboard/lib/client/authenticated-fetch.ts");
  assert.match(authFetch, /export function startSessionKeepAlive/);
  assert.match(authFetch, /buildLoginRedirectUrl\(window\.location\.pathname, window\.location\.search\)/);

  const appShell = read("apps/dashboard/components/app-shell.tsx");
  assert.match(appShell, /useEffect\(\(\) => startSessionKeepAlive\(\), \[\]\)/);

  const superAdminUi = read("apps/dashboard/components/super-admin-console.tsx");
  assert.match(superAdminUi, /useEffect\(\(\) => startSessionKeepAlive\(\), \[\]\)/);

  const loginPage = read("apps/dashboard/app/login/page.tsx");
  assert.match(loginPage, /next\?: string/);
  assert.match(loginPage, /nextPath=\{nextPath\}/);

  const loginForm = read("apps/dashboard/components/login-form.tsx");
  assert.match(loginForm, /new URLSearchParams\(window\.location\.search\)\.get\("next"\)/);
  assert.match(loginForm, /safeNextPath\(searchNext \?\? nextPath\)/);

  const authServer = read("deployment/dashboard-demo/auth/server.mjs");
  const compose = read("deployment/dashboard-demo/compose.yml");
  assert.match(authServer, /positiveInt\("AUTH_ACCESS_TTL_SECONDS", 3600\)/);
  assert.match(compose, /AUTH_ACCESS_TTL_SECONDS: \$\{AUTH_ACCESS_TTL_SECONDS:-3600\}/);
});

test("Item 4: integrations-settings and super-admin-console use neutral database wording with zero PostgreSQL leaks", () => {
  const integrations = read("apps/dashboard/components/integrations-settings.tsx");
  const superAdmin = read("apps/dashboard/components/super-admin-console.tsx");

  assert.doesNotMatch(integrations, /PostgreSQL/i);
  assert.match(integrations, /Saved secrets are encrypted before storage in the database/);

  assert.doesNotMatch(superAdmin, /PostgreSQL/i);
  assert.match(superAdmin, /database:\s*"Database"/);
  assert.match(superAdmin, /database:\s*"قاعدة البيانات"/);
});
