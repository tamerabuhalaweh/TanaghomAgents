import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import { buildTemplateSpec, TEMPLATE_FORMATS } from "../apps/dashboard/lib/creative-template-spec.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const requireCjs = createRequire(import.meta.url);
const ts = requireCjs("typescript");

function loadTsModule(path, stubResolver = (id) => {
  if (id === "server-only") return {};
  throw new Error(`unexpected import: ${id}`);
}) {
  const js = ts.transpileModule(read(path), {
    fileName: path.split("/").pop(),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", js)(stubResolver, mod, mod.exports);
  return mod.exports;
}

function noopProxy() {
  return new Proxy({}, { get: () => () => ({}) });
}

test("Item 1: channels page deduplicates supported platforms, keeps WhatsApp out (provider gap), and hides Disconnect when empty", () => {
  const channels = read("apps/dashboard/components/channels-settings.tsx");
  assert.match(channels, /const supportedPlatforms = payload\?\.supported_platforms\.filter/);
  assert.match(channels, /supportedPlatforms\.map\(/);
  assert.match(channels, /payload\.provisioning_ready && payload\.can_manage && payload\.channels\.length > 0/);
  assert.doesNotMatch(channels, /whatsapp/i);

  // Confirm underlying Postiz provider union only supports the 5 channels.
  const provider = read("apps/dashboard/lib/server/postiz-tenant.ts");
  assert.doesNotMatch(provider, /whatsapp/i);
});

test("Item 2: /content-library permanently redirects to /content in next.config.ts", () => {
  const config = read("apps/dashboard/next.config.ts");
  assert.match(config, /async redirects\(\)/);
  assert.match(config, /source:\s*"\/content-library"/);
  assert.match(config, /destination:\s*"\/content"/);
  assert.match(config, /permanent:\s*true/);
});

test("Item 3: /agents translates all 23 blockers, all 4 roles, and all 7 workers into customer-safe EN/AR text", () => {
  const agentsMod = loadTsModule("apps/dashboard/components/agents-workspace.tsx", (id) => {
    if (id === "react" || id === "react/jsx-runtime" || id === "lucide-react" || id === "next/link") return noopProxy();
    if (id.startsWith("@/")) return noopProxy();
    throw new Error(`unexpected import: ${id}`);
  });
  const { customerSafeText, customerBlockerCopy, customerRoleCopy, customerWorkerCopy } = agentsMod;

  const registrySource = read("apps/dashboard/lib/server/agent-registry.ts");
  const catalogStart = registrySource.indexOf("const blockerCatalog");
  const catalogEnd = registrySource.indexOf("function blocker(", catalogStart);
  const catalogBlock = registrySource.slice(catalogStart, catalogEnd);
  const blockerEntries = [...catalogBlock.matchAll(
    /^\s{2}([a-z0-9_]+):\s*\{\s*title:\s*"([^"]+)",\s*detail:\s*"([^"]+)",\s*next_action:\s*"([^"]+)"/gm,
  )];
  assert.ok(blockerEntries.length >= 23, `expected all 23 blocker codes, got ${blockerEntries.length}`);

  const forbidden = /\b(PostgreSQL|n8n|Gemma|GoHighLevel|GHL|Postiz|Phase\s+\d+[A-Za-z]?|pinned export|readiness flag|schedule trigger|private gateway|private integration gateway|private credential gateway|versioned strategy contract|production seed|queue claims|UAT|shadow)\b/i;

  for (const [, code, title, detail, next_action] of blockerEntries) {
    for (const ar of [false, true]) {
      const copy = customerBlockerCopy({ code, title, detail, next_action }, ar);
      assert.ok(copy.title.length > 0 && copy.detail.length > 0 && copy.nextAction.length > 0, `${code} (${ar ? "ar" : "en"}) non-empty`);
      assert.doesNotMatch(`${copy.title} ${copy.detail} ${copy.nextAction}`, forbidden, `blocker ${code} leaked jargon`);
    }
  }

  // Fallback on an unknown blocker still strips internal ops terms cleanly.
  const unknown = customerBlockerCopy({
    code: "unknown_future_blocker",
    title: "n8n workflow not enabled for PostgreSQL",
    detail: "Private integration gateway Phase 4 UAT failed on Gemma queue claims.",
    next_action: "Update GoHighLevel and Postiz readiness flag in production seed.",
  }, false);
  assert.doesNotMatch(`${unknown.title} ${unknown.detail} ${unknown.nextAction}`, forbidden);

  // Check every role and worker parsed from migration 0022.
  const sql = read("packages/database/migrations/0022_agent_registry.up.sql");
  const roleMatches = [...sql.matchAll(/\('([a-z_]+)','([^']+)','[^']+',\s*'([^']+)',\d+\)/g)];
  assert.equal(roleMatches.length, 4);
  for (const [, code, name, responsibility] of roleMatches) {
    for (const ar of [false, true]) {
      const copy = customerRoleCopy({ code, name, responsibility }, ar);
      assert.doesNotMatch(`${copy.name} ${copy.responsibility}`, forbidden, `role ${code} leaked jargon`);
    }
  }

  const workerMatches = [...sql.matchAll(/\('([a-z_]+)','[a-z_]+','([^']+)',\s*'([^']+)',\s*'Phase/g)];
  assert.equal(workerMatches.length, 7);
  for (const [, code, name, responsibility] of workerMatches) {
    for (const ar of [false, true]) {
      const copy = customerWorkerCopy({ code, name, responsibility }, ar);
      assert.doesNotMatch(`${copy.name} ${copy.responsibility}`, forbidden, `worker ${code} leaked jargon`);
    }
  }

  assert.equal(customerSafeText("n8n workflow using PostgreSQL & Gemma on Postiz Phase 5E"), "automation runtime workflow using workspace records & AI model on social publishing");
});

test("Item 4: /system renames PostgreSQL, hides Protected runtime, and shows Clear instead of Active when unconfigured", () => {
  const system = read("apps/dashboard/components/system-view.tsx");
  assert.doesNotMatch(system, /PostgreSQL/);
  assert.doesNotMatch(system, /Protected runtime|protectedRuntime/);
  assert.match(system, /postgres:\s*"Workspace records"/);
  assert.match(system, /postgres:\s*"سجلات مساحة العمل"/);
  assert.match(system, /const notConfigured = !delivery\.delivery_ready && !delivery\.runtime_ready && delivery\.selected_destinations === 0;/);
  assert.match(system, /const emergencyActive = delivery\.emergency_stop && !notConfigured;/);
  assert.match(system, /emergencyActive \? text\.active : text\.clear/);
  assert.match(system, /notConfigured \? text\.deliveryNotConfigured : text\.deliveryLocked/);
});

test("Item 5: /actions removes GoHighLevel jargon and audit activity hides internal webhooks & formats customer events", () => {
  const review = read("apps/dashboard/components/ghl-action-review.tsx");
  assert.doesNotMatch(review, /GoHighLevel|\bGHL\b/);

  const activityMod = loadTsModule("apps/dashboard/components/live-activity.tsx", (id) => {
    if (id === "react" || id === "react/jsx-runtime" || id === "lucide-react") return noopProxy();
    if (id.startsWith("@/")) return noopProxy();
    throw new Error(`unexpected import: ${id}`);
  });
  const { isCustomerAuditAction, formatAuditActionLabel } = activityMod;

  const hidden = [
    "billing.webhook.customer.subscription.updated",
    "platform.launch_config.updated",
    "integration.postiz_workspace_provisioned",
    "creative.job_claimed",
    "creative.job_running",
  ];
  for (const action of hidden) {
    assert.equal(isCustomerAuditAction(action), false, `${action} must be hidden from customer history`);
  }

  const visible = [
    "auth.signup",
    "creative.asset_version_created",
    "creative.brand_kit_created",
    "creative.brand_kit_created_api",
    "creative.brand_kit_version_created",
    "creative.brand_kit_version_created_api",
    "creative.design_created_api",
    "creative.design_version_created_api",
    "creative.job_succeeded",
    "creative.template_version_created",
    "creative.upload_registered",
    "integration.channel_disconnected",
    "integration.connection_tested",
    "integration.credential_saved",
    "knowledge.draft_created",
    "workspace.brief_configured",
    "workspace.inference_failed",
    "workspace.inference_succeeded",
  ];
  for (const action of visible) {
    assert.equal(isCustomerAuditAction(action), true, `${action} remains visible`);
    for (const locale of ["en", "ar"]) {
      const label = formatAuditActionLabel(action, locale);
      assert.ok(label.length > 0, `${action} (${locale}) label`);
      assert.doesNotMatch(label, /_api|\bpostiz\b|\bghl\b|gohighlevel|webhook/i, `${action} (${locale}) leaked internal token: ${label}`);
      if (locale === "ar") {
        assert.match(label, /[\u0600-\u06ff]/, `${action} ar label has Arabic script`);
      }
    }
  }
});

test("Item 6: /creative/templates replaces raw JSON with guided builder producing backend-valid specs", () => {
  const designsMod = loadTsModule("apps/dashboard/lib/server/creative/designs.ts", (id) => {
    if (id === "server-only") return {};
    if (id === "node:crypto") return { createHash: () => ({}), randomUUID: () => "00000000-0000-4000-8000-000000000000" };
    if (id === "@/lib/server/creative/jobs") {
      return {
        CreativeJobRequestError: class CreativeJobRequestError extends Error {
          constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
        },
      };
    }
    if (id.startsWith("@/")) return noopProxy();
    throw new Error(`unexpected import: ${id}`);
  });
  const { validateDesignSpec } = designsMod;

  for (const format of TEMPLATE_FORMATS) {
    for (const locale of ["en", "ar"]) {
      const ad = buildTemplateSpec({
        kind: "ad",
        locale,
        format,
        headline: locale === "ar" ? "تشكيلة الصيف" : "Summer collection",
        body: locale === "ar" ? "شحن سريع لجميع الطلبات" : "Fast delivery on every order",
        cta: locale === "ar" ? "اطلب الآن" : "Order now",
        backgroundColor: "#ffffff",
      });
      validateDesignSpec("ad", ad);

      const carousel = buildTemplateSpec({
        kind: "carousel",
        locale,
        format,
        headline: locale === "ar" ? "خطوات بسيطة" : "Three simple steps",
        body: "",
        cta: locale === "ar" ? "اكتشف المزيد" : "Learn more",
        backgroundColor: "#0F3D3E",
      });
      validateDesignSpec("carousel", carousel);
    }
  }

  const landing = buildTemplateSpec({ kind: "landing", locale: "en", format: "1:1", headline: "Welcome", body: "Details" });
  assert.equal(landing.headline, "Welcome");
  assert.equal(landing.body, "Details");

  const view = read("apps/dashboard/components/creative/templates-view.tsx");
  assert.match(view, /buildTemplateSpec/);
  assert.match(view, /useCustomJson/);
  assert.match(view, /<details className="creative-more">/);
  assert.match(view, /href="\/creative\/motion"/);
  // Raw JSON textarea lives strictly inside the collapsed <details> override block.
  const detailsIdx = view.indexOf('<details className="creative-more">');
  const jsonTextAreaIdx = view.indexOf("onChange={(event) => setSpec(event.target.value)}");
  assert.ok(detailsIdx > 0 && jsonTextAreaIdx > detailsIdx);
});

test("Item 7: Team page, tab titles, SSR metadata, and Arabic comma are completely localised", () => {
  const team = read("apps/dashboard/components/team-management.tsx");
  assert.match(team, /useLocale\(\)/);
  assert.match(team, /dir=\{ar \? "rtl" : "ltr"\}/);
  assert.match(team, /الفريق والوصول/);
  assert.match(team, /دعوة عضو/);
  assert.match(team, /دليل الأدوار/);
  assert.doesNotMatch(team, /Supabase secret key|Supabase server key/i);

  const campaignsPage = read("apps/dashboard/app/campaigns/page.tsx");
  assert.match(campaignsPage, /export async function generateMetadata/);
  assert.match(campaignsPage, /"الحملات · إعلاني"/);

  const teamPage = read("apps/dashboard/app/team/page.tsx");
  assert.match(teamPage, /export async function generateMetadata/);
  assert.match(teamPage, /"الفريق والوصول · إعلاني"/);

  const docTitle = read("apps/dashboard/components/localised-document-title.tsx");
  assert.match(docTitle, /new MutationObserver/);
  const titleMod = loadTsModule("apps/dashboard/components/localised-document-title.tsx", (id) => {
    if (id === "react" || id === "react/jsx-runtime" || id === "next/navigation") return noopProxy();
    if (id.startsWith("@/")) return noopProxy();
    throw new Error(`unexpected import: ${id}`);
  });
  assert.equal(titleMod.titleForRoute("/", "ar"), "لوحة التحكم · إعلاني");
  assert.equal(titleMod.titleForRoute("/", "en"), "Overview · E3lani");
  assert.equal(titleMod.titleForRoute("/campaigns", "ar"), "الحملات · إعلاني");
  assert.equal(titleMod.titleForRoute("/team", "ar"), "الفريق والوصول · إعلاني");
  assert.equal(titleMod.titleForRoute("/settings/channels", "ar"), "قنوات التواصل · إعلاني");

  const overview = read("apps/dashboard/components/overview-dashboard.tsx");
  assert.match(overview, /، و\$\{formatArabicCount\(data\.summary\.approvals_pending/);
  assert.doesNotMatch(overview, /,\s*و\$\{formatArabicCount/);
});

test("Item 8: workspace task footers use neutral AI label and remove Version & source lineage", () => {
  const workspace = read("apps/dashboard/components/agency-workspace.tsx");
  const footerStart = workspace.indexOf('<footer className="aw-artifact-meta">');
  const footerEnd = workspace.indexOf("</footer>", footerStart);
  assert.ok(footerStart > 0 && footerEnd > footerStart);
  const footer = workspace.slice(footerStart, footerEnd);

  assert.match(footer, /"Executive delivery summary"/);
  assert.match(footer, /"ملخص التسليم التنفيذي"/);
  assert.match(footer, /"AI-generated"/);
  assert.match(footer, /"أُنتج بالذكاء الاصطناعي"/);
  assert.doesNotMatch(footer, /step\.result\.provider|step\.result\.model|Version & source lineage|الإصدار والمصدر|response_hash|procedure_version/);
});

test("Item 9: post-card SVG carries full spaced aria-label and hides inner <text> nodes from screen readers", () => {
  const cardsMod = loadTsModule("apps/dashboard/components/workspace-post-cards.tsx", (id) => {
    if (id === "react" || id === "react/jsx-runtime" || id === "lucide-react" || id === "next/link") return noopProxy();
    if (id.startsWith("@/")) return noopProxy();
    throw new Error(`unexpected import: ${id}`);
  });
  const label = cardsMod.accessibleCardLabel("HomeStff", {
    headline: "Transform your home into a peaceful sanctuary.",
    body: "Explore luxury bedding collections and kitchen essentials.",
    cta: "Shop Now",
  });
  assert.equal(
    label,
    "HomeStff — Transform your home into a peaceful sanctuary. — Explore luxury bedding collections and kitchen essentials. — Shop Now",
  );
  assert.doesNotMatch(label, /peacefulsanctuary|beddingcollections|ShopNow/);

  const source = read("apps/dashboard/components/workspace-post-cards.tsx");
  assert.match(source, /aria-label=\{accessibleCardLabel\(brandName, card\)\}/);
  assert.equal((source.match(/<text\b[^>]*aria-hidden="true"|<text[\s\S]*?aria-hidden="true"/g) || []).length >= 4, true);
  assert.equal((source.match(/aria-hidden="true"/g) || []).length >= 4, true);
});
