import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTsModule(path, stubResolver) {
  const requireCjs = createRequire(import.meta.url);
  const ts = requireCjs("typescript");
  const source = read(path);
  const js = ts.transpileModule(source, {
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

function loadQuotas() {
  return loadTsModule("apps/dashboard/lib/server/workspace-image-quotas.ts", (id) => {
    if (id.startsWith("node:")) return createRequire(import.meta.url)(id);
    if (id === "server-only") return {};
    if (id === "@tanaghom/creative-runtime/storage/keys") {
      return {
        buildObjectKey: ({ organizationId, assetId, mime }) =>
          `t/${organizationId}/image/${assetId}/v1.${mime === "image/png" ? "png" : "jpg"}`,
      };
    }
    if (id === "@/lib/server/creative/storage") {
      return { creativeStorage: () => ({ put: async () => ({}), get: async () => null }) };
    }
    if (id === "@/lib/server/workspace-quotas") {
      return { loadWorkspaceQuota: async () => ({ plan_tier: "growth", is_sandbox: false }) };
    }
    throw new Error(`unexpected import: ${id}`);
  });
}

const ORG = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";

// Minimal in-memory mirror of the two tables plus the plan lookup, so the quota
// rules are exercised against their real SQL shape without a database.
function fakeDb({ plan = "growth", usage = new Map(), images = [] } = {}) {
  return {
    plan,
    usage,
    images,
    queries: [],
    async query(text, params = []) {
      const sql = String(text);
      this.queries.push({ sql, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim()) || sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM tanaghom.organizations organization")) return { rows: [{ status: "active", plan_tier: plan }] };
      if (sql.includes("AS campaigns_used")) return { rows: [{ campaigns_used: 0, runs_used: 0, tokens_used: 0 }] };
      if (sql.includes("SELECT images_used FROM tanaghom.workspace_monthly_image_usage")) {
        return { rows: usage.has(params[1]) ? [{ images_used: usage.get(params[1]) }] : [] };
      }
      if (sql.includes("INSERT INTO tanaghom.workspace_monthly_image_usage")) {
        const [, month, limit] = params;
        const current = usage.get(month) ?? 0;
        if (current >= limit) return { rows: [] };
        usage.set(month, current + 1);
        return { rows: [{ images_used: current + 1 }] };
      }
      if (sql.includes("UPDATE tanaghom.workspace_monthly_image_usage")) {
        const [, month] = params;
        const next = Math.max(0, (usage.get(month) ?? 0) - 1);
        usage.set(month, next);
        return { rows: [{ images_used: next }] };
      }
      if (sql.includes("FROM tanaghom.workspace_post_images")) {
        const [workspaceId] = params;
        return { rows: images.filter((row) => row.workspace_id === workspaceId).sort((a, b) => a.post_index - b.post_index) };
      }
      if (sql.includes("INSERT INTO tanaghom.workspace_post_images")) {
        const [id, , workspaceId, postIndex, month, status, fallbackReason, model, objectKey, mimeType, byteSize, sha256, promptSummary] = params;
        const existingIndex = images.findIndex((row) => row.workspace_id === workspaceId && row.post_index === postIndex);
        if (existingIndex >= 0 && images[existingIndex].status === "generated") return { rows: [] };
        const row = {
          id, workspace_id: workspaceId, post_index: postIndex, month, status,
          fallback_reason: fallbackReason, model, object_key: objectKey, mime_type: mimeType,
          byte_size: byteSize, sha256_hex: sha256, prompt_summary: promptSummary,
        };
        if (existingIndex >= 0) images[existingIndex] = row;
        else images.push(row);
        return { rows: [row] };
      }
      throw new Error(`unexpected query: ${sql.replace(/\s+/g, " ").slice(0, 90)}`);
    },
  };
}

const POSTS = [1, 2, 3].map((index) => ({
  index,
  headline: `Post ${index} headline`,
  body: `Post ${index} body copy for the campaign.`,
  visual_brief: `Scene ${index} of the brand story`,
}));

function generateOk(counter) {
  return async () => {
    counter.calls += 1;
    return { bytes: Buffer.from(`image-${counter.calls}`), mimeType: "image/png", sha256: "a".repeat(64) };
  };
}

test("Packet L quota: a zero-cap tier never calls the provider and keeps the text cards", async () => {
  const quotas = loadQuotas();
  const db = fakeDb({ plan: "starter" });
  const counter = { calls: 0 };
  const rows = await quotas.ensureWorkspacePostImages(
    db,
    { organizationId: ORG, workspaceId: WORKSPACE, posts: POSTS },
    { plan: { plan_tier: "starter", is_sandbox: false }, now: new Date("2026-11-19T09:00:00Z"), generate: generateOk(counter), env: {} },
  );
  assert.equal(counter.calls, 0, "Starter must make no image API call");
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.status === "fallback" && row.fallback_reason === "tier_not_included"));
  assert.ok(rows.every((row) => row.url === null));
  assert.equal(db.usage.size, 0, "no slot is reserved when the plan includes no images");
  assert.equal(db.images.length, 3);
});

test("Packet L quota: reaching the monthly cap makes no further provider call", async () => {
  const quotas = loadQuotas();
  const month = quotas.utcMonthStart(new Date("2026-11-19T09:00:00Z"));
  const db = fakeDb({ usage: new Map([[month, 15]]) });
  const counter = { calls: 0 };
  const rows = await quotas.ensureWorkspacePostImages(
    db,
    { organizationId: ORG, workspaceId: WORKSPACE, posts: [POSTS[0]] },
    { plan: { plan_tier: "growth", is_sandbox: false }, now: new Date("2026-11-19T09:00:00Z"), generate: generateOk(counter), env: {} },
  );
  assert.equal(counter.calls, 0);
  assert.equal(rows[0].status, "fallback");
  assert.equal(rows[0].fallback_reason, "monthly_quota_reached");
  assert.equal(db.usage.get(month), 15, "usage never exceeds the cap");
});

test("Packet L quota: mid-campaign overage fills the remaining posts with branded text cards", async () => {
  const quotas = loadQuotas();
  const month = quotas.utcMonthStart(new Date("2026-11-19T09:00:00Z"));
  const db = fakeDb({ usage: new Map([[month, 13]]) });
  const counter = { calls: 0 };
  const rows = await quotas.ensureWorkspacePostImages(
    db,
    { organizationId: ORG, workspaceId: WORKSPACE, posts: POSTS },
    { plan: { plan_tier: "growth", is_sandbox: false }, now: new Date("2026-11-19T09:00:00Z"), generate: generateOk(counter), env: {} },
  );
  assert.equal(counter.calls, 2, "only the two remaining slots are generated");
  assert.deepEqual(rows.map((row) => row.status), ["generated", "generated", "fallback"]);
  assert.equal(rows[2].fallback_reason, "monthly_quota_reached");
  assert.equal(db.usage.get(month), 15);
  assert.deepEqual(rows.map((row) => row.post_index), [1, 2, 3]);
  assert.match(rows[0].url, new RegExp(`^/api/workspace/${WORKSPACE}/images/1$`));
});

test("Packet L quota: a provider failure refunds the slot and never fails the pack", async () => {
  const quotas = loadQuotas();
  const month = quotas.utcMonthStart(new Date("2026-11-19T09:00:00Z"));
  const db = fakeDb({ usage: new Map() });
  let calls = 0;
  const rows = await quotas.ensureWorkspacePostImages(
    db,
    { organizationId: ORG, workspaceId: WORKSPACE, posts: POSTS },
    {
      plan: { plan_tier: "growth", is_sandbox: false },
      now: new Date("2026-11-19T09:00:00Z"),
      env: {},
      generate: async () => {
        calls += 1;
        throw Object.assign(new Error("upstream timeout"), { code: "provider_error" });
      },
    },
  );
  assert.equal(calls, 3);
  assert.ok(rows.every((row) => row.status === "fallback" && row.fallback_reason === "provider_error"));
  assert.equal(db.usage.get(month) ?? 0, 0, "failed generations are refunded");

  // A temporary provider failure must not permanently latch the post to a text
  // card: retrying when Google recovers upgrades the fallback rows in place.
  const counter = { calls: 0 };
  const retried = await quotas.ensureWorkspacePostImages(
    db,
    { organizationId: ORG, workspaceId: WORKSPACE, posts: POSTS },
    {
      plan: { plan_tier: "growth", is_sandbox: false },
      now: new Date("2026-11-19T09:05:00Z"),
      env: {},
      generate: generateOk(counter),
    },
  );
  assert.equal(counter.calls, 3, "all three provider_error fallbacks are retried");
  assert.ok(retried.every((row) => row.status === "generated" && row.url));
  assert.equal(db.usage.get(month), 3, "successful retry charges the three recovered images");
});

test("Packet L quota: a new UTC calendar month starts with fresh capacity", async () => {
  const quotas = loadQuotas();
  const db = fakeDb({ usage: new Map([["2026-11-01", 15]]) });
  const counter = { calls: 0 };
  const rows = await quotas.ensureWorkspacePostImages(
    db,
    { organizationId: ORG, workspaceId: WORKSPACE, posts: [POSTS[0]] },
    { plan: { plan_tier: "growth", is_sandbox: false }, now: new Date("2026-12-01T00:00:00Z"), generate: generateOk(counter), env: {} },
  );
  assert.equal(counter.calls, 1);
  assert.equal(rows[0].status, "generated");
  assert.equal(db.usage.get("2026-12-01"), 1);
  assert.equal(db.usage.get("2026-11-01"), 15, "the previous month keeps its recorded usage");
});

test("Packet L quota: reloading the same posts reuses stored images without charging again", async () => {
  const quotas = loadQuotas();
  const month = quotas.utcMonthStart(new Date("2026-11-19T09:00:00Z"));
  const db = fakeDb({ usage: new Map() });
  const counter = { calls: 0 };
  const deps = { plan: { plan_tier: "growth", is_sandbox: false }, now: new Date("2026-11-19T09:00:00Z"), generate: generateOk(counter), env: {} };
  const first = await quotas.ensureWorkspacePostImages(db, { organizationId: ORG, workspaceId: WORKSPACE, posts: POSTS }, deps);
  const second = await quotas.ensureWorkspacePostImages(db, { organizationId: ORG, workspaceId: WORKSPACE, posts: POSTS }, deps);
  assert.equal(counter.calls, 3);
  assert.equal(db.usage.get(month), 3);
  assert.deepEqual(second.map((row) => row.post_index), first.map((row) => row.post_index));
});

test("Packet L prompt: each post's own visual brief drives its scene and every prompt bans rendered text", async () => {
  const { buildPostImagePrompt, postImageBriefs } = await import("../packages/agent-runtime/google-images.mjs");
  const document = [
    "## Post 1: Cozy bedroom refresh",
    "* **Visual Brief:** A cozy bedroom with layered linen bedding and warm morning light.",
    "* **Opening:** Sleep better tonight.",
    "* **Body:** Soft cotton bedding delivered across Jordan.",
    "",
    "## Post 2: Kitchen tools",
    "* **Visual Brief:** A modern kitchen counter with stainless tools and fresh herbs.",
    "* **Opening:** Cook with confidence.",
    "* **Body:** Practical tools for every home kitchen.",
  ].join("\n");
  const briefs = postImageBriefs(document, 3);
  assert.equal(briefs.length, 2);
  assert.match(briefs[0].visual_brief, /cozy bedroom/);
  assert.match(briefs[1].visual_brief, /kitchen counter/);
  const brandKit = { name: "HomeStff", brand_name: "HomeStff", colors: { primary: "#0F3D3E", accent: "#C6A15B" }, tone: "Warm and practical" };
  const bedroom = buildPostImagePrompt({ post: briefs[0], brandKit, campaign: { title: "Winter comfort" } });
  const kitchen = buildPostImagePrompt({ post: briefs[1], brandKit, campaign: { title: "Winter comfort" } });
  assert.notEqual(bedroom, kitchen);
  assert.match(bedroom, /cozy bedroom with layered linen bedding/);
  assert.match(kitchen, /kitchen counter with stainless tools/);
  for (const prompt of [bedroom, kitchen]) {
    assert.match(prompt, /Do NOT render any text, words, letters, Arabic script, English script, numbers, watermarks, captions, buttons, or logos/);
    assert.match(prompt, /#0F3D3E and #C6A15B/);
    assert.match(prompt, /HomeStff/);
  }
});

test("Packet L UI: generated photos render on the card, the quota pill is localised, and Design Studio imports same-origin images only", () => {
  const quotas = loadQuotas();
  const ai = loadTsModule("apps/dashboard/components/workspace-ai-images.tsx", (id) => {
    if (id === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null, Fragment: "Fragment" };
    throw new Error(`unexpected import: ${id}`);
  });
  assert.equal(
    ai.imageQuotaText({ plan_tier: "growth", is_sandbox: false, images_used: 3, images_limit: 15, month: "2026-11-01" }, false),
    "AI images: 3 of 15 used this month",
  );
  assert.equal(
    ai.imageQuotaText({ plan_tier: "starter", is_sandbox: false, images_used: 0, images_limit: 0, month: "2026-11-01" }, false),
    "AI images: 0 included on Starter (using brand-styled SVG/PNG cards)",
  );
  assert.equal(
    ai.imageQuotaText({ plan_tier: "starter", is_sandbox: false, images_used: 0, images_limit: 0, month: "2026-11-01" }, true),
    "صور الذكاء الاصطناعي: غير مشمولة في باقة البداية (تُعرض بطاقات الهوية البصرية SVG/PNG)",
  );
  assert.equal(
    ai.imageQuotaText({ plan_tier: "growth", is_sandbox: false, images_used: 3, images_limit: 15, month: "2026-11-01" }, true),
    "صور الذكاء الاصطناعي: 3 من 15 مستخدمة هذا الشهر",
  );
  const slots = ai.postImageSlots([
    { post_index: 1, status: "generated", url: "/api/workspace/x/images/1" },
    { post_index: 2, status: "fallback", url: null },
  ]);
  assert.deepEqual(Object.keys(slots), ["1"]);

  const cards = read("apps/dashboard/components/workspace-post-cards.tsx");
  assert.match(cards, /className="aw-post-image"/);
  assert.match(cards, /images\?\.\[index \+ 1\]\?\.url/);
  assert.match(cards, /designParams\.set\("image", imageUrl\)/);

  const studio = read("apps/dashboard/components/creative/designs-view.tsx");
  assert.match(studio, /WORKSPACE_IMAGE_PATH/);
  assert.match(studio, /params\.get\("image"\)/);
  assert.match(studio, /className="creative-import-image"/);

  const view = read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(view, /postImageSlots\(data\.post_images\)/);
  assert.match(view, /<WorkspaceImageQuota quota=\{data\?\.image_quota\}/);
  assert.ok(quotas.PLAN_MONTHLY_AI_IMAGES.growth === 15 && quotas.PLAN_MONTHLY_AI_IMAGES.scale === 60 && quotas.PLAN_MONTHLY_AI_IMAGES.starter === 0);
});

test("Packet L migration 0054 carries the exact ledger guard, image tables and least-privilege grants", () => {
  const up = read("packages/database/migrations/0054_workspace_image_quotas.up.sql");
  const down = read("packages/database/migrations/0054_workspace_image_quotas.down.sql");
  assert.match(up, /count\(\*\) FROM public\.schema_migrations\) <> 50/);
  assert.match(up, /0053_workspace_step_retry/);
  assert.match(up, /CREATE TABLE tanaghom\.workspace_post_images/);
  assert.match(up, /CREATE TABLE tanaghom\.workspace_monthly_image_usage/);
  assert.match(up, /post_index smallint NOT NULL CHECK \(post_index BETWEEN 1 AND 3\)/);
  assert.match(up, /UNIQUE \(workspace_id, post_index\)/);
  assert.match(up, /GRANT SELECT, INSERT, UPDATE ON tanaghom\.workspace_post_images TO tanaghom_api/);
  assert.match(up, /GRANT SELECT, INSERT, UPDATE ON tanaghom\.workspace_monthly_image_usage TO tanaghom_api/);
  assert.match(up, /VALUES\('0054_workspace_image_quotas'\)/);
  assert.match(down, /DROP TABLE tanaghom\.workspace_post_images/);
  assert.match(down, /DELETE FROM public\.schema_migrations WHERE version='0054_workspace_image_quotas'/);

  const role = read("deployment/dashboard-demo/sql/configure-api-role.sql");
  assert.match(role, /0054_workspace_image_quotas/);
  assert.match(role, /51 migrations/);
});
