import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, "n8n", "workflows", "phase7d");
mkdirSync(outputDir, { recursive: true });

const prompt = readFileSync(
  join(root, "prompts", "policy-resolved-agent", "v1.md"),
  "utf8",
).replaceAll("\r\n", "\n");
const rawPlanSchema = JSON.parse(
  readFileSync(
    join(
      root,
      "packages",
      "contracts",
      "schemas",
      "phase7",
      "agent-runtime-plan.v1.schema.json",
    ),
    "utf8",
  ),
);
const unsupportedGuidedKeywords = new Set([
  "$schema",
  "$id",
  "title",
  "uniqueItems",
  "format",
  "minProperties",
]);
const guidedSchema = (value) => {
  if (Array.isArray(value)) return value.map(guidedSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !unsupportedGuidedKeywords.has(key))
      .map(([key, entry]) => [key, guidedSchema(entry)]),
  );
};
const planSchema = guidedSchema(rawPlanSchema);

const runtimePostgres = {
  postgres: {
    id: "7d000000-0000-4000-8000-000000000101",
    name: "Tanaghom Agent Runtime PostgreSQL",
  },
};
const simulationPostgres = {
  postgres: {
    id: "7d000000-0000-4000-8000-000000000101",
    name: "Tanaghom Agent Runtime PostgreSQL",
  },
};
const gemma = {
  httpHeaderAuth: {
    id: "7d000000-0000-4000-8000-000000000103",
    name: "Tanaghom Gemma API",
  },
};
const n = (id, name, type, typeVersion, position, parameters, extra = {}) => ({
  parameters,
  id,
  name,
  type,
  typeVersion,
  position,
  ...extra,
});

const buildPlannerRequest = `const claimed = $json;
if (!claimed.job_id || !claimed.run_id || !claimed.planner_context) throw new Error('No policy-resolved job was claimed');
const context = typeof claimed.planner_context === 'string' ? JSON.parse(claimed.planner_context) : claimed.planner_context;
if (context.contract_version !== 'phase7.agent-runtime-context.v1') throw new Error('Unexpected runtime context contract');
if (context.platform_safety?.model_output_is_authority !== false || context.platform_safety?.arbitrary_code_allowed !== false || context.platform_safety?.direct_sql_allowed !== false) throw new Error('Runtime safety boundary is not fail-closed');
const request = {
  model: context.runtime_profile.model_name,
  temperature: 0.1,
  max_tokens: context.policy.max_tokens,
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'tanaghom_agent_runtime_plan_v1',
      strict: true,
      schema: ${JSON.stringify(planSchema)}
    }
  },
  messages: [
    { role: 'system', content: ${JSON.stringify(prompt)} },
    { role: 'user', content: JSON.stringify(context) }
  ]
};
return [{ json: { ...claimed, context, request } }];`;

