import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Postiz tenant provisioning is one-to-one, race-safe, encrypted and audited", async () => {
  const tenant = await read("apps/dashboard/lib/server/postiz-tenant.ts");
  assert.match(tenant, /randomBytes\(32\)\.toString\("hex"\)/);
  assert.match(tenant, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(tenant, /SELECT "apiKey" FROM "Organization" WHERE id = \$1/);
  assert.match(tenant, /let authoritativeKey = inserted\.rows\[0\]\?\.apiKey/);
  assert.match(tenant, /encryptCredential\(authoritativeKey\)/);
  assert.doesNotMatch(tenant, /encryptCredential\(candidateKey\)/, "a discarded race candidate must never be encrypted");
  assert.match(tenant, /configuration = \{[\s\S]*postiz_organization_id: postizOrganizationIdValue/);
  assert.match(tenant, /integration\.postiz_workspace_provisioned/);
  assert.match(tenant, /pg_advisory_xact_lock/);
  assert.match(tenant, /options\.pool/);
  assert.match(tenant, /WHERE organization_id = \$1 AND provider = 'postiz'/);
  assert.match(tenant, /postiz_workspace_already_linked/);
  assert.match(tenant, /postizOrganizationId\(row\) \|\| user\.organizationId/);
  assert.match(tenant, /status = 'connected'/);
  assert.match(tenant, /disconnected_at = NULL/);
});

test("channel routes derive the tenant only from authorize and protect every mutation", async () => {
  const route = await read("apps/dashboard/app/api/settings/channels/route.ts");
  const connect = await read("apps/dashboard/app/api/settings/channels/connect/route.ts");
  assert.match(route, /authorize\(request, ALL_ROLES\)/);
  assert.match(route, /enforceSameOriginForCookieMutation\(request\)/);
  assert.match(route, /authorize\(request, \["owner", "operator"\]\)/);
  assert.match(connect, /enforceSameOriginForCookieMutation\(request\)/);
  assert.match(connect, /authorize\(request, \["owner", "operator"\]\)/);
  assert.match(route, /user\.organizationId/);
  assert.match(connect, /user\.organizationId/);
  assert.doesNotMatch(`${route}\n${connect}`, /searchParams\.get\(["']organization|body\.organization_id/, "the request cannot choose a tenant");
});

test("customer channel API exposes the exact supported platform contract", async () => {
  const route = await read("apps/dashboard/app/api/settings/channels/route.ts");
  const tenant = await read("apps/dashboard/lib/server/postiz-tenant.ts");
  for (const value of [
    /platform: "instagram", postiz_integration: "instagram"/,
    /platform: "facebook", postiz_integration: "facebook"/,
    /platform: "linkedin", postiz_integration: "linkedin-page"/,
    /platform: "tiktok", postiz_integration: "tiktok"/,
    /platform: "x", postiz_integration: "x"/,
  ]) assert.match(tenant, value);
  assert.match(tenant, /variant === "instagram-standalone"/);
  assert.match(tenant, /variant === "linkedin"/);
  assert.match(route, /mapped_for_drafts/);
  assert.match(route, /provisioning_ready/);
  assert.match(route, /human_approval_required: true/);
  assert.match(route, /supported_platforms: SUPPORTED_PLATFORMS/);
  assert.match(route, /channels: \[\]/);
});

test("automatic mapping synchronizes only active supported channels for the tenant", async () => {
  const tenant = await read("apps/dashboard/lib/server/postiz-tenant.ts");
  assert.match(tenant, /DELETE FROM tanaghom\.publishing_channels WHERE organization_id = \$1 AND provider = 'postiz'/);
  assert.match(tenant, /INSERT INTO tanaghom\.publishing_channels/);
  assert.match(tenant, /channel\.disabled/);
  assert.match(tenant, /seenPlatforms/);
  assert.match(tenant, /platform === "instagram" \? \{ post_type: "post" \}/);
});

test("OAuth launch handles unconfigured providers without a 500 or broken redirect", async () => {
  const tenant = await read("apps/dashboard/lib/server/postiz-tenant.ts");
  const connect = await read("apps/dashboard/app/api/settings/channels/connect/route.ts");
  assert.match(tenant, /response\.status === 500 \|\| !response\.ok/);
  assert.match(tenant, /social_provider_not_configured/);
  assert.match(tenant, /parsed\.searchParams\.has\(name\)/);
  assert.match(tenant, /client_id/);
  assert.match(tenant, /client_key/);
  assert.match(tenant, /parsed\.protocol !== "https:"/);
  assert.match(connect, /PostizTenantError/);
  assert.match(connect, /platform/);
  assert.match(connect, /return noStore\(\{ url \}\)/);
  assert.doesNotMatch(connect, /apiKey|authoritativeKey|credential_ciphertext/);
});

test("the Postiz provisioner uses a bounded injectable pool", async () => {
  const database = await read("apps/dashboard/lib/server/postiz-database.ts");
  assert.match(database, /POSTIZ_DATABASE_URL/);
  assert.match(database, /POSTIZ_DATABASE_URL_FILE/);
  assert.match(database, /max: 5/);
  assert.match(database, /connectionTimeoutMillis: 5_000/);
  assert.match(database, /statement_timeout: 15_000/);
  assert.match(database, /export function createPostizPool/);
});

test("compose and docs wire the private Postiz database and internal API", async () => {
  const compose = await read("deployment/dashboard-demo/compose.yml");
  const postizCompose = await read("deployment/postiz/compose.yml");
  const envExample = await read("deployment/dashboard-demo/.env.example");
  const runbook = await read("deployment/dashboard-demo/RUNBOOK.md");
  assert.match(compose, /POSTIZ_DATABASE_URL: \$\{POSTIZ_DATABASE_URL:-postgresql:\/\/postiz@postiz-postgres:5432\/postiz\}/);
  assert.match(compose, /POSTIZ_INTERNAL_BASE_URL: \$\{POSTIZ_INTERNAL_BASE_URL:-http:\/\/postiz:5000\/api\/public\/v1\}/);
  assert.match(postizCompose, /networks: \[postiz-internal, tanaghom-backend\]/);
  assert.match(postizCompose, /name: tanaghom-dashboard-demo-backend/);
  assert.match(envExample, /POSTIZ_DATABASE_URL=postgresql:\/\/postiz@postiz-postgres:5432\/postiz/);
  assert.match(envExample, /POSTIZ_INTERNAL_BASE_URL=http:\/\/postiz:5000\/api\/public\/v1/);
  assert.match(runbook, /one Postiz[\s\S]*Organization[\s\S]*per Tanaghom tenant/);
  assert.match(runbook, /bounded pool of 5/);
});

test("the customer channels page is present, bilingual and RTL-safe", async () => {
  const page = await read("apps/dashboard/app/settings/channels/page.tsx");
  const component = await read("apps/dashboard/components/channels-settings.tsx");
  const navigation = await read("apps/dashboard/components/settings-navigation.tsx");
  assert.match(page, /ChannelsSettings/);
  assert.match(navigation, /\/settings\/channels/);
  assert.match(component, /useLocale/);
  assert.match(component, /dir=\{ar \? "rtl" : "ltr"\}/);
  assert.match(component, /قنوات التواصل/);
  assert.match(component, /social_provider_not_configured/);
  assert.match(component, /human approval/i);
  assert.match(component, /api\/settings\/channels\/connect/);
  assert.match(component, /method: "DELETE"/);
  assert.doesNotMatch(component, /apiKey|credential_ciphertext|postgresql:\/\//);
});
