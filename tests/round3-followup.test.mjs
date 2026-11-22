import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as creativeErrors from "../apps/dashboard/lib/creative-errors.ts";
import * as creativeI18n from "../apps/dashboard/lib/i18n/creative.ts";
import { normalizeHeadingText, withoutDuplicateHeading } from "../apps/dashboard/lib/deliverable-headings.ts";
import { resolveCreativeConfigPath } from "../apps/dashboard/lib/server/creative/config-path.ts";
import { truncateMarkdownAtWord } from "../apps/dashboard/lib/truncate.ts";

const root = path.resolve(import.meta.dirname, "..");
const requireCjs = createRequire(import.meta.url);
const ts = requireCjs("typescript");
const read = (relPath) => readFileSync(path.join(root, relPath), "utf8");

function loadTsx(relPath, extraImports = {}) {
  const js = ts.transpileModule(read(relPath), {
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
    if (id === "next/link") {
      return function LinkStub({ href, children, ...props }) {
        return createElement("a", { href, ...props }, children);
      };
    }
    if (id === "lucide-react") return { Check: () => null, RotateCcw: () => null };
    if (id === "@/lib/i18n/creative") return creativeI18n;
    if (id === "@/lib/creative-errors") return creativeErrors;
    throw new Error(`unexpected import in ${relPath}: ${id}`);
  };
  new Function("require", "module", "exports", js)(resolve, mod, mod.exports);
  return mod.exports;
}

// ---------------------------------------------------------------------------
// Item 8a — Preset config path resolution from apps/dashboard CWD
// ---------------------------------------------------------------------------

test("Item 8a: resolveCreativeConfigPath finds config/creative-image-presets.v1.json from both repo root and apps/dashboard", () => {
  // Confirm the historical broken path does NOT exist under apps/dashboard/.
  assert.equal(existsSync(path.join(root, "apps", "dashboard", "config", "creative-image-presets.v1.json")), false);

  for (const startDir of [root, path.join(root, "apps", "dashboard")]) {
    const resolved = resolveCreativeConfigPath("creative-image-presets.v1.json", startDir);
    assert.equal(resolved, path.join(root, "config", "creative-image-presets.v1.json"));
    const parsed = JSON.parse(readFileSync(resolved, "utf8"));
    const codes = parsed.presets.map((item) => item.code);
    assert.deepEqual(codes, ["clean_white", "marble", "wood", "office_studio", "outdoor_lifestyle"]);
  }

  assert.throws(
    () => resolveCreativeConfigPath("nonexistent-creative-config.v1.json", path.join(root, "apps", "dashboard")),
    (error) => error instanceof Error && error.code === "ENOENT",
  );
});

// ---------------------------------------------------------------------------
// Item 8b — Human LoadError messaging & static preset fallback in ProductView
// ---------------------------------------------------------------------------

test("Item 8b: LoadError and creativeErrorMessage never expose raw error codes and ProductView keeps static presets on 503", () => {
  const { creativeErrorMessage, FALLBACK_PRODUCT_PRESETS } = creativeErrors;

  for (const code of ["service_unavailable", "request_failed", "image_generation_disabled", "ml_segmentation_disabled", "unknown_internal_code"]) {
    for (const locale of ["en", "ar"]) {
      const text = creativeErrorMessage(code, locale);
      assert.ok(text.length > 10);
      assert.equal(text.includes(code), false, `raw code leaked for ${code}/${locale}: ${text}`);
      assert.doesNotMatch(text, /\([a-z_]+\)/);
    }
  }

  // Fallback list stays in sync with config/creative-image-presets.v1.json.
  const configDoc = JSON.parse(read("config/creative-image-presets.v1.json"));
  assert.deepEqual(
    FALLBACK_PRODUCT_PRESETS.map((p) => p.code),
    configDoc.presets.map((p) => p.code),
  );

  // Execute the real LoadError component from api.tsx.
  const { LoadError } = loadTsx("apps/dashboard/components/creative/api.tsx");
  const loadErrHtml = renderToStaticMarkup(
    createElement(LoadError, { locale: "en", error: "service_unavailable", onRetry: () => {} }),
  );
  assert.match(loadErrHtml, /This creative service is temporarily unavailable\./);
  assert.doesNotMatch(loadErrHtml, /service_unavailable/);
  assert.doesNotMatch(loadErrHtml, /Something went wrong\. \(/);
  assert.match(loadErrHtml, />Retry</);

  const loadErrArHtml = renderToStaticMarkup(
    createElement(LoadError, { locale: "ar", error: "service_unavailable", onRetry: () => {} }),
  );
  assert.match(loadErrArHtml, /هذه الخدمة الإبداعية غير متاحة مؤقتًا\./);
  assert.doesNotMatch(loadErrArHtml, /service_unavailable/);

  // Execute real ProductView with a simulated 503 presets fetch, then with a successful reload.
  let mockPresetsState = { loading: false, error: "service_unavailable", data: null, reload: () => {} };
  const { ProductView } = loadTsx("apps/dashboard/components/creative/product-view.tsx", {
    "@/components/creative/api": {
      CreativeApiError: class extends Error {},
      LoadError,
      Loading: () => null,
      api: async () => ({}),
      idempotencyKey: (p) => p,
      useSessionRole: () => "owner",
      useCreativeFetch: (_locale, endpoint) => (
        endpoint === "/api/creative/product/presets"
          ? mockPresetsState
          : { loading: false, error: null, data: { assets: [], jobs: [] }, reload: () => {} }
      ),
    },
  });

  const degradedHtml = renderToStaticMarkup(createElement(ProductView, { locale: "en", dir: "ltr" }));
  assert.match(degradedHtml, /This creative service is temporarily unavailable\./);
  assert.doesNotMatch(degradedHtml, /service_unavailable/);
  assert.match(degradedHtml, /Showing the built-in scene presets/);
  assert.match(degradedHtml, /<option value="clean_white"[^>]*>Clean white<\/option>/);
  assert.match(degradedHtml, /<option value="outdoor_lifestyle"[^>]*>Outdoor lifestyle<\/option>/);

  mockPresetsState = { loading: false, error: null, data: configDoc, reload: () => {} };
  const recoveredHtml = renderToStaticMarkup(createElement(ProductView, { locale: "en", dir: "ltr" }));
  assert.doesNotMatch(recoveredHtml, /temporarily unavailable/);
  assert.doesNotMatch(recoveredHtml, /built-in scene presets/);
  assert.match(recoveredHtml, /<option value="clean_white"[^>]*>Clean white<\/option>/);
});

// ---------------------------------------------------------------------------
// Item 11 — Always-visible feedback textarea & Request changes gating
// ---------------------------------------------------------------------------

test("Item 11: ApprovalDecisionPanel always shows the feedback textarea and gates Request changes at 3 trimmed chars", () => {
  const { ApprovalDecisionPanel, canRequestChanges, MIN_FEEDBACK } = loadTsx(
    "apps/dashboard/components/approval-decision-panel.tsx",
  );
  assert.equal(MIN_FEEDBACK, 3);
  assert.equal(canRequestChanges("", false), false);
  assert.equal(canRequestChanges("  ab ", false), false);
  assert.equal(canRequestChanges("abc", false), true);
  assert.equal(canRequestChanges("abc", true), false);

  const renderPanel = (overrides = {}) => renderToStaticMarkup(createElement(ApprovalDecisionPanel, {
    ar: false,
    source: "ai_workspace",
    reason: "",
    onReasonChange: () => {},
    submitting: false,
    approvalBlocked: false,
    onApprove: () => {},
    onRequestChanges: () => {},
    ...overrides,
  }));

  for (const shortReason of ["", "ab", "   "]) {
    const html = renderPanel({ reason: shortReason });
    assert.match(html, /<textarea id="rejection-reason"/);
    assert.match(html, /class="review-feedback-hint"/);
    assert.match(html, /<button class="danger-button" type="button" disabled=""[^>]*>[\s\S]*Request changes<\/button>/);
  }

  const readyHtml = renderPanel({ reason: "Fix the price" });
  assert.match(readyHtml, /<textarea id="rejection-reason"/);
  assert.doesNotMatch(readyHtml, /review-feedback-hint/);
  assert.match(readyHtml, /<button class="danger-button" type="button">[\s\S]*Request changes<\/button>/);

  const arBlocked = renderPanel({ ar: true, source: "content", reason: "نص" });
  assert.match(arBlocked, /<textarea id="rejection-reason"/);
  assert.match(arBlocked, /class="review-feedback-hint"/);
  assert.match(arBlocked, /<button class="danger-button" type="button" disabled=""[^>]*>[\s\S]*ارفض وأعد التوليد<\/button>/);

  const arReady = renderPanel({ ar: true, source: "content", reason: "تعديل السعر" });
  assert.doesNotMatch(arReady, /review-feedback-hint/);
  assert.match(arReady, /<button class="danger-button" type="button">[\s\S]*ارفض وأعد التوليد<\/button>/);
});

// ---------------------------------------------------------------------------
// Item 16 — Deduplicate headings across excerpt + numbered/parenthetical docs
// ---------------------------------------------------------------------------

test("Item 16: withoutDuplicateHeading drops excerpt-repeated and mid-document duplicate headings while preserving post subsections", () => {
  assert.equal(
    normalizeHeadingText("### 1. تحليل الاستراتيجية وصوت العلامة التجارية (Tanaghom Content Strategy)"),
    "تحليل الاستراتيجية وصوت العلامة التجارية",
  );
  assert.equal(
    normalizeHeadingText("### 2. تحليل الاستراتيجية وصوت العلامة التجارية (Strategy)"),
    "تحليل الاستراتيجية وصوت العلامة التجارية",
  );

  const liveDoc = [
    "### 1. تحليل الاستراتيجية وصوت العلامة التجارية (Tanaghom Content Strategy)",
    "",
    "*   **هدف الحملة:** الإعلان عن دورة تصميم الجرافيك للمبتدئين وتوجيه المهتمين للتسجيل في الدفعة القادمة.",
    "*   **الجمهور المستهدف:** المبتدئون في مجال التصميم في القاهرة ومصر عامةً عبر الإنترنت.",
    "*   **نبرة الصوت (Tone of Voice):** ودودة وعفوية ومشجعة وتعتمد على اللهجة المصرية الحية المعبرة دون تكلف.",
    "",
    "### 2. مسودات منشورات إنستغرام (Instagram Post Drafts)",
    "",
    "#### المسودة الأولى: خطوة البداية",
    "",
    "*   **الافتتاحية:** ابدأ الآن.",
  ].join("\n");

  const excerpt = truncateMarkdownAtWord(liveDoc, 320);
  assert.ok(liveDoc.length > excerpt.length);
  assert.match(excerpt, /تحليل الاستراتيجية وصوت العلامة التجارية/);

  const deduped = withoutDuplicateHeading(liveDoc, ["Content Creator", "Campaign copy"], excerpt);
  assert.doesNotMatch(deduped, /تحليل الاستراتيجية وصوت العلامة التجارية/);
  assert.match(deduped, /هدف الحملة/);
  assert.match(deduped, /2\. مسودات منشورات إنستغرام/);

  // Mid-document repeated section heading with altered numbering/parenthetical is dropped.
  const midRepeatDoc = [
    "### 1. تحليل الاستراتيجية وصوت العلامة التجارية (Tanaghom Content Strategy)",
    "",
    "Paragraph one.",
    "",
    "### 2. تحليل الاستراتيجية وصوت العلامة التجارية (Repeated Copy)",
    "",
    "Paragraph two.",
  ].join("\n");
  const dedupedMid = withoutDuplicateHeading(midRepeatDoc, []);
  assert.equal((dedupedMid.match(/تحليل الاستراتيجية وصوت العلامة التجارية/g) || []).length, 1);
  assert.match(dedupedMid, /Paragraph two\./);

  // Legitimate child subsections (English Copy / Arabic Copy) under later posts stay intact.
  const bilingualDoc = [
    "## Post 1",
    "",
    "### English Copy",
    "**Opening:** First post opener.",
    "",
    "### Arabic Copy",
    "**الافتتاحية:** افتتاحية المنشور الأول.",
    "",
    "## Post 2",
    "",
    "### English Copy",
    "**Opening:** Second post opener.",
    "",
    "### Arabic Copy",
    "**الافتتاحية:** افتتاحية المنشور الثاني.",
  ].join("\n");
  const firstExcerpt = truncateMarkdownAtWord(bilingualDoc, 120);
  const fullRendered = withoutDuplicateHeading(bilingualDoc, ["Content Creator"], firstExcerpt);
  assert.doesNotMatch(fullRendered, /^## Post 1$/m);
  assert.match(fullRendered, /## Post 2/);
  assert.equal((fullRendered.match(/### English Copy/g) || []).length, 2, "English Copy subsection kept under each post");
  assert.equal((fullRendered.match(/### Arabic Copy/g) || []).length, 2, "Arabic Copy subsection kept under each post");
});
