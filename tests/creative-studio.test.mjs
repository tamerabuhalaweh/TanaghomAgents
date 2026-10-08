import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLocale, directionOf, t, creativeStrings, CREATIVE_LOCALE_COOKIE } from "../apps/dashboard/lib/i18n/creative.ts";

const root = new URL("../", import.meta.url);
const { readFile } = await import("node:fs/promises");
const read = (path) => readFile(new URL(path, root), "utf8");

test("creative dictionaries stay complete across locales", async () => {
  const enKeys = Object.keys(creativeStrings.en).sort();
  const arKeys = Object.keys(creativeStrings.ar).sort();
  assert.deepEqual(arKeys, enKeys);
  assert.ok(enKeys.length > 40);
  for (const key of enKeys) {
    assert.ok(creativeStrings.ar[key] && creativeStrings.ar[key].length > 0, `missing ar: ${key}`);
  }
  assert.equal(normalizeLocale("ar"), "ar");
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("fr"), "en");
  assert.equal(normalizeLocale(undefined), "en");
  assert.equal(directionOf("ar"), "rtl");
  assert.equal(directionOf("en"), "ltr");
  assert.equal(t("ar", "nav.creative"), "استوديو الإبداع");
  assert.equal(t("en", "nav.creative"), "Creative Studio");
  assert.equal(CREATIVE_LOCALE_COOKIE, "tanaghom_locale");
});

test("creative studio migration, routes, and pages follow foundation conventions", async () => {
  const up = await read("packages/database/migrations/0037_creative_studio_management.up.sql");
  const down = await read("packages/database/migrations/0037_creative_studio_management.down.sql");
  assert.match(up, /0037 requires exact 0036 baseline/);
  for (const fn of ["create_brand_kit\\(", "create_brand_kit_version\\(", "set_brand_kit_current\\(",
    "create_creative_template\\(", "set_creative_template_active\\(", "register_upload_asset\\("]) {
    assert.match(up, new RegExp(`CREATE FUNCTION tanaghom\\.${fn}`));
  }
  assert.match(up, /TO tanaghom_api/);
  assert.doesNotMatch(up, /TO tanaghom_creative_worker/);
  assert.match(up, /creative_asset_versions_object_key_unique/);
  assert.match(up, /upload_registered/);
  assert.match(down, /DELETE FROM public.schema_migrations WHERE version='0037_creative_studio_management'/);
  assert.match(down, /creative_events_action_check/);
});

