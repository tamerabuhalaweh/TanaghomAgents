import assert from "node:assert/strict";
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
    lifecycle,
    sharedCommon,
  ] = await Promise.all([
    read("RUNBOOK.md"),
    read("scripts/common.sh"),
    read("scripts/preflight.sh"),
    read("scripts/deploy-update.sh"),
    read("scripts/rollback-update.sh"),
    read("scripts/validate-release.sh"),
    read("scripts/validate-package.sh"),
    read("scripts/test-disposable-lifecycle.sh"),
    readFile(new URL("deployment/phase7b-skill-library/scripts/common.sh", root), "utf8"),
  ]);

  assert.match(runbook, /No deployment is authorized by this document/);
  assert.match(runbook, /applies only `0029_organization_agent_studio`/);
  assert.match(runbook, /Never truncate customer records/);
  assert.match(common, /EXPECTED_START_MIGRATION=0028_strategy_cadence_integrity/);
  assert.match(common, /TARGET_MIGRATION=0029_organization_agent_studio/);
  assert.match(common, /phase7b-skill-library\/scripts\/common\.sh/);
  assert.match(sharedCommon, /PROTECTED_N8N_CONTAINERS/);
  assert.match(common, /has_table_privilege\('tanaghom_n8n_worker'/);
  assert.match(preflight, /database is not at migration 0028/);
  assert.match(preflight, /api\/admin\/agents/);
  assert.match(deploy, /compose up -d --no-deps dashboard/);
  assert.match(deploy, /automatic_rollback/);
  assert.doesNotMatch(deploy, /n8n.*(?:up|restart|stop|rm)/i);
  assert.match(rollback, /rollback refused because organization Agent Studio data exists/);
  assert.match(rollback, /force-recreate --no-build dashboard/);
  assert.match(release, /assert_agent_studio_empty/);
  assert.match(release, /firewall state changed/);
  assert.match(release, /settings\/agents/);
  assert.match(packageValidation, /sh -n/);
  assert.match(lifecycle, /0029 rollback unexpectedly deleted organization agent data/);
  assert.match(lifecycle, /TRUNCATE tanaghom\.organization_agent_audit_events/);
  assert.match(lifecycle, /0028_strategy_cadence_integrity/);
});
