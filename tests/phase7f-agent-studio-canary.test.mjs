import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Phase 7F canary is exact, bilingual, simulation-only and independently restorable", async () => {
  const [common, preflight, run, restore, operator, workflow, runbook, stateVerification] = await Promise.all([
    read("deployment/phase7f-agent-studio-canary/scripts/common.sh"),
    read("deployment/phase7f-agent-studio-canary/scripts/preflight.sh"),
    read("deployment/phase7f-agent-studio-canary/scripts/run-canary.sh"),
    read("deployment/phase7f-agent-studio-canary/scripts/restore-locks.sh"),
    read("deployment/phase7f-agent-studio-canary/scripts/canary-operator.mjs"),
    read("deployment/phase7f-agent-studio-canary/scripts/workflow-contract.mjs"),
    read("deployment/phase7f-agent-studio-canary/RUNBOOK.md"),
    read("deployment/phase7f-agent-studio-canary/scripts/test-state-verification.sh"),
  ]);

  assert.match(common, /0032_gemma_served_model_profile/);
  assert.match(common, /TANAGHOM_CANARY_RUNTIME_PROFILE_ID/);
  assert.match(common, /GO-RUN-SIMULATION-ONLY-AGENT-CANARY/);
  assert.match(common, /n8n execute --id="\$RUNNER_ID"/);
  assert.match(common, /assert_canary_credential_bindings/);
  assert.match(common, /stored\.name=bindings\.binding_name/);
  assert.match(common, /stored\.type=bindings\.credential_type/);
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
  assert.match(operator, /gemma4-26b-a4b-canary/);
  assert.match(operator, /'canary_id',\$1::text/);
  assert.match(operator, /job\.input->>'canary_id'=\$1::text/);

  assert.match(workflow, /phase7dPolicyResolvedAgentRunnerV1/);
  assert.match(workflow, /phase7dSimulationDispatcherV1/);
  assert.match(workflow, /resolved-by-reviewed-name-and-type/);
  assert.match(workflow, /normalizedNodes/);
  assert.match(workflow, /workflow\.active !== false/);
  assert.match(workflow, /has an enabled schedule/);
  assert.match(workflow, /postiz/);
  assert.match(workflow, /gohighlevel/);
  assert.match(runbook, /one English and one Arabic/);
  assert.match(runbook, /not full certification/i);
  assert.match(runbook, /other twelve mandatory adversarial\s+scenarios/i);
  assert.match(runbook, /No service, container, firewall, Nginx configuration or protected project\s+file is restarted, recreated or edited/);
  assert.match(stateVerification, /compares current evidence with the original reviewed snapshot/);
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
  assert.match(validation, /test-state-verification\.sh/);
});

test("Phase 7F workflow contract accepts import-resolved credential IDs but rejects a changed binding name", async () => {
  const repository = fileURLToPath(root);
  const sourceDirectory = join(repository, "n8n", "workflows", "phase7d");
  const script = join(
    repository,
    "deployment",
    "phase7f-agent-studio-canary",
    "scripts",
    "workflow-contract.mjs",
  );
  const temporary = await mkdtemp(join(tmpdir(), "tanaghom-phase7f-contract-"));
  try {
    const runner = JSON.parse(await readFile(
      join(sourceDirectory, "policy-resolved-agent-runner.v1.json"),
      "utf8",
    ));
    const dispatcher = JSON.parse(await readFile(
      join(sourceDirectory, "simulation-dispatcher.v1.json"),
      "utf8",
    ));
    const gemmaBinding = runner.nodes
      .find((node) => node.name === "Call Gemma Strict Planner")
      .credentials.httpHeaderAuth;
    gemmaBinding.id = "62000000-0000-4000-8000-000000000002";
    const exportPath = join(temporary, "current.json");
    await writeFile(exportPath, JSON.stringify([runner, dispatcher]));

    const accepted = spawnSync(
      process.execPath,
      [script, "prepare", exportPath, sourceDirectory, temporary],
      { encoding: "utf8" },
    );
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /match reviewed operational hashes/);

    gemmaBinding.name = "Unreviewed Gemma Credential";
    await writeFile(exportPath, JSON.stringify([runner, dispatcher]));
    const rejected = spawnSync(
      process.execPath,
      [script, "prepare", exportPath, sourceDirectory, temporary],
      { encoding: "utf8" },
    );
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /differs from the reviewed repository export/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