const parsePlannerResponse = `const claimed = $('Build Policy-Resolved Planner Request').first().json;
const response = $json;
const status = Number(response.statusCode ?? response.status ?? 200);
const body = response.body ?? response;
if (response?.error || status >= 400) throw new Error('Gemma planner request failed closed');
let raw = body?.choices?.[0]?.message?.content ?? body?.message?.content;
if (typeof raw !== 'string') throw new Error('Gemma planner returned no content');
raw = raw.trim();
if (raw.startsWith('\`\`\`')) raw = raw.replace(/^\`\`\`(?:json)?\\s*/i, '').replace(/\\s*\`\`\`$/, '');
let plan;
try { plan = JSON.parse(raw); } catch { throw new Error('Gemma planner returned invalid JSON'); }
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const topKeys = ['contract_version','agent_version_id','agent_content_hash','language','intent_summary','steps','final_response_mode'];
const stepKeys = ['sequence','skill_code','operation','channel','consent_evidence','arguments_json','idempotency_key','rationale'];
if (!exact(plan, topKeys)) throw new Error('Planner object contains missing or unknown fields');
if (plan.contract_version !== 'phase7.agent-runtime-plan.v1' || plan.agent_version_id !== claimed.context.agent.version_id || plan.agent_content_hash !== claimed.context.agent.content_hash || plan.language !== claimed.context.job.language) throw new Error('Planner result is not bound to the claimed agent job');
if (!Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > Math.min(claimed.context.policy.max_steps, claimed.context.policy.max_tool_calls)) throw new Error('Planner step count exceeds policy');
for (let index = 0; index < plan.steps.length; index += 1) {
  const step = plan.steps[index];
  if (!exact(step, stepKeys) || step.sequence !== index + 1) throw new Error('Planner step shape or sequence is invalid');
  if (!/^[a-z][a-z0-9_]{2,79}$/.test(step.skill_code) || !/^[a-z][a-z0-9._-]{1,79}$/.test(step.operation) || !/^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/.test(step.idempotency_key)) throw new Error('Planner step identifier is invalid');
  let parameters;
  try { parameters = JSON.parse(step.arguments_json); } catch { throw new Error('Planner arguments_json is invalid'); }
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters) || step.arguments_json.length > 20000) throw new Error('Planner arguments must be a bounded object');
  if (/password|bearer\\s|api[_ -]?key|client[_ -]?secret|access[_ -]?token/i.test(step.arguments_json)) throw new Error('Planner attempted to emit credential-shaped content');
}
const usage = body?.usage ?? {};
return [{ json: {
  run_id: claimed.run_id,
  plan,
  advisory_hash: 'sha256:' + '0'.repeat(64),
  prompt_tokens: Number(usage.prompt_tokens ?? 0),
  completion_tokens: Number(usage.completion_tokens ?? 0)
} }];`;

const expandPlanSteps = `const parsed = $('Parse Strict Planner Contract').first().json;
return parsed.plan.steps.map((step) => ({ json: {
  run_id: parsed.run_id,
  step,
  advisory_parameter_hash: 'sha256:' + '0'.repeat(64)
} }));`;

