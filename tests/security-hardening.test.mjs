import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("0052 hardens audit attribution and the global creative control", async () => {
  const up = await read("packages/database/migrations/0052_security_hardening.up.sql");
  const down = await read("packages/database/migrations/0052_security_hardening.down.sql");

  assert.match(up, /0052 requires the exact 0051 ledger \(48 migrations\)/);
  assert.match(up, /DISABLE TRIGGER audit_no_update/);
  assert.ok(
    up.indexOf("DISABLE TRIGGER audit_no_update") < up.indexOf("ENABLE TRIGGER audit_no_update"),
    "the audit immutability trigger must be restored after the backfill",
  );
  for (const entity of [
    "ghl_inbound_event",
    "conversation",
    "ghl_action_job",
    "creative_job",
    "creative_asset_version",
  ]) {
    assert.match(up, new RegExp(`NEW\\.entity_type = '${entity}'`));
  }
  assert.match(up, /job\.input->>'organization_id'/);
  assert.match(up, /REVOKE EXECUTE ON FUNCTION tanaghom\.assign_agent_action_organization\(\) FROM PUBLIC/);
  assert.match(up, /REVOKE EXECUTE ON FUNCTION tanaghom\.set_creative_control\(uuid, boolean, boolean, text\)/);
  assert.match(up, /FROM tanaghom_api/);
  assert.match(up, /VALUES \('0052_security_hardening'\)/);

  assert.match(down, /CREATE OR REPLACE FUNCTION tanaghom\.assign_agent_action_organization/);
  assert.match(down, /GRANT EXECUTE ON FUNCTION tanaghom\.set_creative_control/);
  assert.match(down, /DELETE FROM public\.schema_migrations WHERE version = '0052_security_hardening'/);
});

test("motion preview and render resolve referenced designs within the caller tenant", async () => {
  const preview = await read("apps/dashboard/app/api/creative/motions/[id]/preview/route.ts");
  const render = await read("apps/dashboard/lib/server/creative/motion-render.ts");

  for (const source of [preview, render]) {
    assert.match(
      source,
      /WHERE id = \$1[\s\S]*organization_id = \$2 OR organization_id IS NULL/,
      "referenced design lookup must include the caller tenant or a global design",
    );
  }
  assert.match(preview, /\[designId, user\.organizationId\]/);
  assert.match(render, /\[designId, user\.organizationId\]/);
  assert.match(render, /motion_design_not_found/);
  assert.match(preview, /frame-ancestors 'self'/);
  assert.match(
    await read("apps/dashboard/app/api/creative/designs/[id]/preview/route.ts"),
    /frame-ancestors 'self'/,
  );
});

test("creative template creation validates design and motion specs before persisting", async () => {
  const templates = await read("apps/dashboard/lib/server/creative/templates.ts");
  assert.match(templates, /assertSafeValue\(spec, "spec", 48\)/);
  assert.match(templates, /validateDesignSpec\(kind, spec\)/);
  assert.match(templates, /loadDesign\(spec\.design_template_id, user\.organizationId\)/);
  assert.match(templates, /validateMotionSpec\(spec, design\)/);
  assert.match(templates, /design_not_found/);

  for (const component of [
    "creative-overview.tsx",
    "designs-view.tsx",
    "design-editor-view.tsx",
    "motion-editor-view.tsx",
  ]) {
    const source = await read(`apps/dashboard/components/creative/${component}`);
    assert.match(source, /<iframe[^>]*sandbox=""/, `${component} preview must be sandboxed`);
  }
});

test("notification and approval reads are strictly tenant scoped", async () => {
  const operations = await read("apps/dashboard/app/api/operations/route.ts");
  const monitoring = await read("apps/dashboard/lib/server/system-monitoring.ts");
  for (const source of [operations, monitoring]) {
    assert.doesNotMatch(source, /user_id IS NULL OR/);
    assert.match(source, /user_id IN \(\s*SELECT id FROM tanaghom\.app_users WHERE organization_id/);
  }
  const decision = await read("apps/dashboard/lib/server/content-decision.ts");
  assert.match(decision, /JOIN tanaghom\.campaigns campaign ON campaign\.id = content\.campaign_id/);
  assert.match(decision, /campaign\.organization_id = \$2/);
  assert.match(decision, /FOR UPDATE OF content/);
});

test("signup is rate-limited, the rate map is bounded, and login has no email-only lockout", async () => {
  const server = await read("deployment/dashboard-demo/auth/server.mjs");
  const store = await read("deployment/dashboard-demo/auth/store.mjs");

  assert.match(server, /AUTH_SIGNUP_IP_LIMIT/);
  assert.match(server, /signupBlock/);
  assert.match(server, /noteSignup/);
  assert.match(server, /AUTH_RATE_LIMIT_MAX_KEYS/);
  assert.match(server, /MAX_FAILURE_KEYS/);
  assert.match(server, /forwarded\.split\(","\)\.at\(-1\)/);
  assert.doesNotMatch(server, /email\|/);
  assert.match(server, /Retry-After/);

  assert.match(store, /randomBytes/);
  assert.match(store, /base\.slice\(0, 68\)/);
  assert.doesNotMatch(store, /for \(let attempt = 2; ;/);
});

test("the edge rejects Postiz registration and overwrites forwarding headers", async () => {
  const caddy = await read("deployment/dashboard-demo/caddy/Caddyfile");
  assert.match(caddy, /@postizRegister path \/api\/auth\/register\*/);
  assert.match(caddy, /respond @postizRegister 403/);
  assert.match(caddy, /header_up X-Forwarded-For \{remote_host\}/);

  const postiz = await read("deployment/postiz/compose.yml");
  assert.match(postiz, /DISABLE_REGISTRATION: "true"/);
  const postizEnv = await read("deployment/postiz/postiz.env.example");
  assert.match(postizEnv, /POSTIZ_PUBLIC_URL=https:\/\/postiz\.13\.60\.253\.82\.sslip\.io/);
});

test("onboarding completion is persisted and the wizard exposes Step 4", async () => {
  const onboarding = await read("apps/dashboard/lib/server/onboarding.ts");
  const wizard = await read("apps/dashboard/components/onboarding-wizard.tsx");
  assert.match(onboarding, /onboarding_completed_at = CASE/);
  assert.match(onboarding, /COALESCE\(onboarding_completed_at, now\(\)\)/);
  assert.match(onboarding, /record\.complete !== true/);
  assert.match(wizard, /type Step = 1 \| 2 \| 3 \| 4/);
  assert.match(wizard, /JSON\.stringify\(\{ complete: true \}\)/);
  assert.match(wizard, /copy\.readyTitle/);
});

test("deploy supports the ubuntu docker-group operator and requires auth_internal_token", async () => {
  const deploy = await read("deployment/dashboard-demo/scripts/deploy.sh");
  assert.doesNotMatch(deploy, /test "\$\(id -u\)" = 0/);
  assert.match(deploy, /DEMO_DEPLOY_DOCKER_ACCESS_REQUIRED/);
  assert.match(deploy, /DEMO_DEPLOY_SECRETS_NOT_WRITABLE/);
  assert.match(deploy, /required_secrets="[^"]*auth_internal_token/);
});

test("Postiz maps X and Twitter channel identifiers", async () => {
  const mappings = await read("apps/dashboard/lib/server/integration-management.ts");
  assert.match(mappings, /x: "x", twitter: "x"/);
});
