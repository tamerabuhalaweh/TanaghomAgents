import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(
  root,
  "deployment",
  "phase7ab-skill-library-production-update",
);

const read = (relativePath) =>
  fs.readFileSync(path.join(packageRoot, relativePath), "utf8");

test("Phase 7AB production update is exact, reversible, dashboard-only, and protected-service scoped", () => {
  const common = read("scripts/common.sh");
  const preflight = read("scripts/preflight.sh");
  const deploy = read("scripts/deploy-update.sh");
  const validate = read("scripts/validate-release.sh");
  const rollback = read("scripts/rollback-update.sh");
  const lifecycle = read("scripts/test-disposable-lifecycle.sh");
  const runbook = read("RUNBOOK.md");

  assert.match(common, /EXPECTED_START_MIGRATION=0025_runtime_agent_reconciliation/);
  assert.match(common, /TARGET_MIGRATION=0027_governed_skill_library/);
  assert.match(
    common,
    /PENDING_MIGRATIONS='0026_skill_registry 0027_governed_skill_library'/,
  );
  assert.match(common, /assert_platform_skill_registry_exact/);
  assert.match(common, /assert_skill_registry_safe_to_drop/);
  assert.match(common, /ALLOWED_PRODUCTION_CHANGE=/);
  assert.match(preflight, /merge-base --is-ancestor/);
  assert.match(preflight, /diff --name-only/);
  assert.match(deploy, /rollback_applied_migrations/);
  assert.match(deploy, /fetch --no-tags origin main/);
  assert.match(deploy, /rev-parse FETCH_HEAD/);
  assert.match(deploy, /compose build --pull dashboard/);
  assert.match(deploy, /compose up -d --no-deps dashboard/);
  assert.doesNotMatch(deploy, /compose (?:build|up).*(?:smartlabs|n8n|gemma|voice)/i);
  assert.match(validate, /assert_protected_container_ids_unchanged/);
  assert.match(validate, /assert_public_target_boundary/);
  assert.match(rollback, /ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE/);
  assert.match(rollback, /assert_skill_registry_safe_to_drop/);
  assert.match(
    lifecycle,
    /0027 rollback unexpectedly deleted customer Skill Library data/,
  );
  assert.match(
    lifecycle,
    /0026 rollback unexpectedly deleted changed platform Skill Registry data/,
  );
  assert.match(runbook, /No deployment is authorized by this document/);
  assert.match(runbook, /No off-server backup is required/);

  for (const file of [
    common,
    preflight,
    deploy,
    validate,
    rollback,
    lifecycle,
  ]) {
    assert.doesNotMatch(
      file,
      /systemctl (?:stop|restart|reload).*(?:smartlabs|convai|gemma|smartcc)/i,
    );
    assert.doesNotMatch(
      file,
      /docker (?:stop|restart|rm).*(?:smartlabs|n8n|gemma|voice)/i,
    );
    assert.doesNotMatch(file, /\/opt\/(?:smartlabs|n8n-smartlabs)|\/data\//i);
  }
});
