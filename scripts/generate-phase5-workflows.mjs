import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, "n8n", "workflows", "phase5");
mkdirSync(outputDir, { recursive: true });

const postgresCredential = { postgres: { id: "62000000-0000-4000-8000-000000000001", name: "Tanaghom Worker PostgreSQL" } };
const conversationPostgresCredential = { postgres: { id: "62000000-0000-4000-8000-000000000005", name: "Tanaghom Conversation PostgreSQL" } };
const gemmaCredential = { httpHeaderAuth: { id: "62000000-0000-4000-8000-000000000002", name: "Tanaghom Gemma API" } };
const gatewayCredential = { httpHeaderAuth: { id: "62000000-0000-4000-8000-000000000004", name: "Tanaghom Integration Gateway" } };

const conversationPrompt = readFileSync(join(root, "prompts", "conversation-intelligence", "v1.md"), "utf8");
const conversationOutputSchema = JSON.parse(readFileSync(join(root, "packages", "contracts", "schemas", "phase5", "conversation-intelligence-output.v1.schema.json"), "utf8"));
delete conversationOutputSchema.$schema;
delete conversationOutputSchema.$id;
delete conversationOutputSchema.title;

function node(id, name, type, typeVersion, position, parameters, extra = {}) {
  return { parameters, id, name, type, typeVersion, position, ...extra };
}

const normalizeCode = `const prepared = $('Prepare GHL Contact').first().json;
const response = $json;
if (response?.error) return [{ json: { ...prepared, ok: false, error_code: 'ghl_network_error', error_message: String(response.error.message ?? response.error).slice(0, 1000), http_status: 0, retry_after_seconds: 300 } }];
const statusCode = Number(response.statusCode ?? response.status ?? 200);
const body = response.body ?? response;
if (statusCode < 200 || statusCode >= 300) return [{ json: { ...prepared, ok: false, error_code: statusCode === 429 ? 'ghl_rate_limited' : 'ghl_http_error', error_message: String(body?.message ?? body?.error ?? statusCode).slice(0, 1000), http_status: statusCode, retry_after_seconds: statusCode === 429 ? 3600 : 300 } }];
const contact = body?.contact;
if (!contact || typeof contact.id !== 'string' || !contact.id.trim() || typeof contact.locationId !== 'string' || !contact.locationId.trim()) return [{ json: { ...prepared, ok: false, error_code: 'ghl_invalid_response', error_message: 'HighLevel returned success without a contact ID and location ID', http_status: statusCode, retry_after_seconds: 300 } }];
return [{ json: { ...prepared, ok: true, result: { contract_version: 'phase5.ghl-contact-upsert-result.v1', provider_contact_id: contact.id.trim(), location_id: contact.locationId.trim(), created: body?.new === true } } }];`;

const normalizeActionCode = `const prepared = $('Prepare GHL Action').first().json;
const response = $json;
if (response?.error) return [{ json: { ...prepared, ok: false, error_code: 'ghl_network_error', error_message: String(response.error.message ?? response.error).slice(0, 1000), http_status: 0, retry_after_seconds: 300 } }];
const statusCode = Number(response.statusCode ?? response.status ?? 200);
const body = response.body ?? response;
if (statusCode < 200 || statusCode >= 300) return [{ json: { ...prepared, ok: false, error_code: statusCode === 429 ? 'ghl_rate_limited' : 'ghl_http_error', error_message: String(body?.message ?? body?.error ?? statusCode).slice(0, 1000), http_status: statusCode, retry_after_seconds: statusCode === 429 ? 3600 : 300 } }];
const reference = body?.messageId ?? body?.appointment?.id ?? body?.opportunity?.id ?? body?.contact?.id ?? body?.reference ?? null;
return [{ json: { ...prepared, ok: true, result: { contract_version: 'phase5.ghl-action-result.v1', outcome: 'succeeded', provider_reference: typeof reference === 'string' ? reference.slice(0, 300) : null, provider_payload: body && typeof body === 'object' && !Array.isArray(body) ? body : {} } } }];`;

