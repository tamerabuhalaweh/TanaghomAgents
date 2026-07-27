import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Phase 7D planner and result contracts are strict, bounded, and bilingual", async () => {
  const planSchema = JSON.parse(await read(
    "packages/contracts/schemas/phase7/agent-runtime-plan.v1.schema.json",
  ));
  const resultSchema = JSON.parse(await read(
    "packages/contracts/schemas/phase7/agent-runtime-result.v1.schema.json",
  ));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validatePlan = ajv.compile(planSchema);
  const validateResult = ajv.compile(resultSchema);

  for (const [language, summary] of [
    ["en", "Prepare a bounded strategy proposal."],
    ["ar", "إعداد مقترح استراتيجية مضبوط."],
  ]) {
    const plan = {
      contract_version: "phase7.agent-runtime-plan.v1",
      agent_version_id: "7d000000-0000-4000-8000-000000000001",
      agent_content_hash: `sha256:${"a".repeat(64)}`,
      language,
      intent_summary: summary,
      steps: [{
        sequence: 1,
        skill_code: "create_campaign_strategy",
        operation: "campaign.strategy.propose",
        channel: null,
        consent_evidence: "not_required",
        arguments_json: JSON.stringify({ record_type: "campaign", language }),
        idempotency_key: `phase7d:${language}:strategy:1`,
        rationale: "The assigned proposal skill matches the bounded request.",
      }],
      final_response_mode: "result_summary",
    };
    assert.equal(validatePlan(plan), true, JSON.stringify(validatePlan.errors));
  }

  const result = {
    contract_version: "phase7.agent-runtime-result.v1",
    invocation_id: "7d000000-0000-4000-8000-000000000002",
    outcome: "succeeded",
    output_json: JSON.stringify({ external_action_count: 0 }),
    provider_reference: null,
    prompt_tokens: 10,
    completion_tokens: 5,
    actual_cost: 0,
    error_code: null,
  };
  assert.equal(validateResult(result), true, JSON.stringify(validateResult.errors));

  const unknownField = {
    ...JSON.parse(JSON.stringify({
      contract_version: "phase7.agent-runtime-plan.v1",
      agent_version_id: "7d000000-0000-4000-8000-000000000001",
      agent_content_hash: `sha256:${"a".repeat(64)}`,
      language: "en",
      intent_summary: "Reject an unknown planner field.",
      steps: [{
        sequence: 1,
        skill_code: "create_campaign_strategy",
        operation: "campaign.strategy.propose",
        channel: null,
        consent_evidence: "not_required",
        arguments_json: "{}",
        idempotency_key: "phase7d:unknown:1",
        rationale: "This shape must remain exact.",
      }],
      final_response_mode: "refusal",
    })),
    arbitrary_tool_url: "https://unreviewed.invalid",
  };
  assert.equal(validatePlan(unknownField), false);
  unknownField.steps[0].arguments_json = { arbitrary: "object" };
  delete unknownField.arbitrary_tool_url;
  assert.equal(validatePlan(unknownField), false);
});

