import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { onboardingStrings } from "../apps/dashboard/lib/i18n/onboarding.ts";
import { tenantDisplayName } from "../apps/dashboard/lib/tenant-name.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const upPath = "packages/database/migrations/0050_tenant_onboarding.up.sql";
const downPath = "packages/database/migrations/0050_tenant_onboarding.down.sql";
const demoOrganization = "10000000-0000-4000-8000-000000000001";

test("0050 adds resumable onboarding state to the tenant record", async () => {
  const sql = await read(upPath);

  // The guard pins the reviewed baseline, so a partial or drifted ledger
  // cannot silently apply the demo-retirement data change.
  assert.match(sql, /<> 46/);
  assert.match(sql, /0049_tenant_auth/);

  assert.match(sql, /ADD COLUMN business_name_en text/);
  assert.match(sql, /ADD COLUMN business_name_ar text/);
  assert.match(sql, /ADD COLUMN industry text/);
  assert.match(sql, /ADD COLUMN location text/);
  assert.match(sql, /ADD COLUMN onboarding_completed_at timestamptz/);
  assert.match(sql, /'retail_ecommerce', 'food_hospitality', 'services_consulting'/);
  assert.match(sql, /'real_estate', 'creative_media', 'technology', 'nonprofit', 'other'/);

  // The API role may only write the onboarding columns, not the tenant's
  // lifecycle status or Stripe linkage.
  assert.match(
    sql,
    /GRANT UPDATE \(business_name_en, business_name_ar, industry, location, onboarding_completed_at\)\s+ON tanaghom\.organizations TO tanaghom_api/,
  );
  assert.match(sql, /INSERT INTO public\.schema_migrations\(version\)\s+VALUES \('0050_tenant_onboarding'\)/);
});

test("0050 retires the synthetic demo tenant without deleting history", async () => {
  const sql = await read(upPath);
  const retirement = sql.slice(0, sql.indexOf("INSERT INTO public.schema_migrations"));

  assert.ok(retirement.includes(demoOrganization), "retirement must target the synthetic demo tenant");
  assert.match(retirement, /UPDATE tanaghom\.campaigns[\s\S]*SET status = 'closed'/);
  assert.match(retirement, /blocked_reason = 'Archived synthetic demo fixture; not a customer campaign\.'/);
  assert.match(retirement, /UPDATE tanaghom\.organizations\s+SET is_active = false/);
  assert.match(retirement, /UPDATE tanaghom\.integration_connections[\s\S]*SET status = 'disconnected'/);
  assert.match(retirement, /credential_ciphertext = NULL/);
  assert.match(retirement, /secret_last_four = NULL/);
  assert.match(retirement, /disconnected_at = coalesce\(disconnected_at, now\(\)\)/);
  assert.match(retirement, /UPDATE tanaghom\.publishing_channels\s+SET is_active = false/);

  // Demo logins must stop resolving: the account is disabled, the epoch
  // invalidates outstanding access tokens, sessions expire, and membership
  // is deactivated.
  assert.match(retirement, /UPDATE tanaghom\.users u\s+SET disabled = true, session_epoch = session_epoch \+ 1/);
  assert.match(retirement, /UPDATE tanaghom\.sessions\s+SET expires_at = now\(\)/);
  assert.match(retirement, /UPDATE tanaghom\.memberships\s+SET is_active = false/);

  // app_users_invitation_lifecycle requires the three invitation columns to
  // be detached together.
  assert.match(retirement, /SET is_active = false, auth_subject = NULL, invited_at = NULL, accepted_at = NULL/);

  // Retirement is audit-preserving: no row is deleted and no table dropped.
  assert.doesNotMatch(sql, /DELETE FROM tanaghom\./i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /TRUNCATE/i);
});

test("the down migration reverses only the schema change", async () => {
  const sql = await read(downPath);

  assert.match(sql, /DROP COLUMN IF EXISTS onboarding_completed_at/);
  assert.match(sql, /DROP COLUMN IF EXISTS location/);
  assert.match(sql, /DROP COLUMN IF EXISTS industry/);
  assert.match(sql, /DROP COLUMN IF EXISTS business_name_ar/);
  assert.match(sql, /DROP COLUMN IF EXISTS business_name_en/);
  assert.match(sql, /DELETE FROM public\.schema_migrations WHERE version = '0050_tenant_onboarding'/);

  // Demo-tenant retirement is deliberately one-way.
  assert.doesNotMatch(sql, /UPDATE tanaghom\./i);
  assert.doesNotMatch(sql, /INSERT INTO tanaghom\./i);
});

