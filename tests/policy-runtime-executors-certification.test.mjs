import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const sha256 = (content) => createHash("sha256").update(content).digest("hex");

const workflows = [
  {
    path: "n8n/workflows/phase7d/read-executor.v1.json",
    id: "phase7dReadExecutorV1",
    claim: "claim_agent_read_invocation",
    credential: "Tanaghom Skill Read Executor PostgreSQL",
    adapter: "phase7d_read_executor_v1",
  },
  {
    path: "n8n/workflows/phase7d/proposal-executor.v1.json",
    id: "phase7dProposalExecutorV1",
    claim: "claim_agent_proposal_invocation",
    credential: "Tanaghom Skill Proposal Executor PostgreSQL",
    adapter: "phase7d_proposal_executor_v1",
  },
  {
    path: "n8n/workflows/phase7d/action-executor.v1.json",
    id: "phase7dActionExecutorV1",
    claim: "claim_agent_action_invocation",
    credential: "Tanaghom Skill Action Executor PostgreSQL",
    adapter: "phase7d_action_executor_v1",
  },
  {
    path: "n8n/workflows/phase7d/runtime-finalizer.v1.json",
    id: "phase7dRuntimeFinalizerV1",
    claim: "settle_next_agent_runtime_run",
    credential: "Tanaghom Agent Runtime PostgreSQL",
    adapter: null,
  },
];

test("Phase 7D executor exports are fixed, inactive, and credential-separated", async () => {
  const migration = await read(
    "packages/database/migrations/0031_policy_runtime_executors_certification.up.sql",
  );
  const generator = await read("scripts/generate-phase7d-executor-workflows.mjs");
  const registry = JSON.parse(await read("config/skill-registry.v1.json"));
  const coveredExecutors = new Set();

  for (const expected of workflows) {
    const source = await read(expected.path);
    const workflow = JSON.parse(source);
    assert.equal(workflow.id, expected.id);
    assert.equal(workflow.active, false);
    assert.equal(workflow.settings.saveDataErrorExecution, "none");
    assert.equal(workflow.settings.saveDataSuccessExecution, "none");
    assert.equal(workflow.settings.saveManualExecutions, false);
    assert.ok(workflow.settings.executionTimeout <= 240);

    const schedule = workflow.nodes.find(
      (node) => node.type === "n8n-nodes-base.scheduleTrigger",
    );
    assert.equal(schedule.disabled, true);
    assert.match(
      JSON.stringify(workflow),
      new RegExp(expected.claim),
    );
    assert.match(JSON.stringify(workflow), new RegExp(expected.credential));

    for (const node of workflow.nodes) {
      assert.doesNotMatch(node.type, /executeCommand|ssh|readWriteFile/i);
    }
    assert.doesNotMatch(source, /workflowId"\s*:\s*"=\{\{/);
    for (const httpNode of workflow.nodes.filter(
      (node) => node.type === "n8n-nodes-base.httpRequest",
    )) {
      assert.ok(
        httpNode.parameters.url
          === "https://api.thesmartlabs.net/gemma4/v1/chat/completions"
        || httpNode.parameters.url
          === "={{ $env.TANAGHOM_INTEGRATION_GATEWAY_URL + '/api/internal/agent-runtime/provider' }}",
        `unreviewed HTTP target in ${expected.path}`,
      );
    }

    if (expected.adapter) {
      assert.match(migration, new RegExp(`${expected.adapter}[\\s\\S]{0,500}${sha256(source)}`));
    }
    for (const skill of registry.skills) {
      if (source.includes(skill.version.executor.ref)) {
        coveredExecutors.add(skill.version.executor.ref);
      }
    }
  }

  assert.deepEqual(
    [...coveredExecutors].sort(),
    registry.skills.map((skill) => skill.version.executor.ref).sort(),
  );
  assert.match(generator, /TANAGHOM_INTEGRATION_GATEWAY_URL/);
  assert.match(generator, /phase7\.agent-provider-dispatch\.v1/);
  assert.match(generator, /credential-shaped/i);
  assert.match(generator, /7d000000-0000-4000-8000-000000000101/);
  assert.match(generator, /62000000-0000-4000-8000-000000000002/);
  assert.match(generator, /62000000-0000-4000-8000-000000000004/);
  assert.doesNotMatch(generator, /000000000304|000000000305|000000000306/);
  assert.doesNotMatch(generator, /arbitrary_url|tool_url/i);
});

test("Phase 7D adapter migration pins authority and canonical certification", async () => {
  const up = await read(
    "packages/database/migrations/0031_policy_runtime_executors_certification.up.sql",
  );
  const down = await read(
    "packages/database/migrations/0031_policy_runtime_executors_certification.down.sql",
  );

  assert.match(up, /CREATE TABLE tanaghom\.agent_runtime_executor_adapters/);
  assert.match(up, /CREATE TABLE tanaghom\.agent_runtime_executor_adapter_events/);
  assert.match(up, /reviewed executor adapter identity and authority are immutable/);
  assert.match(up, /invocation\.executor_ref=ANY\(v_adapter\.supported_executor_refs\)/);
  assert.match(up, /invocation\.operation=ANY\(v_adapter\.supported_operations\)/);
  assert.match(up, /provider dispatch already started; reconcile the outcome/);
  assert.match(up, /exact connected provider binding is unavailable/);
  assert.match(up, /provider_dispatch_started/);
  assert.match(up, /record_agent_runtime_certification_v2/);
  assert.match(up, /v_expected_count := cardinality\(v_version\.languages\)\*7/);
  assert.match(up, /external_action_count/);
  assert.match(up, /actual_cost<>0/);
  assert.match(up, /REVOKE EXECUTE ON FUNCTION tanaghom\.record_agent_runtime_certification\(/);
  assert.doesNotMatch(
    up,
    /GRANT EXECUTE ON FUNCTION tanaghom\.set_agent_runtime_executor_adapter[\s\S]*TO tanaghom_/,
  );
  assert.match(down, /rollback refused because adapter lifecycle, provider-dispatch, or certification evidence exists/);
  assert.match(down, /0031_policy_runtime_executors_certification/);
});

test("Agent Studio provider gateway is authenticated, fail-closed, and fixed-operation", async () => {
  const route = await read("apps/dashboard/app/api/internal/agent-runtime/provider/route.ts");
  const env = await read(".env.example");

  assert.match(env, /AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED=false/);
  assert.match(route, /INTEGRATION_WORKER_TOKEN/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED !== "true"/);
  assert.match(route, /begin_agent_runtime_provider_dispatch/);
  assert.match(route, /phase7\.agent-provider-dispatch\.v1/);
  assert.match(route, /postiz\.draft\.create/);
  assert.match(route, /postiz\.performance\.read/);
  assert.match(route, /ghl\.contact\.upsert/);
  assert.match(route, /agent_runtime_provider_operation_not_reviewed/);
  assert.match(route, /dispatch_started: started/);
  assert.doesNotMatch(route, /requestBody\.url|parameters\.url|fetch\(parameters/);
  assert.doesNotMatch(route, /responseBody[\s\S]{0,1200}credential_(?:ciphertext|nonce|auth_tag)/);
});