const planner = {
  id: "phase7dPolicyResolvedAgentRunnerV1",
  name: "Tanaghom — Policy-Resolved Agent Runner v1",
  active: false,
  nodes: [
    n("phase7d-runner-manual", "Manual Controlled Trigger", "n8n-nodes-base.manualTrigger", 1, [0, 160], {}),
    n(
      "phase7d-runner-schedule",
      "Polling Disabled Pending Runtime Approval",
      "n8n-nodes-base.scheduleTrigger",
      1.2,
      [0, 340],
      { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } },
      { disabled: true },
    ),
    n(
      "phase7d-runner-claim",
      "Claim One Tenant-Bound Job",
      "n8n-nodes-base.postgres",
      2.6,
      [250, 250],
      {
        operation: "executeQuery",
        query: "SELECT * FROM tanaghom.claim_organization_agent_job($1::text);",
        options: { queryReplacement: "={{ ['policy-resolved-runner-v1'] }}" },
      },
      { credentials: runtimePostgres },
    ),
    n("phase7d-runner-build", "Build Policy-Resolved Planner Request", "n8n-nodes-base.code", 2, [500, 250], { jsCode: buildPlannerRequest }),
    n(
      "phase7d-runner-gemma",
      "Call Gemma Strict Planner",
      "n8n-nodes-base.httpRequest",
      4.2,
      [750, 250],
      {
        method: "POST",
        url: "https://api.thesmartlabs.net/gemma4/v1/chat/completions",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify($json.request) }}",
        options: {
          timeout: 180000,
          response: { response: { fullResponse: true, neverError: true } },
        },
      },
      { credentials: gemma, onError: "continueRegularOutput" },
    ),
    n("phase7d-runner-parse", "Parse Strict Planner Contract", "n8n-nodes-base.code", 2, [1000, 250], { jsCode: parsePlannerResponse }),
    n(
      "phase7d-runner-record",
      "Record Immutable Plan",
      "n8n-nodes-base.postgres",
      2.6,
      [1250, 250],
      {
        operation: "executeQuery",
        query: "SELECT tanaghom.record_agent_runtime_plan($1::uuid,$2::jsonb,$3::text,$4::integer,$5::integer) AS result;",
        options: {
          queryReplacement:
            "={{ [$json.run_id, JSON.stringify($json.plan), $json.advisory_hash, $json.prompt_tokens, $json.completion_tokens] }}",
        },
      },
      { credentials: runtimePostgres },
    ),
    n("phase7d-runner-expand", "Expand Recorded Plan Steps", "n8n-nodes-base.code", 2, [1500, 250], { jsCode: expandPlanSteps }),
    n(
      "phase7d-runner-authorize",
      "Server-Authorize Every Invocation",
      "n8n-nodes-base.postgres",
      2.6,
      [1750, 250],
      {
        operation: "executeQuery",
        query: "SELECT * FROM tanaghom.authorize_agent_skill_invocation($1::uuid,$2::jsonb,$3::text);",
        options: {
          queryReplacement:
            "={{ [$json.run_id, JSON.stringify($json.step), $json.advisory_parameter_hash] }}",
        },
      },
      { credentials: runtimePostgres },
    ),
    n(
      "phase7d-runner-simulation",
      "Simulation Invocation Ready?",
      "n8n-nodes-base.if",
      2.2,
      [2000, 250],
      {
        conditions: {
          options: { caseSensitive: true, typeValidation: "strict" },
          conditions: [
            {
              id: "phase7d-simulation-only",
              leftValue: "={{ $json.simulation_only }}",
              rightValue: true,
              operator: { type: "boolean", operation: "equals" },
            },
            {
              id: "phase7d-simulation-ready",
              leftValue: "={{ $json.status }}",
              rightValue: "simulation_ready",
              operator: { type: "string", operation: "equals" },
            },
          ],
          combinator: "and",
        },
        options: {},
      },
    ),
    n(
      "phase7d-runner-dispatch-simulation",
      "Run Fixed Simulation Dispatcher",
      "n8n-nodes-base.executeWorkflow",
      1.3,
      [2250, 160],
      {
        source: "database",
        workflowId: {
          __rl: true,
          value: "phase7dSimulationDispatcherV1",
          mode: "id",
        },
        mode: "each",
        options: { waitForSubWorkflow: true },
      },
    ),
  ],
  connections: {
    "Manual Controlled Trigger": { main: [[{ node: "Claim One Tenant-Bound Job", type: "main", index: 0 }]] },
    "Polling Disabled Pending Runtime Approval": { main: [[{ node: "Claim One Tenant-Bound Job", type: "main", index: 0 }]] },
    "Claim One Tenant-Bound Job": { main: [[{ node: "Build Policy-Resolved Planner Request", type: "main", index: 0 }]] },
    "Build Policy-Resolved Planner Request": { main: [[{ node: "Call Gemma Strict Planner", type: "main", index: 0 }]] },
    "Call Gemma Strict Planner": { main: [[{ node: "Parse Strict Planner Contract", type: "main", index: 0 }]] },
    "Parse Strict Planner Contract": { main: [[{ node: "Record Immutable Plan", type: "main", index: 0 }]] },
    "Record Immutable Plan": { main: [[{ node: "Expand Recorded Plan Steps", type: "main", index: 0 }]] },
    "Expand Recorded Plan Steps": { main: [[{ node: "Server-Authorize Every Invocation", type: "main", index: 0 }]] },
    "Server-Authorize Every Invocation": { main: [[{ node: "Simulation Invocation Ready?", type: "main", index: 0 }]] },
    "Simulation Invocation Ready?": { main: [[{ node: "Run Fixed Simulation Dispatcher", type: "main", index: 0 }], []] },
  },
  settings: {
    executionOrder: "v1",
    saveDataErrorExecution: "none",
    saveDataSuccessExecution: "none",
    saveManualExecutions: false,
    executionTimeout: 240,
  },
  meta: { templateCredsSetupCompleted: false },
  tags: [],
  pinData: {},
  versionId: "7d000000-0000-4000-8000-000000000201",
};

