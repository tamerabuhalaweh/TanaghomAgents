import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, "n8n", "workflows", "phase5");
mkdirSync(outputDir, { recursive: true });

const postgresCredential = { postgres: { id: "62000000-0000-4000-8000-000000000001", name: "Tanaghom Worker PostgreSQL" } };
const gatewayCredential = { httpHeaderAuth: { id: "62000000-0000-4000-8000-000000000004", name: "Tanaghom Integration Gateway" } };

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

writeFileSync(join(outputDir, "ghl-contact-sync.v1.json"), `${JSON.stringify(workflow, null, 2)}\n`);
writeFileSync(join(outputDir, "governed-ghl-actions.v1.json"), `${JSON.stringify(actionWorkflow, null, 2)}\n`);
