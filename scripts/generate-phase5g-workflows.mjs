import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, "n8n", "workflows", "phase5g");
mkdirSync(outputDir, { recursive: true });
const prompt = readFileSync(join(root, "prompts", "quality-shadow-evaluator", "v1.md"), "utf8");
const schema = JSON.parse(readFileSync(join(root, "packages", "contracts", "schemas", "phase5g", "quality-shadow-result.v1.schema.json"), "utf8"));
delete schema.$schema; delete schema.$id;

const postgres = { postgres: { id: "62000000-0000-4000-8000-000000000001", name: "Tanaghom Worker PostgreSQL" } };
const gemma = { httpHeaderAuth: { id: "62000000-0000-4000-8000-000000000002", name: "Tanaghom Gemma API" } };
const node = (id, name, type, typeVersion, position, parameters, extra = {}) => ({ parameters, id, name, type, typeVersion, position, ...extra });

const build = `const claimed = $json;
if (!claimed.job_id || !claimed.request_body) throw new Error('No queued shadow job');
const job = typeof claimed.request_body === 'string' ? JSON.parse(claimed.request_body) : claimed.request_body;
if (job.external_actions_allowed !== false) throw new Error('Shadow boundary is not fail-closed');
const started = Date.now();
return [{ json: { ...claimed, started, request: { model: job.versions.model, temperature: 0.1, response_format: { type: 'json_schema', json_schema: { name: 'tanaghom_quality_shadow_result_v1', schema: ${JSON.stringify(schema)} } }, messages: [{ role: 'system', content: ${JSON.stringify(prompt)} }, { role: 'user', content: JSON.stringify(job) }] } } }];`;

const parse = `const claimed = $('Build Proposal-Only Request').first().json;
const response = $json;
if (response?.error) return [{ json: { ...claimed, ok: false, error_code: 'gemma_request_error', error_message: String(response.error.message ?? response.error).slice(0,1000) } }];
const status = Number(response.statusCode ?? response.status ?? 200); const body = response.body ?? response;
if (status >= 400) return [{ json: { ...claimed, ok: false, error_code: status === 429 ? 'gemma_rate_limited' : 'gemma_http_error', error_message: String(body?.error?.message ?? body?.message ?? status).slice(0,1000) } }];
let raw = body?.choices?.[0]?.message?.content ?? body?.message?.content; if (typeof raw !== 'string') return [{ json: { ...claimed, ok: false, error_code: 'gemma_empty_response', error_message: 'Gemma returned no content' } }];
raw = raw.trim(); if (raw.charCodeAt(0) === 96) raw = raw.replace(/^.{3}(?:json)?\\s*/i,'').replace(/\\s*.{3}$/,'');
let output; try { output = JSON.parse(raw); } catch (error) { return [{ json: { ...claimed, ok: false, error_code: 'gemma_invalid_json', error_message: String(error.message).slice(0,1000) } }]; }
const job = typeof claimed.request_body === 'string' ? JSON.parse(claimed.request_body) : claimed.request_body;
output.latency_seconds = Math.max(0,(Date.now()-claimed.started)/1000);
if (output.contract_version !== 'phase5g.quality-shadow-result.v1' || output.prompt_version !== job.versions.prompt || output.model_name !== job.versions.model || output.external_action_count !== 0) return [{ json: { ...claimed, ok: false, error_code: 'gemma_contract_mismatch', error_message: 'Result versions or zero-action boundary do not match the claimed evidence contract' } }];
return [{ json: { ...claimed, ok: true, output } }];`;

const workflow = {
  id: "phase5gQualityShadowEvaluatorV1", name: "Tanaghom — Quality Shadow Evaluator v1", active: false,
  nodes: [
    node("shadow-manual", "Manual Controlled Trigger", "n8n-nodes-base.manualTrigger", 1, [0,180], {}),
    node("shadow-schedule", "Polling Disabled Pending Approval", "n8n-nodes-base.scheduleTrigger", 1.2, [0,360], { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }, { disabled: true }),
    node("shadow-claim", "Claim Shadow Job", "n8n-nodes-base.postgres", 2.6, [240,270], { operation: "executeQuery", query: "SELECT * FROM tanaghom.claim_quality_shadow_job();", options: {} }, { credentials: postgres }),
    node("shadow-build", "Build Proposal-Only Request", "n8n-nodes-base.code", 2, [480,270], { jsCode: build }),
    node("shadow-gemma", "Call Gemma", "n8n-nodes-base.httpRequest", 4.2, [720,270], { method: "POST", url: "https://api.thesmartlabs.net/gemma4/v1/chat/completions", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify($json.request) }}", options: { timeout: 180000, response: { response: { fullResponse: true, neverError: true } } } }, { credentials: gemma, onError: "continueRegularOutput" }),
    node("shadow-parse", "Parse and Check Contract", "n8n-nodes-base.code", 2, [960,270], { jsCode: parse }),
    node("shadow-valid", "Contract Valid?", "n8n-nodes-base.if", 2.2, [1200,270], { conditions: { options: { caseSensitive: true, typeValidation: "strict" }, conditions: [{ id: "shadow-ok", leftValue: "={{ $json.ok }}", rightValue: true, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {} }),
    node("shadow-persist", "Persist Shadow Evidence", "n8n-nodes-base.postgres", 2.6, [1440,180], { operation: "executeQuery", query: "SELECT tanaghom.persist_quality_shadow_result($1::uuid,$2::jsonb) AS result_id;", options: { queryReplacement: "={{ [$json.job_id, JSON.stringify($json.output)] }}" } }, { credentials: postgres }),
    node("shadow-failure", "Record Shadow Failure", "n8n-nodes-base.postgres", 2.6, [1440,360], { operation: "executeQuery", query: "SELECT tanaghom.record_quality_shadow_failure($1::uuid,$2::text,$3::text) AS next_status;", options: { queryReplacement: "={{ [$json.job_id, $json.error_code, $json.error_message] }}" } }, { credentials: postgres }),
  ],
  connections: {
    "Manual Controlled Trigger": { main: [[{ node: "Claim Shadow Job", type: "main", index: 0 }]] },
    "Polling Disabled Pending Approval": { main: [[{ node: "Claim Shadow Job", type: "main", index: 0 }]] },
    "Claim Shadow Job": { main: [[{ node: "Build Proposal-Only Request", type: "main", index: 0 }]] },
    "Build Proposal-Only Request": { main: [[{ node: "Call Gemma", type: "main", index: 0 }]] },
    "Call Gemma": { main: [[{ node: "Parse and Check Contract", type: "main", index: 0 }]] },
    "Parse and Check Contract": { main: [[{ node: "Contract Valid?", type: "main", index: 0 }]] },
    "Contract Valid?": { main: [[{ node: "Persist Shadow Evidence", type: "main", index: 0 }], [{ node: "Record Shadow Failure", type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1", saveDataErrorExecution: "none", saveDataSuccessExecution: "none", executionTimeout: 240 },
  meta: { templateCredsSetupCompleted: false }, tags: [], pinData: {}, versionId: "61000000-0000-4000-8000-000000000021",
};

writeFileSync(join(outputDir, "quality-shadow-evaluator.v1.json"), `${JSON.stringify(workflow, null, 2)}\n`);