const buildConversationRequestCode = `const claimed = $json;
if (!claimed.job_id || !claimed.event_id || !claimed.request_body) throw new Error('Claimed conversation intelligence payload is missing');
return [{ json: { ...claimed, request: { model: 'gemma4-26b-a4b-canary', temperature: 0.1, response_format: { type: 'json_schema', json_schema: { name: 'tanaghom_conversation_intelligence_output_v1', strict: true, schema: ${JSON.stringify(conversationOutputSchema)} } }, messages: [ { role: 'system', content: ${JSON.stringify(conversationPrompt)} }, { role: 'user', content: JSON.stringify(claimed.request_body) } ] } } }];`;

const normalizeConversationCode = `const prepared = $('Build Conversation Request').first().json;
const response = $json;
const fail = (error_code, error_message, retry_after_seconds = 30) => [{ json: { ...prepared, ok: false, error_code, error_message: String(error_message).slice(0, 1000), retry_after_seconds: Math.max(0, Math.min(86400, Number(retry_after_seconds) || 30)) } }];
if (response?.error) return fail('gemma_unavailable', response.error.message ?? response.error, 30);
const statusCode = Number(response.statusCode ?? response.status ?? 200);
const body = response.body ?? response;
const retryHeader = Number(response.headers?.['retry-after'] ?? response.headers?.['Retry-After'] ?? 0);
if (statusCode < 200 || statusCode >= 300) {
  const code = statusCode === 429 ? 'gemma_rate_limited' : statusCode === 503 ? 'gemma_overloaded' : statusCode >= 500 ? 'gemma_unavailable' : 'gemma_http_error';
  return fail(code, body?.error?.message ?? body?.message ?? statusCode, statusCode === 429 ? (retryHeader || 60) : 30);
}
let raw = body?.choices?.[0]?.message?.content ?? body?.message?.content;
if (typeof raw !== 'string' || !raw.trim()) return fail('gemma_empty_response', 'Gemma returned no message content');
raw = raw.trim();
if (raw.charCodeAt(0) === 96) raw = raw.replace(/^.{3}(?:json)?\\s*/i, '').replace(/\\s*.{3}$/, '');
let output;
try { output = JSON.parse(raw); } catch (error) { return fail('gemma_invalid_json', error.message); }
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const oneOf = (value, values) => values.includes(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const topKeys = ['contract_version','prompt_version','model_name','language','intent','urgency','sentiment','sales_stage','risk_categories','next_best_action','confidence','answer_status','proposed_reply','citations','escalation','conversation_summary','external_action_count'];
let valid = exactKeys(output, topKeys)
  && output.contract_version === 'phase5.conversation-intelligence-output.v1'
  && output.prompt_version === 'phase5.conversation-intelligence.prompt.v1'
  && output.model_name === 'gemma4-26b-a4b-canary'
  && oneOf(output.language, ['en','ar'])
  && oneOf(output.intent, ['product_question','pricing','availability','objection','purchase_intent','booking','complaint','refund','payment','legal','abuse','policy_exception','sensitive_data','greeting','unknown'])
  && oneOf(output.urgency, ['low','normal','high','critical'])
  && oneOf(output.sentiment, ['positive','neutral','negative','mixed'])
  && oneOf(output.sales_stage, ['discovery','qualification','consideration','decision','customer_support','unknown'])
  && oneOf(output.next_best_action, ['respond','ask_clarifying_question','escalate_to_human','no_action'])
  && oneOf(output.answer_status, ['proposal','escalate','no_approved_answer'])
  && typeof output.confidence === 'number' && output.confidence >= 0 && output.confidence <= 1
  && (output.proposed_reply === null || (typeof output.proposed_reply === 'string' && output.proposed_reply.length <= 5000))
  && output.external_action_count === 0;
const risks = ['complaint','legal','payment','refund','abuse','policy_exception','sensitive_data','prompt_injection','none'];
valid = valid && Array.isArray(output.risk_categories) && output.risk_categories.length <= 8 && new Set(output.risk_categories).size === output.risk_categories.length && output.risk_categories.every(value => risks.includes(value));
valid = valid && Array.isArray(output.citations) && output.citations.length <= 12 && output.citations.every(citation => exactKeys(citation, ['source_id','source_version_id','content_fingerprint']) && uuid.test(citation.source_id) && uuid.test(citation.source_version_id) && /^md5:[0-9a-f]{32}$/.test(citation.content_fingerprint));
valid = valid && exactKeys(output.escalation, ['required','category','reason']) && typeof output.escalation.required === 'boolean' && (output.escalation.category === null || (typeof output.escalation.category === 'string' && output.escalation.category.length <= 100)) && (output.escalation.reason === null || (typeof output.escalation.reason === 'string' && output.escalation.reason.length <= 1000));
if (output.conversation_summary !== null) valid = valid && exactKeys(output.conversation_summary, ['language','summary','input_event_ids']) && oneOf(output.conversation_summary.language, ['en','ar']) && typeof output.conversation_summary.summary === 'string' && output.conversation_summary.summary.length >= 1 && output.conversation_summary.summary.length <= 4000 && Array.isArray(output.conversation_summary.input_event_ids) && output.conversation_summary.input_event_ids.length >= 1 && output.conversation_summary.input_event_ids.length <= 12 && new Set(output.conversation_summary.input_event_ids).size === output.conversation_summary.input_event_ids.length && output.conversation_summary.input_event_ids.every(value => uuid.test(value));
if (output.answer_status === 'proposal') valid = valid && typeof output.proposed_reply === 'string' && output.proposed_reply.length >= 1 && output.citations.length >= 1;
if (output.answer_status === 'no_approved_answer') valid = valid && output.citations.length === 0 && output.escalation.required === true;
const policy = prepared.request_body.system_policy ?? {};
const mandatory = valid && (output.confidence < Number(policy.confidence_threshold ?? 1) || (policy.mandatory_escalations ?? []).includes(output.intent) || ['high','critical'].includes(output.urgency) || output.risk_categories.some(value => (policy.mandatory_escalations ?? []).includes(value)));
if (mandatory && output.escalation.required !== true) valid = false;
if (!valid) return fail('gemma_contract_mismatch', 'Gemma response failed the conversation intelligence contract');
return [{ json: { ...prepared, ok: true, output } }];`;

