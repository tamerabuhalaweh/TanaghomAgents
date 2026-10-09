import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import { readFile, readFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFileAsync(new URL(path, root), "utf8");
const rootPath = fileURLToPath(new URL("../", import.meta.url));
const loadJson = (path) => JSON.parse(readFileSync(`${rootPath}${path}`, "utf8"));

const adDoc = {
  contract_version: "creative.ad-document.v1",
  kind: "ad",
  locale: "ar",
  direction: "rtl",
  canvas: { width: 1080, height: 1080 },
  background: { color: "#ffffff" },
  nodes: [
    { id: "headline-1", type: "text", role: "headline", x: 90, y: 120, width: 900, height: 220, text: "عنوان رئيسي", font_size: 96, font_weight: 800, align: "start", color: "#111111" },
    { id: "cta-1", type: "badge", role: "cta", x: 90, y: 580, width: 420, height: 110, text: "اطلب الآن", font_size: 44, font_weight: 700, align: "center", color: "#ffffff", background_color: "#0f766e", corner_radius: 55 },
  ],
};

const carouselDoc = {
  contract_version: "creative.carousel-document.v1",
  kind: "carousel",
  locale: "ar",
  direction: "rtl",
  canvas: { width: 1080, height: 1080 },
  background: { color: "#ffffff" },
  pages: ["cover", "body", "end"].map((kind, index) => ({
    id: `slide-${index + 1}`,
    kind,
    nodes: [{ id: `slide-${index + 1}-headline`, type: "text", role: "headline", x: 90, y: 120, width: 900, height: 200, text: `شريحة ${index + 1}`, font_size: 72, font_weight: 700, align: "start", color: "#111111" }],
  })),
};

test("creative design migration is additive, guarded, and reversible", async () => {
  const up = await read("packages/database/migrations/0039_creative_design_render.up.sql");
  const down = await read("packages/database/migrations/0039_creative_design_render.down.sql");
  assert.match(up, /0039 requires exact 0038 baseline/);
  assert.match(up, /CREATE FUNCTION tanaghom\.get_creative_render_input\(/);
  assert.match(up, /CREATE FUNCTION tanaghom\.get_creative_render_source\(/);
  assert.match(up, /CREATE FUNCTION tanaghom\.count_creative_render_outputs\(/);
  assert.match(up, /CREATE FUNCTION tanaghom\.get_creative_render_version_asset\(/);
  assert.match(up, /CREATE FUNCTION tanaghom\.claim_creative_design_job\(/);
  assert.match(up, /capability IN \('design','carousel'\)/);
  assert.match(up, /FOR UPDATE OF job SKIP LOCKED/);
  assert.match(up, /TO tanaghom_api, tanaghom_creative_worker/);
  assert.match(up, /GRANT EXECUTE ON FUNCTION tanaghom\.claim_creative_design_job\(text,int\) TO tanaghom_creative_worker;/);
  assert.match(up, /INSERT INTO public\.schema_migrations\(version\) VALUES \('0039_creative_design_render'\)/);
  assert.doesNotMatch(up, /CREATE TABLE/);
  assert.doesNotMatch(up, /GRANT SELECT/);
  assert.match(down, /DROP FUNCTION tanaghom\.claim_creative_design_job\(text,int\);/);
  assert.match(down, /DROP FUNCTION tanaghom\.get_creative_render_input\(uuid,text\);/);
  assert.match(down, /DELETE FROM public.schema_migrations WHERE version='0039_creative_design_render'/);
});

test("ad and carousel design contracts validate", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validateAd = ajv.compile(loadJson("packages/contracts/schemas/creative/ad-document.v1.schema.json"));
  assert.equal(validateAd(adDoc), true);
  assert.equal(validateAd({ ...adDoc, canvas: { width: 1080, height: 999 } }), false);
  assert.equal(validateAd({ ...adDoc, direction: "ltr" }), true);
  const validateCarousel = ajv.compile(loadJson("packages/contracts/schemas/creative/carousel-document.v1.schema.json"));
  assert.equal(validateCarousel(carouselDoc), true);
  assert.equal(validateCarousel({ ...carouselDoc, pages: carouselDoc.pages.slice(0, 1) }), false);
  assert.equal(validateCarousel({ ...carouselDoc, pages: [...carouselDoc.pages, ...carouselDoc.pages, ...carouselDoc.pages, ...carouselDoc.pages] }), false);
});

test("document renderer validates, escapes, and builds deterministic HTML", async () => {
  const render = await import("../packages/creative-runtime/render/document.mjs");
  const summary = render.validateDocument(adDoc);
  assert.deepEqual(summary.pages, ["page-1"]);
  assert.throws(() => render.validateDocument({ ...adDoc, direction: "ltr" }), /locale_direction_mismatch/);
  assert.throws(() => render.validateDocument({ ...adDoc, nodes: [] }), /node_count/);
  assert.throws(() => render.validateDocument({ ...adDoc, nodes: [...adDoc.nodes, { ...adDoc.nodes[0] }] }), /duplicate_node_id/);
  assert.throws(() => render.validateDocument({
    ...adDoc, nodes: [{ id: "evil", type: "text", x: 0, y: 0, width: 100, height: 100, text: "x", evil: true }],
  }), /unknown_node_property/);
  assert.throws(() => render.validateDocument({
    ...adDoc, nodes: [{ id: "oob", type: "text", x: 1000, y: 0, width: 200, height: 100, text: "x" }],
  }), /out_of_canvas/);
  assert.throws(() => render.validateDocument({ ...carouselDoc, pages: carouselDoc.pages.slice(0, 1) }), /page_count/);
  const evil = {
    ...adDoc,
    nodes: [{ id: "x1", type: "text", x: 0, y: 0, width: 500, height: 100, text: "<script>alert(1)</script>" }],
  };
  const pages = render.buildDocumentHtml({ doc: evil, assets: new Map(), fontCss: "", fontFamily: "Cairo" });
  assert.equal(pages.length, 1);
  assert.doesNotMatch(pages[0].html, /<script/);
  assert.match(pages[0].html, /&lt;script&gt;/);
  assert.match(pages[0].html, /dir="rtl"/);
  assert.match(pages[0].html, /lang="ar"/);
  assert.doesNotMatch(pages[0].html, /https?:\/\//);
  const again = render.buildDocumentHtml({ doc: evil, assets: new Map(), fontCss: "", fontFamily: "Cairo" });
  assert.equal(pages[0].html, again[0].html);
  const carouselPages = render.buildDocumentHtml({ doc: carouselDoc, assets: new Map(), fontCss: "", fontFamily: "Cairo" });
  assert.equal(carouselPages.length, 3);
  assert.throws(() => render.buildPageHtml({
    doc: adDoc, pageId: "nope", assets: new Map(), fontCss: "", fontFamily: "Cairo",
  }), /unknown_page/);
  assert.throws(() => render.buildPageHtml({
    doc: { ...adDoc, nodes: [{ id: "img-1", type: "image", role: "product", x: 0, y: 0, width: 100, height: 100, asset_version_id: "11111111-1111-4111-8111-111111111111" }] },
    pageId: "page-1", assets: new Map(), fontCss: "", fontFamily: "Cairo",
  }), /unresolved_asset_ref/);
});

test("font policy pins the bundled Cairo build", async () => {
  const policy = loadJson("config/creative-fonts.v1.json");
  assert.equal(policy.contract_version, "creative.fonts.v1");
  const cairo = policy.render_families[0];
  assert.equal(cairo.family, "Cairo");
  assert.equal(cairo.license, "SIL Open Font License 1.1");
  const bytes = readFileSync(`${rootPath}packages/creative-runtime/render/fonts/Cairo.ttf`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), cairo.sha256);
  assert.ok(bytes.length > 100000);
  assert.equal(policy.rules.no_remote_fonts, true);
});

test("design server boundary stays strict and provider-free", async () => {
  for (const module of ["designs", "render"]) {
    const source = await read(`apps/dashboard/lib/server/creative/${module}.ts`);
    assert.match(source, /requireCreativeStudio\(\)/);
    assert.match(source, /authorize\(request, \[/);
    assert.match(source, /agent_actions_log/);
    assert.doesNotMatch(source, /fetch\(|https?:\/\/|comfyui|openai|anthropic|replicate|fal\.ai/i);
  }
  const designs = await read("apps/dashboard/lib/server/creative/designs.ts");
  assert.match(designs, /design_studio_disabled|carousel_builder_disabled/);
  assert.match(designs, /Idempotency-Replayed/);
  for (const route of [
    "apps/dashboard/app/api/creative/designs/route.ts",
    "apps/dashboard/app/api/creative/designs/[id]/route.ts",
    "apps/dashboard/app/api/creative/designs/[id]/versions/route.ts",
    "apps/dashboard/app/api/creative/designs/[id]/render/route.ts",
    "apps/dashboard/app/api/creative/designs/[id]/preview/route.ts",
  ]) {
    assert.match(await read(route), /export const runtime = "nodejs"/);
  }
  const preview = await read("apps/dashboard/app/api/creative/designs/[id]/preview/route.ts");
  assert.match(preview, /buildDocumentHtml/);
  assert.match(preview, /bundledFontCss/);
  assert.match(preview, /text\/html/);
  assert.match(preview, /Content-Security-Policy/);
  assert.match(preview, /default-src 'none'/);
  assert.match(preview, /img-src data:/);
  assert.match(preview, /font-src data:/);
  assert.match(preview, /frame-ancestors 'none'/);
});
