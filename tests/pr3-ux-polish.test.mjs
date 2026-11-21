import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTsModule(path, stubResolver) {
  const requireCjs = createRequire(import.meta.url);
  const ts = requireCjs("typescript");
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

function loadLocaliser() {
  return loadTsModule("apps/dashboard/lib/server/creative/localize-starter-spec.ts", (id) => {
    if (id === "server-only") return {};
    throw new Error(`unexpected import: ${id}`);
  });
}

/** Every seeded platform starter template, read from the real seed file. */
function starterTemplates() {
  const sql = read("packages/database/seeds/creative_templates.sql");
  const statement = sql.slice(sql.indexOf("VALUES"), sql.lastIndexOf("ON CONFLICT"));
  const rows = [];
  const rowRe = /\('([^']+)',NULL,'(ad|carousel)','([a-z-]+)',\s*'(\{[\s\S]*?\})',/g;
  let match;
  while ((match = rowRe.exec(statement))) {
    rows.push({ name: match[3], kind: match[2], spec: JSON.parse(match[4]) });
  }
  return rows;
}

function textNodes(spec) {
  const pages = Array.isArray(spec.pages) ? spec.pages : [{ nodes: spec.nodes }];
  return pages.flatMap((page) => page.nodes.filter((node) => typeof node.text === "string"));
}

test("the sidebar timezone note is styled at every viewport width", () => {
  const css = read("apps/dashboard/app/globals.css");
  const index = css.indexOf(".sidebar-timezone {");
  assert.ok(index > 0, ".sidebar-timezone rule exists");

  let depth = 0;
  for (const char of css.slice(0, index)) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
  }
  assert.equal(depth, 0, ".sidebar-timezone must live outside every @media block");
  assert.match(css.slice(index, index + 120), /color: var\(--muted\); font-size: 0\.66rem; line-height: 1\.4;/);
});

test("the overview campaign table shows one status, not a duplicated stage", () => {
  const overview = read("apps/dashboard/components/overview-dashboard.tsx");
  assert.doesNotMatch(overview, /\{ar \? "المرحلة" : "Stage"\}/);
  assert.doesNotMatch(overview, /: "Stage"\}/);
  // One campaignStage call: the Status pill. There is no second column.
  assert.equal((overview.match(/campaignStage\(campaign, ar\)/g) || []).length, 1);
  const columns = [["الحملة", "Campaign"], ["الحالة", "Status"], ["المحتوى", "Content"], ["الاعتمادات", "Approvals"], ["العملاء المحتملون", "Leads"]];
  for (const [arabic, english] of columns) {
    assert.ok(overview.includes(`{ar ? "${arabic}" : "${english}"}`), `column ${english} kept`);
  }
});