const workflow = {
  id: "phase5GhlContactUpsertV1",
  name: "Tanaghom — GHL Contact Sync v1",
  active: false,
  nodes: [
    node("ghl-manual", "Manual Controlled Trigger", "n8n-nodes-base.manualTrigger", 1, [0, 180], {}),
    node("ghl-schedule", "Polling Disabled Pending Approval", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 360], { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } }, { disabled: true }),
    node("ghl-claim", "Claim GHL Contact Job", "n8n-nodes-base.postgres", 2.6, [240, 270], { operation: "executeQuery", query: "SELECT * FROM tanaghom.claim_ghl_contact_job();", options: {} }, { credentials: postgresCredential }),
    node("ghl-prepare", "Prepare GHL Contact", "n8n-nodes-base.postgres", 2.6, [480, 270], { operation: "executeQuery", query: "SELECT * FROM tanaghom.prepare_ghl_contact_upsert($1::uuid);", options: { queryReplacement: "={{ [$json.job_id] }}" } }, { credentials: postgresCredential }),
    node("ghl-request", "Upsert GHL Contact", "n8n-nodes-base.httpRequest", 4.2, [720, 270], {
      method: "POST", url: "={{ $env.TANAGHOM_INTEGRATION_GATEWAY_URL }}/api/internal/integrations/ghl/contact",
      authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendHeaders: true,
      headerParameters: { parameters: [{ name: "Idempotency-Key", value: "={{ $json.idempotency_key }}" }] }, sendBody: true,
      specifyBody: "json", jsonBody: "={{ JSON.stringify({ job_id: $json.job_id, request_body: $json.request_body }) }}",
      options: { timeout: 60000, response: { response: { fullResponse: true, neverError: true } } },
    }, { credentials: gatewayCredential, onError: "continueRegularOutput" }),
    node("ghl-normalize", "Normalize GHL Response", "n8n-nodes-base.code", 2, [960, 270], { jsCode: normalizeCode }),
    node("ghl-valid", "GHL Contact Valid?", "n8n-nodes-base.if", 2.2, [1200, 270], { conditions: { options: { caseSensitive: true, typeValidation: "strict" }, conditions: [{ id: "ghl-ok", leftValue: "={{ $json.ok }}", rightValue: true, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {} }),
    node("ghl-complete", "Record GHL Contact", "n8n-nodes-base.postgres", 2.6, [1440, 180], { operation: "executeQuery", query: "SELECT tanaghom.complete_ghl_contact_upsert($1::uuid, $2::jsonb) AS contact_id;", options: { queryReplacement: "={{ [$json.job_id, JSON.stringify($json.result)] }}" } }, { credentials: postgresCredential }),
    node("ghl-failure", "Record GHL Failure", "n8n-nodes-base.postgres", 2.6, [1440, 360], { operation: "executeQuery", query: "SELECT tanaghom.record_ghl_contact_failure($1::uuid, $2::text, $3::text, $4::integer, $5::integer) AS next_status;", options: { queryReplacement: "={{ [$json.job_id, $json.error_code, $json.error_message, $json.http_status, $json.retry_after_seconds] }}" } }, { credentials: postgresCredential }),
  ],
  connections: {
    "Manual Controlled Trigger": { main: [[{ node: "Claim GHL Contact Job", type: "main", index: 0 }]] },
    "Polling Disabled Pending Approval": { main: [[{ node: "Claim GHL Contact Job", type: "main", index: 0 }]] },
    "Claim GHL Contact Job": { main: [[{ node: "Prepare GHL Contact", type: "main", index: 0 }]] },
    "Prepare GHL Contact": { main: [[{ node: "Upsert GHL Contact", type: "main", index: 0 }]] },
    "Upsert GHL Contact": { main: [[{ node: "Normalize GHL Response", type: "main", index: 0 }]] },
    "Normalize GHL Response": { main: [[{ node: "GHL Contact Valid?", type: "main", index: 0 }]] },
    "GHL Contact Valid?": { main: [[{ node: "Record GHL Contact", type: "main", index: 0 }], [{ node: "Record GHL Failure", type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1", saveDataErrorExecution: "none", saveDataSuccessExecution: "none", executionTimeout: 120 },
  meta: { templateCredsSetupCompleted: false }, tags: [], pinData: {}, versionId: "61000000-0000-4000-8000-000000000006",
};

const actionWorkflow = {
  id: "phase5GovernedGhlActionsV1",
  name: "Tanaghom — Governed GHL Actions v1",
  active: false,
  nodes: [
    node("ghl-action-manual", "Manual Controlled Trigger", "n8n-nodes-base.manualTrigger", 1, [0, 180], {}),
    node("ghl-action-schedule", "Polling Disabled Pending Approval", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 360], { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }, { disabled: true }),
    node("ghl-action-claim", "Claim GHL Action", "n8n-nodes-base.postgres", 2.6, [240, 270], { operation: "executeQuery", query: "SELECT * FROM tanaghom.claim_ghl_action_job();", options: {} }, { credentials: postgresCredential }),
    node("ghl-action-prepare", "Prepare GHL Action", "n8n-nodes-base.postgres", 2.6, [480, 270], { operation: "executeQuery", query: "SELECT * FROM tanaghom.prepare_ghl_action_dispatch($1::uuid);", options: { queryReplacement: "={{ [$json.job_id] }}" } }, { credentials: postgresCredential }),
    node("ghl-action-request", "Execute Governed GHL Action", "n8n-nodes-base.httpRequest", 4.2, [720, 270], {
      method: "POST", url: "={{ $env.TANAGHOM_INTEGRATION_GATEWAY_URL }}/api/internal/integrations/ghl/action",
      authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendHeaders: true,
      headerParameters: { parameters: [{ name: "Idempotency-Key", value: "={{ $json.idempotency_key }}" }] }, sendBody: true,
      specifyBody: "json", jsonBody: "={{ JSON.stringify({ job_id: $json.job_id, operation_id: $json.operation_id, request_body: $json.request_body }) }}",
      options: { timeout: 60000, response: { response: { fullResponse: true, neverError: true } } },
    }, { credentials: gatewayCredential, onError: "continueRegularOutput" }),
    node("ghl-action-normalize", "Normalize GHL Action Response", "n8n-nodes-base.code", 2, [960, 270], { jsCode: normalizeActionCode }),
    node("ghl-action-valid", "GHL Action Valid?", "n8n-nodes-base.if", 2.2, [1200, 270], { conditions: { options: { caseSensitive: true, typeValidation: "strict" }, conditions: [{ id: "ghl-action-ok", leftValue: "={{ $json.ok }}", rightValue: true, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {} }),
    node("ghl-action-complete", "Record GHL Action", "n8n-nodes-base.postgres", 2.6, [1440, 180], { operation: "executeQuery", query: "SELECT tanaghom.complete_ghl_action($1::uuid,$2::jsonb) AS provider_reference;", options: { queryReplacement: "={{ [$json.job_id, JSON.stringify($json.result)] }}" } }, { credentials: postgresCredential }),
    node("ghl-action-failure", "Record GHL Action Failure", "n8n-nodes-base.postgres", 2.6, [1440, 360], { operation: "executeQuery", query: "SELECT tanaghom.record_ghl_action_failure($1::uuid,$2::text,$3::text,$4::integer,$5::integer) AS next_status;", options: { queryReplacement: "={{ [$json.job_id, $json.error_code, $json.error_message, $json.http_status, $json.retry_after_seconds] }}" } }, { credentials: postgresCredential }),
  ],
  connections: {
    "Manual Controlled Trigger": { main: [[{ node: "Claim GHL Action", type: "main", index: 0 }]] },
    "Polling Disabled Pending Approval": { main: [[{ node: "Claim GHL Action", type: "main", index: 0 }]] },
    "Claim GHL Action": { main: [[{ node: "Prepare GHL Action", type: "main", index: 0 }]] },
    "Prepare GHL Action": { main: [[{ node: "Execute Governed GHL Action", type: "main", index: 0 }]] },
    "Execute Governed GHL Action": { main: [[{ node: "Normalize GHL Action Response", type: "main", index: 0 }]] },
    "Normalize GHL Action Response": { main: [[{ node: "GHL Action Valid?", type: "main", index: 0 }]] },
    "GHL Action Valid?": { main: [[{ node: "Record GHL Action", type: "main", index: 0 }], [{ node: "Record GHL Action Failure", type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1", saveDataErrorExecution: "none", saveDataSuccessExecution: "none", executionTimeout: 120 },
  meta: { templateCredsSetupCompleted: false }, tags: [], pinData: {}, versionId: "61000000-0000-4000-8000-000000000015",
};

const conversationWorkflow = {
  id: "phase5ConversationIntelligenceV1",
  name: "Tanaghom \u2014 Conversation Intelligence v1",
  active: false,
  nodes: [
    node("conversation-manual", "Manual Controlled Trigger", "n8n-nodes-base.manualTrigger", 1, [0, 180], {}),
    node("conversation-schedule", "Polling Disabled Pending Approval", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 360], { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }, { disabled: true }),
    node("conversation-claim", "Claim Conversation Job", "n8n-nodes-base.postgres", 2.6, [240, 270], { operation: "executeQuery", query: "SELECT * FROM tanaghom.claim_ghl_inbound_event_job();", options: {} }, { credentials: conversationPostgresCredential }),
    node("conversation-prepare", "Prepare Conversation Intelligence", "n8n-nodes-base.postgres", 2.6, [480, 270], { operation: "executeQuery", query: "SELECT * FROM tanaghom.prepare_conversation_intelligence($1::uuid);", options: { queryReplacement: "={{ [$json.job_id] }}" } }, { credentials: conversationPostgresCredential }),
    node("conversation-build", "Build Conversation Request", "n8n-nodes-base.code", 2, [720, 270], { jsCode: buildConversationRequestCode }),
    node("conversation-gemma", "Call Gemma", "n8n-nodes-base.httpRequest", 4.2, [960, 270], {
      method: "POST", url: "https://api.thesmartlabs.net/gemma4/v1/chat/completions",
      authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true,
      specifyBody: "json", jsonBody: "={{ JSON.stringify($json.request) }}",
      options: { timeout: 120000, response: { response: { fullResponse: true, neverError: true } } },
    }, { credentials: gemmaCredential, onError: "continueRegularOutput" }),
    node("conversation-normalize", "Normalize Conversation Response", "n8n-nodes-base.code", 2, [1200, 270], { jsCode: normalizeConversationCode }),
    node("conversation-valid", "Conversation Result Valid?", "n8n-nodes-base.if", 2.2, [1440, 270], { conditions: { options: { caseSensitive: true, typeValidation: "strict" }, conditions: [{ id: "conversation-ok", leftValue: "={{ $json.ok }}", rightValue: true, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {} }),
    node("conversation-persist", "Persist Conversation Proposal", "n8n-nodes-base.postgres", 2.6, [1680, 180], { operation: "executeQuery", query: "SELECT tanaghom.persist_conversation_intelligence_proposal($1::uuid,$2::jsonb) AS proposal_id;", options: { queryReplacement: "={{ [$json.job_id, JSON.stringify($json.output)] }}" } }, { credentials: conversationPostgresCredential }),
    node("conversation-failure", "Record Conversation Failure", "n8n-nodes-base.postgres", 2.6, [1680, 360], { operation: "executeQuery", query: "SELECT tanaghom.record_ghl_inbound_event_failure($1::uuid,$2::text,$3::text,$4::integer) AS next_status;", options: { queryReplacement: "={{ [$json.job_id, $json.error_code, $json.error_message, $json.retry_after_seconds] }}" } }, { credentials: conversationPostgresCredential }),
  ],
  connections: {
    "Manual Controlled Trigger": { main: [[{ node: "Claim Conversation Job", type: "main", index: 0 }]] },
    "Polling Disabled Pending Approval": { main: [[{ node: "Claim Conversation Job", type: "main", index: 0 }]] },
    "Claim Conversation Job": { main: [[{ node: "Prepare Conversation Intelligence", type: "main", index: 0 }]] },
    "Prepare Conversation Intelligence": { main: [[{ node: "Build Conversation Request", type: "main", index: 0 }]] },
    "Build Conversation Request": { main: [[{ node: "Call Gemma", type: "main", index: 0 }]] },
    "Call Gemma": { main: [[{ node: "Normalize Conversation Response", type: "main", index: 0 }]] },
    "Normalize Conversation Response": { main: [[{ node: "Conversation Result Valid?", type: "main", index: 0 }]] },
    "Conversation Result Valid?": { main: [[{ node: "Persist Conversation Proposal", type: "main", index: 0 }], [{ node: "Record Conversation Failure", type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1", saveDataErrorExecution: "none", saveDataSuccessExecution: "none", executionTimeout: 180 },
  meta: { templateCredsSetupCompleted: false }, tags: [], pinData: {}, versionId: "61000000-0000-4000-8000-000000000016",
};

writeFileSync(join(outputDir, "ghl-contact-sync.v1.json"), `${JSON.stringify(workflow, null, 2)}\n`);
writeFileSync(join(outputDir, "governed-ghl-actions.v1.json"), `${JSON.stringify(actionWorkflow, null, 2)}\n`);
writeFileSync(join(outputDir, "conversation-intelligence.v1.json"), `${JSON.stringify(conversationWorkflow, null, 2)}\n`);
