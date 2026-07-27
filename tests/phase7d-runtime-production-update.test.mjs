import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const packageRoot = new URL(
  "deployment/phase7d-runtime-production-update/",
  root,
);
const read = (path) => readFile(new URL(path, packageRoot), "utf8");

test("Phase 7D production package is exact, inactive, least privilege, and reverses only its own state", async () => {
  const [
    runbook,
    common,
    preflight,
    deploy,
    rollback,
    release,
    packageValidation,
    databaseLifecycle,
    n8nLifecycle,
    credentialBuilder,
    compose,
    quality,
  ] = await Promise.all([
    read("RUNBOOK.md"),
    read("scripts/common.sh"),
    read("scripts/preflight.sh"),
    read("scripts/deploy-update.sh"),
    read("scripts/rollback-update.sh"),
    read("scripts/validate-release.sh"),
    read("scripts/validate-package.sh"),
    read("scripts/test-disposable-lifecycle.sh"),
    read("scripts/test-disposable-n8n-lifecycle.sh"),
    read("scripts/build-credential-package.py"),
    readFile(
      new URL("deployment/dashboard-canary/docker-compose.yml", root),
      "utf8",
    ),
    readFile(new URL(".github/workflows/quality.yml", root), "utf8"),
  ]);

  assert.match(runbook, /No deployment is authorized by this package/);
  assert.match(runbook, /0030_policy_resolved_agent_runtime/);
  assert.match(runbook, /0031_policy_runtime_executors_certification/);
  assert.match(runbook, /four generated PostgreSQL login identities/);
  assert.match(runbook, /six workflows/);
  assert.match(
    runbook,
    /Adapters, schedules, provider execution and runtime claims remain disabled/,
  );
  assert.match(common, /EXPECTED_START_MIGRATION=0029_organization_agent_studio/);
  assert.match(
    common,
    /PENDING_MIGRATIONS='0030_policy_resolved_agent_runtime 0031_policy_runtime_executors_certification'/,
  );
  assert.match(common, /phase7dPolicyResolvedAgentRunnerV1/);
  assert.match(common, /phase7dSimulationDispatcherV1/);
  assert.match(common, /phase7dReadExecutorV1/);
  assert.match(common, /phase7dProposalExecutorV1/);
  assert.match(common, /phase7dActionExecutorV1/);
  assert.match(common, /phase7dRuntimeFinalizerV1/);
  assert.match(common, /assert_login_roles_least_privilege/);
  assert.match(common, /legacy n8n worker can claim shared runtime work/);
  assert.match(common, /runtime_evidence_count/);
  assert.match(common, /operator_ref<>'migration_0031'/);
  assert.match(common, /operator_ref='migration_0031'/);
  assert.match(common, /assert_running_gateway_locked/);
  assert.match(common, /authenticated Phase 7D gateway is not fail-closed/);
  assert.match(preflight, /assert_package_workflows_absent/);
  assert.match(preflight, /assert_package_credentials_absent/);
  assert.match(preflight, /assert_shared_credentials/);
  assert.match(preflight, /N8N_EXPECTED_VERSION/);
  assert.match(deploy, /automatic_rollback/);
  assert.match(deploy, /compose build --pull dashboard/);
  assert.match(deploy, /compose up -d --no-deps dashboard/);
  assert.match(deploy, /n8n import:credentials/);
  assert.match(deploy, /n8n import:workflow --input="\$remote" --activeState=false/);
  assert.match(deploy, /n8n audit/);
  assert.doesNotMatch(deploy, /docker (?:stop|restart|rm).*n8n/i);
  assert.doesNotMatch(deploy, /systemctl (?:stop|restart|reload)/);
  assert.match(rollback, /ROLLBACK-LOCKED-PHASE7D-RUNTIME/);
  assert.match(rollback, /test "\$\(runtime_evidence_count\)" = 0/);
  assert.match(rollback, /delete_package_workflows/);
  assert.match(rollback, /delete_package_credentials/);
  assert.match(rollback, /drop_login_roles/);
  assert.match(release, /assert_package_workflows_inactive/);
  assert.match(release, /assert_package_credentials_encrypted/);
  assert.match(release, /assert_n8n_ids_unchanged/);
  assert.match(packageValidation, /sh -n/);
  assert.match(databaseLifecycle, /rolls back exactly to 0029/);
  assert.match(databaseLifecycle, /tanaghom_phase7d_action_login/);
  assert.match(n8nLifecycle, /SELECT count\(\*\) FROM workflow_entity;/);
  assert.match(n8nLifecycle, /SELECT count\(\*\) FROM execution_entity;/);
  assert.match(n8nLifecycle, /n8n audit/);
  assert.match(credentialBuilder, /secrets\.token_hex\(32\)/);
  assert.match(credentialBuilder, /os\.chmod\(path, 0o600\)/);
  assert.doesNotMatch(
    credentialBuilder,
    /postgresql:\/\/|api[_-]?key|bearer\s+[a-z0-9]/i,
  );
  assert.match(
    compose,
    /AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED:\s*"false"/,
  );
  assert.match(quality, /phase7d-runtime-production-update-contract:/);
  assert.match(
    quality,
    /phase7d-runtime-production-update\/scripts\/test-disposable-n8n-lifecycle\.sh/,
  );

  for (const path of [
    "scripts/common.sh",
    "scripts/preflight.sh",
    "scripts/deploy-update.sh",
    "scripts/rollback-update.sh",
    "scripts/validate-release.sh",
    "scripts/validate-package.sh",
    "scripts/test-disposable-lifecycle.sh",
    "scripts/test-disposable-n8n-lifecycle.sh",
    "scripts/build-credential-package.py",
  ]) {
    const output = execFileSync(
      "git",
      [
        "ls-files",
        "--stage",
        `deployment/phase7d-runtime-production-update/${path}`,
      ],
      { encoding: "utf8" },
    );
    assert.match(output, /^100755 /, `${path} must be executable in Git`);
  }
});