test("the demo ledger guards track the 47-migration chain", async () => {
  const migrations = (await readdir(new URL("packages/database/migrations/", root)))
    .filter((name) => name.endsWith(".up.sql"))
    .sort();
  assert.equal(migrations.length, 47);
  assert.equal(migrations.at(-1), "0050_tenant_onboarding.up.sql");

  const validateCompose = await read("deployment/dashboard-demo/scripts/validate-compose.py");
  assert.match(validateCompose, /len\(migrations\) == 47/);
  assert.match(validateCompose, /migrations\[-1\]\.name == "0050_tenant_onboarding\.up\.sql"/);
  assert.match(validateCompose, /path\.name\.split\("_", 1\)\[0\] for path in migrations\}\) == 47/);

  const configureRole = await read("deployment/dashboard-demo/sql/configure-api-role.sql");
  assert.match(configureRole, /<> 47/);
  assert.match(configureRole, /'0050_tenant_onboarding' THEN/);
  assert.match(configureRole, /exact migration 0050 ledger \(47 migrations\)/);

  const applyMigrations = await read("deployment/dashboard-demo/scripts/apply-migrations.sh");
  assert.match(applyMigrations, /version='0050_tenant_onboarding'/);

  const runbook = await read("deployment/dashboard-demo/RUNBOOK.md");
  assert.match(runbook, /DEMO_DATABASE_READY migrations=47/);
  assert.match(runbook, /47 up migrations, ending at `0050_tenant_onboarding`/);
  assert.match(runbook, /demo database must be at exact migration 0050 ledger/);
  assert.match(runbook, /all 47 up/);
});

test("tenant display names resolve per locale without rewriting the canonical name", () => {
  const both = { name: "al-nada", businessNameEn: "Al Nada Roastery", businessNameAr: "محمصة الندى" };
  assert.equal(tenantDisplayName(both, "en"), "Al Nada Roastery");
  assert.equal(tenantDisplayName(both, "ar"), "محمصة الندى");

  // Missing or blank localized names fall back through the other language and
  // finally to the canonical workspace name.
  assert.equal(tenantDisplayName({ name: "al-nada", businessNameEn: "  " }, "ar"), "al-nada");
  assert.equal(tenantDisplayName({ name: "al-nada", businessNameAr: "محمصة الندى" }, "en"), "محمصة الندى");
  assert.equal(tenantDisplayName({ name: "  al-nada  " }, "en"), "al-nada");
  assert.equal(tenantDisplayName({ name: "al-nada", businessNameEn: "  " }, "en"), "al-nada");
});

test("onboarding copy is complete in both locales", () => {
  const en = onboardingStrings.en;
  const ar = onboardingStrings.ar;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ar).sort());
  assert.deepEqual(Object.keys(en.industries).sort(), Object.keys(ar.industries).sort());
  for (const key of Object.keys(en)) {
    const value = en[key];
    if (typeof value === "string") assert.ok(value.trim(), `en.${key} is empty`);
    else assert.ok(Object.keys(value).length > 0, `en.${key} is empty`);
  }
  for (const key of Object.keys(ar)) {
    const value = ar[key];
    if (typeof value === "string") assert.ok(value.trim(), `ar.${key} is empty`);
    else assert.ok(Object.keys(value).length > 0, `ar.${key} is empty`);
  }
});

test("the onboarding profile route is owner-only, same-origin, and closed", async () => {
  const service = await read("apps/dashboard/lib/server/onboarding.ts");
  const route = await read("apps/dashboard/app/api/settings/onboarding/route.ts");

  assert.match(service, /authorize\(request, \["owner"\]\)/);
  assert.match(service, /enforceSameOriginForCookieMutation\(request\)/);
  assert.match(service, /unexpected_field/);
  assert.match(service, /empty_update/);
  assert.match(service, /business_name_en = \$2/);
  assert.match(service, /organizationId/);
  assert.doesNotMatch(service, /organization_id\s*=\s*body|body\.organization|searchParams\.get\("organization/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PATCH/);

  const session = await read("apps/dashboard/app/api/auth/session/route.ts");
  assert.match(session, /business_name_en, business_name_ar/);
  assert.match(session, /businessNameEn/);

  const shell = await read("apps/dashboard/components/app-shell.tsx");
  assert.match(shell, /TenantName/);
  const form = await read("apps/dashboard/components/onboarding-profile-form.tsx");
  assert.match(form, /tenantDisplayName/);
  const page = await read("apps/dashboard/app/onboarding/page.tsx");
  assert.match(page, /OnboardingProfileForm/);
});
