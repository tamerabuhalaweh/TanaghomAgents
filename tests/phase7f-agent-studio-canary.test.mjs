import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Phase 7F canary is exact, bilingual, simulation-only and independently restorable", async () => {
  const [common, preflight, run, restore, operator, workflow, runbook] = await Promise.all([
    read("deployment/phase7f-agent-studio-canary/scripts/common.sh"),
    read("deployment/phase7f-agent-studio-canary/scripts/preflight.sh"),
    read("deployment/phase7f-agent-studio-canary/scripts/run-canary.sh"),
    read("deployment/phase7f-agent-studio-canary/scripts/restore-locks.sh"),
    read("deployment/phase7f-agent-studio-canary/scripts/canary-operator.mjs"),
    read("deployment/phase7f-agent-studio-canary/scripts/workflow-contract.mjs"),
    read("deployment/phase7f-agent-studio-canary/RUNBOOK.md"),
  ]);

  assert.match(common, /0031_policy_runtime_executors_certification/);
  assert.match(common, /GO-RUN-SIMULATION-ONLY-AGENT-CANARY/);
  assert.match(common, /n8n execute --id="\$RUNNER_ID"/);
  assert.doesNotMatch(common, /publish:workflow|unpublish:workflow/);
  assert.match(preflight, /operator check-database/);
  assert.match(preflight, /workflow-contract\.mjs" prepare/);
  assert.match(run, /trap cleanup EXIT HUP INT TERM/);
  assert.match(run, /operator unlock/);
  assert.match(run, /operator lock "\$reason"/);
  assert.equal((run.match(/execute_runner_once/g) || []).length, 1);
  assert.match(run, /for sequence in 1 2/);
  assert.match(run, /operator finalize-next/);
  assert.match(run, /operator verify/);
  assert.match(run, /n8n audit/);
  assert.match(restore, /operator quarantine/);

  assert.match(operator, /scenario_kind='success'/);
  assert.match(operator, /language === "ar"/);
  assert.match(operator, /simulation_only=false/);
  assert.match(operator, /provider_dispatch_id IS NOT NULL/);
  assert.match(operator, /provider_reference IS NOT NULL/);
  assert.doesNotMatch(operator, /provider_reference=NULL/);
  assert.match(operator, /unsafe_evidence_preserved_for_incident_review/);
  assert.match(operator, /phase7f-canary-restore/);
  assert.match(operator, /actual_cost/);
  assert.match(operator, /certifications !== 0/);
  assert.match(operator, /state\.lifecycle_state !== "validated"/);
  assert.match(operator, /organization_agent_runtime_certifications/);

  assert.match(workflow, /phase7dPolicyResolvedAgentRunnerV1/);
  assert.match(workflow, /phase7dSimulationDispatcherV1/);
  assert.match(workflow, /workflow\.active !== false/);
  assert.match(workflow, /has an enabled schedule/);
  assert.match(workflow, /postiz/);
  assert.match(workflow, /gohighlevel/);
  assert.match(runbook, /one English and one Arabic/);
  assert.match(runbook, /not full certification/i);
  assert.match(runbook, /other twelve mandatory adversarial\s+scenarios/i);
  assert.match(runbook, /No service, container, firewall, Nginx configuration or protected project\s+file is restarted, recreated or edited/);
});

test("Phase 7F package validation rejects activation, protected-service and secret-shaped operations", async () => {
  const validation = await read(
    "deployment/phase7f-agent-studio-canary/scripts/validate-package.sh",
  );
  assert.match(validation, /n8n \(publish\|unpublish\):workflow/);
  assert.match(validation, /systemctl \(stop\|restart\|reload\)/);
  assert.match(validation, /iptables \(-A\|-I\|-D\|-N\|-F\|-X\)/);
  assert.match(validation, /Bearer/);
  assert.match(validation, /postgresql:\/\//);
  assert.match(validation, /test-refusal-paths\.sh/);
  assert.match(validation, /test-disposable-lifecycle\.sh/);
});