test("Phase 7D database runtime is tenant-bound, server-authorized, and least privilege", async () => {
  const up = await read("packages/database/migrations/0030_policy_resolved_agent_runtime.up.sql");
  const down = await read("packages/database/migrations/0030_policy_resolved_agent_runtime.down.sql");
  const databaseTest = await read("packages/database/tests/policy_resolved_agent_runtime.sql");
  const databaseHarness = await read("scripts/database-test.mjs");

  for (const role of [
    "tanaghom_agent_runtime",
    "tanaghom_skill_read_executor",
    "tanaghom_skill_proposal_executor",
    "tanaghom_skill_action_executor",
  ]) {
    assert.match(up, new RegExp(`CREATE ROLE ${role}\\s+NOLOGIN`));
    assert.match(down, new RegExp(`DROP ROLE ${role}`));
  }
  for (const table of [
    "organization_agent_jobs",
    "organization_agent_runs",
    "organization_agent_invocations",
    "organization_agent_invocation_approvals",
    "organization_agent_dependency_blocks",
    "organization_agent_runtime_events",
  ]) {
    assert.match(up, new RegExp(`CREATE TABLE tanaghom\\.${table}`));
    assert.match(down, new RegExp(`DROP TABLE tanaghom\\.${table}`));
  }

  assert.match(up, /model_output_is_authority',false/);
  assert.match(up, /arbitrary_code_allowed',false/);
  assert.match(up, /arbitrary_url_allowed',false/);
  assert.match(up, /agent_runtime_sha256\(v_parameters\)/);
  assert.match(up, /agent_runtime_result_is_valid/);
  assert.match(up, /parameter_bound_approval/);
  assert.match(up, /phase7\.agent-handoff\.v1/);
  assert.match(up, /queue_organization_agent_handoff/);
  assert.match(up, /server-attested agent handoff/);
  assert.match(up, /runtime_emergency_stop/);
  assert.match(up, /outside_business_hours/);
  assert.match(up, /follow_up_limit_exceeded/);
  assert.match(up, /pg_advisory_xact_lock/);
  assert.match(up, /organization_agent_dependency_blocks[\s\S]*status='active'/);
  assert.match(up, /FOR UPDATE OF job SKIP LOCKED/);
  assert.match(up, /skill_not_assigned_or_not_executable/);
  assert.match(up, /indeterminate/);
  const n8nRuntimeGrants = up
    .split(";")
    .filter((statement) => /GRANT EXECUTE/.test(statement) && /TO tanaghom_n8n_worker/.test(statement));
  assert.equal(n8nRuntimeGrants.length, 0);
  assert.match(down, /cannot roll back 0030 while durable agent runtime evidence exists/);
  assert.match(databaseTest, /two tenants used one shared runtime/);
  assert.match(databaseTest, /cross-tenant agent job unexpectedly queued/);
  assert.match(databaseTest, /human\/API path unexpectedly forged an agent handoff/);
  assert.match(databaseTest, /invocation retry duplicated a logical operation/);
  assert.match(databaseTest, /active indeterminate-provider block did not stop tenant claims/);
  assert.match(databaseTest, /retry backoff did not prevent an immediate duplicate claim/);
  assert.match(databaseTest, /accepted job did not recover through a second durable run/);
  assert.match(databaseTest, /retired agent unexpectedly claimed new work/);
  assert.match(databaseTest, /mismatched executor result envelope unexpectedly completed/);
  assert.match(databaseTest, /legacy n8n role unexpectedly claimed shared-runtime work/);
  assert.match(databaseHarness, /policy_resolved_agent_runtime\.sql/);
  assert.match(databaseHarness, /0030 rollback left shared runtime state behind/);
});

test("Phase 7D n8n exports are inactive, fixed-target, parameterized, and retention-safe", async () => {
  const generator = await read("scripts/generate-phase7d-workflows.mjs");
  const runner = JSON.parse(await read(
    "n8n/workflows/phase7d/policy-resolved-agent-runner.v1.json",
  ));
  const simulation = JSON.parse(await read(
    "n8n/workflows/phase7d/simulation-dispatcher.v1.json",
  ));

  for (const workflow of [runner, simulation]) {
    assert.equal(workflow.active, false);
    assert.equal(workflow.settings.saveDataErrorExecution, "none");
    assert.equal(workflow.settings.saveDataSuccessExecution, "none");
    assert.equal(workflow.settings.saveManualExecutions, false);
    assert.ok(workflow.settings.executionTimeout <= 240);
    for (const node of workflow.nodes) {
      assert.doesNotMatch(node.type, /executeCommand|ssh|readWriteFile/i);
    }
  }
  const schedule = runner.nodes.find((node) => node.type === "n8n-nodes-base.scheduleTrigger");
  assert.equal(schedule.disabled, true);
  const subworkflow = runner.nodes.find((node) => node.type === "n8n-nodes-base.executeWorkflow");
  assert.equal(subworkflow.parameters.workflowId.value, "phase7dSimulationDispatcherV1");
  assert.equal(subworkflow.parameters.mode, "each");
  assert.equal(simulation.nodes[0].type, "n8n-nodes-base.executeWorkflowTrigger");

  const postgresQueries = [...runner.nodes, ...simulation.nodes]
    .filter((node) => node.type === "n8n-nodes-base.postgres")
    .map((node) => node.parameters.query);
  assert.ok(postgresQueries.every((query) => /\$1/.test(query)));
  assert.match(generator, /Server-Authorize Every Invocation/);
  assert.match(generator, /Planner attempted to emit credential-shaped content/);
  assert.doesNotMatch(generator, /Tanaghom Simulation Executor PostgreSQL/);
  assert.doesNotMatch(generator, /7d000000-0000-4000-8000-000000000102/);
  assert.match(generator, /unsupportedGuidedKeywords/);
  const requestBuilder = runner.nodes.find(
    (node) => node.name === "Build Policy-Resolved Planner Request",
  );
  assert.doesNotMatch(requestBuilder.parameters.jsCode, /"format":"uuid"/);
  assert.doesNotMatch(requestBuilder.parameters.jsCode, /"minProperties"/);
  assert.doesNotMatch(generator, /workflowId:\s*=\{\{/);
});

test("Phase 7D prompt preserves the full instruction hierarchy and progressive disclosure", async () => {
  const prompt = await read("prompts/policy-resolved-agent/v1.md");
  assert.match(prompt, /platform safety/i);
  assert.match(prompt, /organization policy/i);
  assert.match(prompt, /agent version/i);
  assert.match(prompt, /assigned-skill catalog/i);
  assert.match(prompt, /untrusted/i);
  assert.match(prompt, /never\s+authorize/i);
  assert.match(prompt, /Never invent a skill/i);
  assert.match(prompt, /arguments_json/i);
});
