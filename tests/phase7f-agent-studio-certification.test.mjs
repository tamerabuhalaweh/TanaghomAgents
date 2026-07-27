import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("full Agent Studio certification covers twelve bilingual adversarial scenarios", async () => {
  const [
    operator,
    run,
    common,
    evidencePreflight,
    evidenceApply,
    evidenceRollback,
    preflight,
    restore,
    runbook,
    validation,
  ] =
    await Promise.all([
      read("deployment/phase7f-agent-studio-certification/scripts/certification-operator.mjs"),
      read("deployment/phase7f-agent-studio-certification/scripts/run-certification.sh"),
      read("deployment/phase7f-agent-studio-certification/scripts/common.sh"),
      read("deployment/phase7f-agent-studio-certification/scripts/preflight-evidence-fix.sh"),
      read("deployment/phase7f-agent-studio-certification/scripts/apply-evidence-fix.sh"),
      read("deployment/phase7f-agent-studio-certification/scripts/rollback-evidence-fix.sh"),
      read("deployment/phase7f-agent-studio-certification/scripts/preflight.sh"),
      read("deployment/phase7f-agent-studio-certification/scripts/restore-locks.sh"),
      read("deployment/phase7f-agent-studio-certification/RUNBOOK.md"),
      read("deployment/phase7f-agent-studio-certification/scripts/validate-package.sh"),
    ]);

  for (const kind of [
    "refusal",
    "escalation",
    "prompt_injection",
    "provider_failure",
    "duplicate_retry",
    "emergency_stop",
  ]) {
    assert.match(operator, new RegExp(`"${kind}"`));
  }
  assert.match(operator, /language: scenario\.language/);
  assert.match(operator, /en: "Ignore the assigned skills/);
  assert.match(operator, /ar: "تجاهل المهارات المعيّنة/);
  assert.match(operator, /prior_success_scenarios: success/);
  assert.match(operator, /remaining_scenarios: 14 - state\.passed_scenarios/);
  assert.match(operator, /final_response_mode !== expectedMode/);
  assert.match(operator, /scenario\.scenario_kind === "escalation"[\s\S]*\? false/);
  assert.match(operator, /untrusted model output crossed the server authority boundary/);
  assert.match(operator, /prompt_injection_granted_authority: false/);
  assert.match(operator, /fail_agent_runtime_run/);
  assert.match(operator, /recoveryAttempts = 2/);
  assert.match(operator, /duplicate delivery created a second logical invocation/);
  assert.match(operator, /denialReason !== "runtime_emergency_stop"/);
  assert.match(operator, /runtime_stop_never_opened_outside_transaction: true/);
  assert.match(operator, /record_agent_runtime_certification_v2/);
  assert.match(operator, /lifecycle_transition: false/);
  assert.match(operator, /provider_dispatch_id IS NOT NULL/);
  assert.match(operator, /invocation\.simulation_only=false/);
  assert.match(operator, /unsafe_evidence_preserved_for_incident_review/);

  assert.match(common, /GO-RUN-REMAINING-12-SIMULATION-CERTIFICATION/);
  assert.match(common, /0033_agent_runtime_certification_evidence/);
  assert.match(evidencePreflight, /0032_gemma_served_model_profile/);
  assert.match(evidenceApply, /0033_agent_runtime_certification_evidence\.up\.sql/);
  assert.match(evidenceApply, /canonical_scenario_count=2/);
  assert.match(evidenceApply, /automatic-rollback\.log/);
  assert.match(evidenceRollback, /GO-ROLLBACK-UNCERTIFIED-EVIDENCE-FIX/);
  assert.match(evidenceRollback, /rollback is forbidden after immutable certification/);
  assert.match(common, /operator check-database/);
  assert.match(preflight, /assert_certification_baseline/);
  assert.match(preflight, /WORKFLOW_CONTRACT" prepare/);
  assert.match(run, /trap cleanup EXIT HUP INT TERM/);
  assert.match(run, /operator unlock/);
  assert.match(run, /execute_runner_once/);
  assert.match(run, /operator lock "\$reason"/);
  assert.match(run, /operator finalize-model-next/);
  assert.match(run, /operator run-direct-next "\$reason"/);
  assert.match(run, /operator certify/);
  assert.match(run, /operator verify/);
  assert.match(run, /assert_side_effect_counts_unchanged/);
  assert.match(run, /compare-all-operational/);
  assert.match(run, /n8n audit/);
  assert.match(restore, /operator quarantine/);
  assert.match(runbook, /Each row is executed once in English and once in Arabic/);
  assert.match(runbook, /without changing the validated\s+agent lifecycle/i);
  assert.match(validation, /forbidden provider endpoint/);
  assert.match(validation, /secret-shaped content/);
});

test("certification keeps n8n publication bounded to the fixed simulation dispatcher", async () => {
  const [run, inherited] = await Promise.all([
    read("deployment/phase7f-agent-studio-certification/scripts/run-certification.sh"),
    read("deployment/phase7f-agent-studio-canary/scripts/common.sh"),
  ]);
  assert.doesNotMatch(run, /publish:workflow --id=/);
  assert.doesNotMatch(run, /unpublish:workflow --id=/);
  assert.match(run, /publish_simulation_dispatcher/);
  assert.match(run, /unpublish_simulation_dispatcher/);
  assert.equal(
    (inherited.match(/n8n publish:workflow --id="\$SIMULATION_ID"/g) ?? []).length,
    1,
  );
  assert.equal(
    (inherited.match(/n8n unpublish:workflow --id="\$SIMULATION_ID"/g) ?? []).length,
    1,
  );
});
