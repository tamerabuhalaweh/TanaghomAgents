import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Phase 7F served-model update is database-only, transactional and fail-closed", async () => {
  const [common, preflight, deploy, rollback, runbook, validate, stateCapture] = await Promise.all([
    read("deployment/phase7f-runtime-profile-production-update/scripts/common.sh"),
    read("deployment/phase7f-runtime-profile-production-update/scripts/preflight.sh"),
    read("deployment/phase7f-runtime-profile-production-update/scripts/deploy-update.sh"),
    read("deployment/phase7f-runtime-profile-production-update/scripts/rollback-update.sh"),
    read("deployment/phase7f-runtime-profile-production-update/RUNBOOK.md"),
    read("deployment/phase7f-runtime-profile-production-update/scripts/validate-package.sh"),
    read("deployment/phase7f-runtime-profile-production-update/scripts/test-state-capture.sh"),
  ]);

  assert.match(common, /0031_policy_runtime_executors_certification/);
  assert.match(common, /0032_gemma_served_model_profile/);
  assert.match(common, /gemma4-26b-a4b-canary/);
  assert.match(common, /unfinished shared-runtime jobs require reconciliation/);
  assert.match(preflight, /assert_runtime_quiescent/);
  assert.match(preflight, /no state was changed/);
  assert.match(deploy, /automatic_rollback/);
  assert.match(deploy, /db_file "\$MIGRATION_UP"/);
  assert.match(deploy, /assert_profile_release_state_unchanged/);
  assert.match(rollback, /durable runtime evidence references the profile/);
  assert.match(rollback, /db_file "\$MIGRATION_DOWN"/);
  assert.match(runbook, /phase7f-canary-20260727T090404Z/);
  assert.match(runbook, /provider adapters remain disabled/);
  assert.match(validate, /database-only package contains a service, workflow or image mutation/);
  assert.match(validate, /test-state-capture\.sh/);
  assert.match(stateCapture, /nested state-capture helpers preserve the caller evidence prefix/);
  for (const source of [deploy, rollback]) {
    assert.doesNotMatch(source, /compose (?:build|up|down)/);
    assert.doesNotMatch(source, /systemctl (?:stop|restart|reload)/);
    assert.doesNotMatch(source, /n8n (?:import|publish|unpublish)/);
  }
});
