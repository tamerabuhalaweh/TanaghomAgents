import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, "n8n", "workflows", "phase3");
mkdirSync(outputDir, { recursive: true });

const postgresCredential = {
  postgres: { id: "62000000-0000-4000-8000-000000000001", name: "Tanaghom Worker PostgreSQL" },
};
const gemmaCredential = {
  httpHeaderAuth: { id: "62000000-0000-4000-8000-000000000002", name: "Tanaghom Gemma API" },
};

function node(id, name, type, typeVersion, position, parameters, extra = {}) {
  return { parameters, id, name, type, typeVersion, position, ...extra };
}

function workflow({ name, agent, jobType, promptPath, promptVersion, outputVersion, persistFunction }) {
  const prompt = readFileSync(join(root, promptPath), "utf8").replace(/\r\n/g, "\n").trim();
  const prefix = agent === "campaign_strategist" ? "strategist" : "producer";
  const parseCode = `const claimed = $('Claim Job').first().json;
const response = $json;
const statusCode = Number(response.statusCode ?? response.status ?? 200);
const body = response.body ?? response;
if (statusCode >= 400) return [{ json: { ...claimed, ok: false, error_code: statusCode === 429 ? 'gemma_rate_limited' : 'gemma_http_error', error_message: String(body?.error?.message ?? body?.message ?? statusCode).slice(0, 1000) } }];
const raw = body?.choices?.[0]?.message?.content ?? body?.message?.content;
if (typeof raw !== 'string' || !raw.trim()) return [{ json: { ...claimed, ok: false, error_code: 'gemma_empty_response', error_message: 'Gemma returned no message content' } }];
let data;
let text = raw.trim();
if (text.charCodeAt(0) === 96) text = text.replace(/^.{3}(?:json)?\\s*/i, '').replace(/\\s*.{3}$/, '');
try { data = JSON.parse(text); }
catch (error) { return [{ json: { ...claimed, ok: false, error_code: 'gemma_invalid_json', error_message: String(error.message).slice(0, 1000) } }]; }
if (data?.contract_version !== '${outputVersion}') return [{ json: { ...claimed, ok: false, error_code: 'gemma_contract_mismatch', error_message: 'Unexpected output contract version' } }];
return [{ json: { ...claimed, ok: true, output: data } }];`;

  const nodes = [
    node(`${prefix}-manual`, "Manual Test Trigger", "n8n-nodes-base.manualTrigger", 1, [0, 180], {}),
    node(`${prefix}-schedule`, "Poll Every Minute", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 360], {
      rule: { interval: [{ field: "minutes", minutesInterval: 1 }] },
    }),
    node(`${prefix}-claim`, "Claim Job", "n8n-nodes-base.postgres", 2.6, [240, 270], {
      operation: "executeQuery",
      query: `SELECT * FROM tanaghom.claim_agent_job('${agent}', ARRAY['${jobType}']);`,
      options: {},
    }, { credentials: postgresCredential }),
    node(`${prefix}-request`, "Build Gemma Request", "n8n-nodes-base.code", 2, [480, 270], {
      jsCode: `const claimed = $json;
if (!claimed.job_id || !claimed.input) throw new Error('Claimed job payload is missing');
return [{ json: { ...claimed, request: { model: 'gemma-4', temperature: 0.2, response_format: { type: 'json_object' }, messages: [ { role: 'system', content: ${JSON.stringify(prompt)} }, { role: 'user', content: JSON.stringify(claimed.input) } ] } } }];`,
    }),
    node(`${prefix}-gemma`, "Call Gemma", "n8n-nodes-base.httpRequest", 4.2, [720, 270], {
      method: "POST",
      url: "https://api.thesmartlabs.net/v1/chat/completions",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.request) }}",
      options: { timeout: 180000, response: { response: { fullResponse: true, neverError: true } } },
    }, { credentials: gemmaCredential }),
    node(`${prefix}-parse`, "Parse and Check Contract", "n8n-nodes-base.code", 2, [960, 270], { jsCode: parseCode }),
    node(`${prefix}-valid`, "Contract Valid?", "n8n-nodes-base.if", 2.2, [1200, 270], {
      conditions: { options: { caseSensitive: true, typeValidation: "strict" }, conditions: [{ id: `${prefix}-ok`, leftValue: "={{ $json.ok }}", rightValue: true, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {},
    }),
    node(`${prefix}-persist`, "Persist Valid Result", "n8n-nodes-base.postgres", 2.6, [1440, 180], {
      operation: "executeQuery",
      query: `SELECT tanaghom.${persistFunction}($1::uuid, $2::jsonb, $3::text, $4::text) AS result;`,
      options: { queryReplacement: `={{ [$json.job_id, JSON.stringify($json.output), 'gemma-4', '${promptVersion}'] }}` },
    }, { credentials: postgresCredential }),
    node(`${prefix}-failure`, "Record Failure", "n8n-nodes-base.postgres", 2.6, [1440, 360], {
      operation: "executeQuery",
      query: "SELECT tanaghom.record_agent_job_failure($1::uuid, $2::text, $3::text, 60) AS next_status;",
      options: { queryReplacement: "={{ [$json.job_id, $json.error_code, $json.error_message] }}" },
    }, { credentials: postgresCredential }),
  ];
  const connections = {
    "Manual Test Trigger": { main: [[{ node: "Claim Job", type: "main", index: 0 }]] },
    "Poll Every Minute": { main: [[{ node: "Claim Job", type: "main", index: 0 }]] },
    "Claim Job": { main: [[{ node: "Build Gemma Request", type: "main", index: 0 }]] },
    "Build Gemma Request": { main: [[{ node: "Call Gemma", type: "main", index: 0 }]] },
    "Call Gemma": { main: [[{ node: "Parse and Check Contract", type: "main", index: 0 }]] },
    "Parse and Check Contract": { main: [[{ node: "Contract Valid?", type: "main", index: 0 }]] },
    "Contract Valid?": { main: [[{ node: "Persist Valid Result", type: "main", index: 0 }], [{ node: "Record Failure", type: "main", index: 0 }]] },
  };
  return {
    id: agent === "campaign_strategist" ? "phase3StrategistV1" : "phase3ContentProducerV1",
    name, nodes, connections, active: false,
    settings: { executionOrder: "v1", saveDataErrorExecution: "all", saveDataSuccessExecution: "all", executionTimeout: 300 },
    meta: { templateCredsSetupCompleted: false },
    tags: [],
    pinData: {},
    versionId: agent === "campaign_strategist" ? "61000000-0000-4000-8000-000000000001" : "61000000-0000-4000-8000-000000000002",
  };
}

const definitions = [
  ["campaign-strategist.v1.json", workflow({ name: "Tanaghom — Campaign Strategist v1", agent: "campaign_strategist", jobType: "campaign.strategy.generate", promptPath: "prompts/campaign-strategist/v1.md", promptVersion: "campaign-strategist/v1", outputVersion: "phase3.strategist-output.v1", persistFunction: "persist_strategy_result" })],
  ["content-producer.v1.json", workflow({ name: "Tanaghom — Content Producer v1", agent: "content_producer", jobType: "campaign.content.generate", promptPath: "prompts/content-producer/v1.md", promptVersion: "content-producer/v1", outputVersion: "phase3.content-producer-output.v1", persistFunction: "persist_content_result" })],
];
for (const [file, definition] of definitions) writeFileSync(join(outputDir, file), `${JSON.stringify(definition, null, 2)}\n`);