test("rejected reads as changes requested everywhere it is shown", () => {
  const overview = read("apps/dashboard/components/overview-dashboard.tsx");
  const campaigns = read("apps/dashboard/components/campaigns-view.tsx");

  for (const source of [overview, campaigns]) {
    assert.match(source, /rejected: "Changes requested"/);
    assert.match(source, /rejected: "طُلب التعديل"/);
    assert.match(source, /waiting_review: "Ready for your review"/);
    assert.match(source, /waiting_review: "جاهز لمراجعتك"/);
  }
  assert.match(overview, /campaignStatusEn/);
  assert.match(overview, /changesRequested/);
  assert.doesNotMatch(overview, /rejected`/, "the headline no longer says rejected");
});

test("the content library heading does not repeat the work-pack label", () => {
  const content = read("apps/dashboard/components/content-library.tsx");
  assert.match(content, /item\.channel === "ai_workspace" \? \(ar \? "مساحة الذكاء الاصطناعي" : "AI workspace"\)/);
  assert.doesNotMatch(content, /"AI work pack"/);
  assert.match(content, /"AI workspace"\) : item\.channel\} · \{item\.content_type === "work_pack" \? \(ar \? "حزمة عمل" : "Work pack"\)/);
});

test("the browser tab title is localised by the shell, not by the root frame", () => {
  const shell = read("apps/dashboard/components/app-shell.tsx");
  const frame = read("apps/dashboard/components/root-frame.tsx");
  const page = read("apps/dashboard/app/page.tsx");

  assert.match(shell, /import \{ LocalisedDocumentTitle \} from "\.\/localised-document-title"/);
  assert.match(shell, /<LocalisedDocumentTitle \/>/);
  assert.doesNotMatch(frame, /LocalisedDocumentTitle/);
  // Public marketing routes never mount the shell, so their SEO metadata is untouched.
  assert.match(page, /title: locale === "ar" \? "لوحة التحكم" : "Overview"/);
});

test("a pre-activation workspace is not shown the emergency-stop alarm", () => {
  const inbox = read("apps/dashboard/components/supervisor-inbox.tsx");
  assert.match(inbox, /const awaitingActivation = emergencyStopped/);
  assert.match(inbox, /\.trim\(\)\.toLowerCase\(\) === "awaiting supervised conversation activation"/);
  assert.match(inbox, /&& \(payload\?\.conversations\.length \?\? 0\) === 0;/);
  // Round 3 made the whole inbox bilingual: the English copy is still the default
  // branch, and each string now has an Arabic sibling.
  assert.match(inbox, /"Supervised conversations are not activated yet"/);
  assert.match(inbox, /"Organization emergency stop is active"/);
  assert.match(inbox, /No live customer conversations are routed here yet\./);
  assert.match(inbox, /"Not activated"/);
  // The red state survives for a real stop.
  assert.match(inbox, /emergencyStopped && !awaitingActivation \? "conversation-safety-stopped"/);
});

test("the wins metric renders as one string, so it cannot break across lines", () => {
  const overview = read("apps/dashboard/components/overview-dashboard.tsx");
  assert.match(overview, /`\$\{formatNumber\(data\.summary\.leads_won, locale\)\} won`/);
  assert.doesNotMatch(overview, /won<\/>/);
});

test("the eight platform starters render clean copy in the requested language", () => {
  const { localizeStarterSpec } = loadLocaliser();
  const templates = starterTemplates();
  assert.deepEqual(
    templates.map((template) => template.name).sort(),
    ["announcement", "carousel-edu", "carousel-offer", "event-course", "product-promo", "quote", "story-promo", "tips"],
  );

  for (const template of templates) {
    const english = localizeStarterSpec(template.name, null, template.spec, "en");
    assert.equal(english.locale, "en", template.name);
    assert.equal(english.direction, "ltr", template.name);
    for (const node of textNodes(english)) {
      assert.doesNotMatch(node.text, /[\u0600-\u06ff]/, `${template.name}: English starter leaked Arabic in "${node.text}"`);
    }

    const arabic = localizeStarterSpec(template.name, null, template.spec, "ar");
    assert.equal(arabic.locale, "ar", template.name);
    assert.equal(arabic.direction, "rtl", template.name);
    for (const node of textNodes(arabic)) {
      assert.doesNotMatch(node.text, /[A-Za-z]/, `${template.name}: Arabic starter leaked English in "${node.text}"`);
    }

    // Geometry, roles and colours stay exactly as seeded; only copy changes.
    const original = textNodes(template.spec).map((node) => [node.id, node.x, node.y, node.width, node.height, node.role, node.color]);
    const localized = textNodes(english).map((node) => [node.id, node.x, node.y, node.width, node.height, node.role, node.color]);
    assert.deepEqual(localized, original, template.name);
  }
});

test("tenant-owned designs and unlocalised calls keep the stored spec", () => {
  const { localizeStarterSpec } = loadLocaliser();
  const spec = { locale: "ar", direction: "rtl", canvas: { width: 1080, height: 1080 }, nodes: [{ id: "headline-1", type: "text", text: "نص العميل" }] };

  assert.equal(localizeStarterSpec("product-promo", "0b4a2c9a-0000-4000-8000-000000000000", spec, "en"), spec);
  assert.equal(localizeStarterSpec("product-promo", null, spec, null), spec);
  // A design name that is not a platform starter is never rewritten.
  assert.equal(localizeStarterSpec("custom-launch", null, spec, "en"), spec);
});

test("the design preview and editor ask the server for the UI language", () => {
  for (const file of ["creative-overview.tsx", "designs-view.tsx"]) {
    assert.match(read(`apps/dashboard/components/creative/${file}`), /preview\?locale=\$\{locale\}/, file);
  }
  const editor = read("apps/dashboard/components/creative/design-editor-view.tsx");
  assert.match(editor, /preview\?format=\$\{previewFormat\}&v=\$\{loaded\.version\}&locale=\$\{locale\}/);
  assert.match(editor, /designs\/\$\{templateId\}\?locale=\$\{locale\}`/);

  const route = read("apps/dashboard/app/api/creative/designs/[id]/preview/route.ts");
  assert.match(route, /SELECT spec, kind, name, version, organization_id FROM tanaghom\.creative_templates/);
  assert.match(route, /localizeStarterSpec\(row\.name, row\.organization_id, spec, locale\)/);

  const designs = read("apps/dashboard/lib/server/creative/designs.ts");
  assert.match(designs, /localizeStarterSpec\(String\(row\.name\)/);
  assert.match(designs, /const locale = localeParam === "en" \|\| localeParam === "ar" \? localeParam : null;/);
});