const simulationResult = `const claimed = $json;
if (!claimed.invocation_id || !claimed.run_id || !claimed.expected_behavior) throw new Error('No authorized simulation invocation was claimed');
return [{ json: {
  ...claimed,
  outcome: 'succeeded',
  result: {
    contract_version: 'phase7.agent-runtime-result.v1',
    invocation_id: claimed.invocation_id,
    outcome: 'succeeded',
    output_json: JSON.stringify({
      skill_code: claimed.skill_code,
      operation: claimed.operation,
      expected_behavior: claimed.expected_behavior,
      parameter_hash: claimed.parameter_hash,
      external_action_count: 0
    }),
    provider_reference: null,
    prompt_tokens: 0,
    completion_tokens: 0,
    actual_cost: 0,
    error_code: null
  }
} }];`;

const simulation = {
  id: "phase7dSimulationDispatcherV1",
  name: "Tanaghom — Agent Simulation Dispatcher v1",
  active: false,
  nodes: [
    n(
      "phase7d-simulation-input",
      "Called by Fixed Runtime Workflow",
      "n8n-nodes-base.executeWorkflowTrigger",
      1.1,
      [0, 220],
      { workflowInputs: { values: [] } },
    ),
    n(
      "phase7d-simulation-claim",
      "Claim Authorized Simulation Invocation",
      "n8n-nodes-base.postgres",
      2.6,
      [280, 220],
      {
        operation: "executeQuery",
        query: "SELECT * FROM tanaghom.claim_agent_simulation_invocation($1::text);",
        options: { queryReplacement: "={{ ['simulation-dispatcher-v1'] }}" },
      },
      { credentials: simulationPostgres },
    ),
    n("phase7d-simulation-build", "Build Zero-Action Simulation Result", "n8n-nodes-base.code", 2, [560, 220], { jsCode: simulationResult }),
    n(
      "phase7d-simulation-complete",
      "Record Simulation Evidence",
      "n8n-nodes-base.postgres",
      2.6,
      [840, 220],
      {
        operation: "executeQuery",
        query: "SELECT tanaghom.complete_agent_simulation_invocation($1::uuid,$2::text,$3::jsonb,$4::integer,$5::integer) AS status;",
        options: {
          queryReplacement:
            "={{ [$json.invocation_id, $json.outcome, JSON.stringify($json.result), 0, 0] }}",
        },
      },
      { credentials: simulationPostgres },
    ),
  ],
  connections: {
    "Called by Fixed Runtime Workflow": { main: [[{ node: "Claim Authorized Simulation Invocation", type: "main", index: 0 }]] },
    "Claim Authorized Simulation Invocation": { main: [[{ node: "Build Zero-Action Simulation Result", type: "main", index: 0 }]] },
    "Build Zero-Action Simulation Result": { main: [[{ node: "Record Simulation Evidence", type: "main", index: 0 }]] },
  },
  settings: {
    executionOrder: "v1",
    saveDataErrorExecution: "none",
    saveDataSuccessExecution: "none",
    saveManualExecutions: false,
    executionTimeout: 60,
  },
  meta: { templateCredsSetupCompleted: false },
  tags: [],
  pinData: {},
  versionId: "7d000000-0000-4000-8000-000000000202",
};

writeFileSync(
  join(outputDir, "policy-resolved-agent-runner.v1.json"),
  `${JSON.stringify(planner, null, 2)}\n`,
);
writeFileSync(
  join(outputDir, "simulation-dispatcher.v1.json"),
  `${JSON.stringify(simulation, null, 2)}\n`,
);
