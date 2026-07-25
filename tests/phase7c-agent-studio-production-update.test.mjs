import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const packageRoot = new URL("deployment/phase7c-agent-studio/", root);
const read = (path) => readFile(new URL(path, packageRoot), "utf8");

test("Phase 7C Agent Studio production update is exact, empty-data reversible, dashboard-only, and protected-service scoped", async () => {
  const [
    runbook,
    common,
    preflight,
    deploy,
    rollback,
    release,
    packageValidation,
    preflightBoundary,
    firewallBoundary,
    lifecycle,
    sharedCommon,
    quality,
  ] = await Promise.all([
    read("RUNBOOK.md"),
    read("scripts/common.sh"),
    read("scripts/preflight.sh"),
    read("scripts/deploy-update.sh"),
    read("scripts/rollback-update.sh"),
    read("scripts/validate-release.sh"),
    read("scripts/validate-package.sh"),
    read("scripts/test-preflight-http-boundary.sh"),
    read("scripts/test-firewall-boundary.sh"),
    read("scripts/test-disposable-lifecycle.sh"),
    readFile(new URL("deployment/phase7b-skill-library/scripts/common.sh", root), "utf8"),
    readFile(new URL(".github/workflows/quality.yml", root), "utf8"),
  ]);

  assert.match(runbook, /No deployment is authorized by this document/);
  assert.match(runbook, /applies only `0029_organization_agent_studio`/);
  assert.match(runbook, /Never truncate customer records/);
  assert.match(common, /EXPECTED_START_MIGRATION=0028_strategy_cadence_integrity/);
  assert.match(common, /TARGET_MIGRATION=0029_organization_agent_studio/);
  assert.match(common, /phase7b-skill-library\/scripts\/common\.sh/);
  assert.match(sharedCommon, /PROTECTED_N8N_CONTAINERS/);
  assert.match(common, /has_table_privilege\('tanaghom_n8n_worker'/);
  assert.match(common, /assert_predeployment_agent_studio_api_status/);
  assert.match(common, /401\|404/);
  assert.match(common, /capture_firewall_boundary/);
  assert.match(common, /iptables -S TANAGHOM_N8N_DB_EGRESS/);
  assert.match(common, /iptables -S TANAGHOM_N8N_DB_INPUT/);
  assert.match(preflight, /database is not at migration 0028/);
  assert.match(preflight, /assert_predeployment_agent_studio_api_status/);
  assert.match(preflight, /assert_firewall_boundary/);
  assert.match(deploy, /compose up -d --no-deps dashboard/);
  assert.match(deploy, /automatic_rollback/);
  assert.match(deploy, /capture_firewall_boundary "\$evidence\/firewall\.before"/);
  assert.doesNotMatch(deploy, /iptables-save/);
  assert.doesNotMatch(deploy, /n8n.*(?:up|restart|stop|rm)/i);
  assert.match(rollback, /rollback refused because organization Agent Studio data exists/);
  assert.match(rollback, /force-recreate --no-build dashboard/);
  assert.match(rollback, /package-owned firewall state changed during rollback/);
  assert.match(release, /assert_agent_studio_empty/);
  assert.match(release, /package-owned firewall state changed/);
  assert.match(release, /assert_firewall_boundary/);
  assert.match(release, /settings\/agents/);
  assert.match(release, /api\/admin\/agents[\s\S]{0,200}= 401/);
  assert.match(packageValidation, /sh -n/);
  assert.match(packageValidation, /test -x/);
  assert.match(preflightBoundary, /for denied in 000 200 302 500/);
  assert.match(firewallBoundary, /package-owned firewall drift was not detected/);
  assert.match(firewallBoundary, /missing firewall hook was not detected/);
  assert.match(lifecycle, /0029 rollback unexpectedly deleted organization agent data/);
  assert.match(lifecycle, /TRUNCATE tanaghom\.organization_agent_audit_events/);
  assert.match(lifecycle, /0028_strategy_cadence_integrity/);
  assert.match(quality, /phase7c-agent-studio-production-update-contract:/);
  assert.match(quality, /phase7c-agent-studio\/scripts\/validate-package\.sh/);
  assert.match(quality, /phase7c-agent-studio\/scripts\/test-preflight-http-boundary\.sh/);
  assert.match(quality, /phase7c-agent-studio\/scripts\/test-disposable-lifecycle\.sh/);

  for (const path of [
    "scripts/common.sh",
    "scripts/deploy-update.sh",
    "scripts/preflight.sh",
    "scripts/rollback-update.sh",
    "scripts/test-disposable-lifecycle.sh",
    "scripts/test-firewall-boundary.sh",
    "scripts/test-preflight-http-boundary.sh",
    "scripts/validate-package.sh",
    "scripts/validate-release.sh",
  ]) {
    const output = execFileSync("git", ["ls-files", "--stage", `deployment/phase7c-agent-studio/${path}`], {
      encoding: "utf8",
    });
    assert.match(output, /^100755 /, `${path} must be executable in Git`);
  }
});