test("review round two: globals read-only, no generic claim, idempotency-first, safe preview, serialized versions", async () => {
  const up = await read("packages/database/migrations/0037_creative_studio_management.up.sql");
  // 1. Tenant-only templates: 4-arg signature, no global path, read-only globals.
  assert.match(up, /CREATE FUNCTION tanaghom\.create_creative_template\(p_actor uuid,p_kind text,p_name text,p_spec jsonb\)/);
  assert.doesNotMatch(up, /p_global/);
  assert.match(up, /global template is read-only/);
  const templates = await read("apps/dashboard/lib/server/creative/templates.ts");
  assert.match(templates, /global_templates_read_only/);
  // 2. Upload pipeline avoids the generic claimant and control gate.
  assert.doesNotMatch(up, /claim_creative_job\('cpu','upload-pipeline'/);
  assert.match(up, /UPDATE tanaghom\.creative_jobs SET status='claimed',attempt=attempt\+1,claimed_by='upload-pipeline'/);
  // 3. Idempotency reservation precedes the storage write textually.
  const upload = await read("apps/dashboard/lib/server/creative/upload.ts");
  assert.ok(upload.indexOf("reserveIdempotency(client") < upload.indexOf("storage.put("));
  assert.match(upload, /if \(stored\)/);
  // 4. Preview allowlist + nosniff + HTML refusal.
  const preview = await read("apps/dashboard/app/api/creative/assets/versions/[id]/preview/route.ts");
  assert.match(preview, /new Set\(\["image\/png", "image\/jpeg", "image\/webp"\]\)/);
  assert.match(preview, /X-Content-Type-Options/);
  assert.match(preview, /nosniff/);
  assert.match(preview, /preview_not_supported/);
  // 5. Version allocation serializes on the parent/scope.
  assert.match(up, /SELECT \* INTO k FROM tanaghom\.brand_kits WHERE id=p_kit FOR UPDATE/);
  assert.match(up, /pg_advisory_xact_lock\(hashtextextended\('creative-template:'\|\|org/);
});

test("creative server boundary stays provider-free with upload guards", async () => {
  const upload = await read("apps/dashboard/lib/server/creative/upload.ts");
  const storage = await read("apps/dashboard/lib/server/creative/storage.ts");
  const keys = await read("apps/dashboard/lib/server/creative/object-keys.ts");
  assert.match(upload, /requireCreativeStudio\(\)/);
  assert.match(upload, /authorize\(request, \["owner", "operator"\]\)/);
  assert.match(upload, /limitInputPixels/);
  assert.match(upload, /sharp\(bytes/);
  assert.match(storage, /flag: "wx"/);
  assert.match(upload, /register_upload_asset/);
  assert.match(upload, /Idempotency-Replayed/);
  assert.match(upload, /agent_actions_log/);
  assert.doesNotMatch(upload, /fetch\(|https?:\/\/|comfyui|openai|anthropic|replicate|fal\.ai/i);
  assert.doesNotMatch(storage, /fetch\(|https?:\/\/|AWS_|S3_|secret|password|token/i);
  assert.match(storage, /object_key_shape_violation/);
  assert.match(storage, /\.\./);
  assert.match(keys, /png.*jpg.*webp|jpg.*png/);
  assert.match(keys, /`t\/\$\{args\.organizationId\}/);
  for (const route of [
    "apps/dashboard/app/api/creative/brand-kits/route.ts",
    "apps/dashboard/app/api/creative/brand-kits/[id]/route.ts",
    "apps/dashboard/app/api/creative/brand-kits/[id]/versions/route.ts",
    "apps/dashboard/app/api/creative/brand-kits/[id]/current/route.ts",
    "apps/dashboard/app/api/creative/templates/route.ts",
    "apps/dashboard/app/api/creative/templates/[id]/active/route.ts",
    "apps/dashboard/app/api/creative/uploads/route.ts",
    "apps/dashboard/app/api/creative/assets/versions/[id]/preview/route.ts",
    "apps/dashboard/app/api/creative/assets/[id]/route.ts",
  ]) {
    const source = await read(route);
    assert.match(source, /export const runtime = "nodejs"/);
  }
});

test("creative studio UI is bilingual, direction-aware, and role-gated", async () => {
  for (const page of [
    "apps/dashboard/app/creative/page.tsx",
    "apps/dashboard/app/creative/jobs/page.tsx",
    "apps/dashboard/app/creative/jobs/[id]/page.tsx",
    "apps/dashboard/app/creative/assets/page.tsx",
    "apps/dashboard/app/creative/assets/[id]/page.tsx",
    "apps/dashboard/app/creative/assets/versions/[id]/page.tsx",
    "apps/dashboard/app/creative/brand-kits/page.tsx",
    "apps/dashboard/app/creative/brand-kits/[id]/page.tsx",
    "apps/dashboard/app/creative/templates/page.tsx",
  ]) {
    const source = await read(page);
    assert.match(source, /creativeLocale\(\)/);
    assert.match(source, /LocaleToggle/);
  }
  for (const view of [
    "apps/dashboard/components/creative/creative-overview.tsx",
    "apps/dashboard/components/creative/jobs-view.tsx",
    "apps/dashboard/components/creative/job-detail-view.tsx",
    "apps/dashboard/components/creative/assets-view.tsx",
    "apps/dashboard/components/creative/asset-views.tsx",
    "apps/dashboard/components/creative/brand-kit-views.tsx",
    "apps/dashboard/components/creative/templates-view.tsx",
  ]) {
    const source = await read(view);
    assert.match(source, /dir=\{dir\}/);
    assert.match(source, /lang=\{locale\}/);
  }
  const shell = await read("apps/dashboard/components/app-shell.tsx");
  assert.match(shell, /\/creative/);
  const css = await read("apps/dashboard/app/creative.css");
  assert.match(css, /padding-inline|margin-inline|inset-inline/);
  assert.doesNotMatch(css, /margin-left|margin-right|text-align:\s*left/);
  assert.match(css, /Noto Kufi Arabic|Cairo|Tajawal/);
  const toggle = await read("apps/dashboard/components/creative/locale-toggle.tsx");
  assert.match(toggle, /CREATIVE_LOCALE_COOKIE/);
  assert.match(toggle, /document\.cookie/);
  const assets = await read("apps/dashboard/components/creative/assets-view.tsx");
  assert.match(assets, /canUpload/);
  const versions = await read("apps/dashboard/components/creative/asset-views.tsx");
  assert.match(versions, /canReview/);
});
