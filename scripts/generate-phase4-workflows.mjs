import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, "n8n", "workflows", "phase4");
mkdirSync(outputDir, { recursive: true });

const postgresCredential = {
  postgres: { id: "62000000-0000-4000-8000-000000000001", name: "Tanaghom Worker PostgreSQL" },
};
const postizCredential = {
  httpHeaderAuth: { id: "62000000-0000-4000-8000-000000000003", name: "Tanaghom Postiz Staging API" },
};

function node(id, name, type, typeVersion, position, parameters, extra = {}) {
  return { parameters, id, name, type, typeVersion, position, ...extra };
}

const parseCode = `const prepared = $('Prepare Postiz Draft').first().json;
const response = $json;
if (response?.error) {
  return [{ json: { ...prepared, ok: false, error_code: 'postiz_network_error', error_message: String(response.error.message ?? response.error).slice(0, 1000), http_status: 0, outcome_uncertain: true } }];
}
const statusCode = Number(response.statusCode ?? response.status ?? 200);
const body = response.body ?? response;
if (statusCode < 200 || statusCode >= 300) {
  return [{ json: { ...prepared, ok: false, error_code: statusCode === 429 ? 'postiz_rate_limited' : 'postiz_http_error', error_message: String(body?.message ?? body?.error ?? statusCode).slice(0, 1000), http_status: statusCode, outcome_uncertain: statusCode >= 500 } }];
}
const result = Array.isArray(body) ? body[0] : body;
const postId = result?.postId ?? result?.id;
if (typeof postId !== 'string' || !postId.trim()) {
  return [{ json: { ...prepared, ok: false, error_code: 'postiz_invalid_response', error_message: 'Postiz returned success without a post ID', http_status: statusCode, outcome_uncertain: true } }];
}
return [{ json: { ...prepared, ok: true, provider_post_id: postId.trim(), response_summary: { postId: postId.trim(), integration: String(result?.integration ?? '') } } }];`;

const workflow = {
  id: "phase4PostizDraftV1",
  name: "Tanaghom — Postiz Draft Publisher v1",
  active: false,
  nodes: [
    node("postiz-manual", "Manual Controlled Trigger", "n8n-nodes-base.manualTrigger", 1, [0, 180], {}),
    node("postiz-schedule", "Polling Disabled Pending Approval", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 360], {
      rule: { interval: [{ field: "minutes", minutesInterval: 1 }] },
    }, { disabled: true }),
    node("postiz-claim", "Claim Publisher Job", "n8n-nodes-base.postgres", 2.6, [240, 270], {
      operation: "executeQuery",
      query: "SELECT * FROM tanaghom.claim_agent_job('publisher_monitor', ARRAY['content.postiz.draft']);",
      options: {},
    }, { credentials: postgresCredential }),
    node("postiz-prepare", "Prepare Postiz Draft", "n8n-nodes-base.postgres", 2.6, [480, 270], {
      operation: "executeQuery",
      query: "SELECT * FROM tanaghom.prepare_postiz_draft($1::uuid);",
      options: { queryReplacement: "={{ [$json.job_id] }}" },
    }, { credentials: postgresCredential }),
    node("postiz-request", "Create Postiz Draft", "n8n-nodes-base.httpRequest", 4.2, [720, 270], {
      method: "POST",
      url: "https://api.postiz.com/public/v1/posts",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: "Idempotency-Key", value: "={{ $json.idempotency_key }}" }],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.request_body) }}",
      options: {
        timeout: 60000,
        response: { response: { fullResponse: true, neverError: true } },
      },
    }, { credentials: postizCredential, onError: "continueRegularOutput" }),
    node("postiz-parse", "Validate Draft Response", "n8n-nodes-base.code", 2, [960, 270], { jsCode: parseCode }),
    node("postiz-valid", "Draft Created?", "n8n-nodes-base.if", 2.2, [1200, 270], {
      conditions: {
        options: { caseSensitive: true, typeValidation: "strict" },
        conditions: [{
          id: "postiz-ok",
          leftValue: "={{ $json.ok }}",
          rightValue: true,
          operator: { type: "boolean", operation: "equals" },
        }],
        combinator: "and",
      },
      options: {},
    }),
    node("postiz-complete", "Record Postiz Draft", "n8n-nodes-base.postgres", 2.6, [1440, 180], {
      operation: "executeQuery",
      query: "SELECT tanaghom.complete_postiz_draft($1::uuid, $2::text, $3::jsonb) AS post_id;",
      options: { queryReplacement: "={{ [$json.job_id, $json.provider_post_id, JSON.stringify($json.response_summary)] }}" },
    }, { credentials: postgresCredential }),
    node("postiz-failure", "Record Safe Failure", "n8n-nodes-base.postgres", 2.6, [1440, 360], {
      operation: "executeQuery",
      query: "SELECT tanaghom.record_postiz_draft_failure($1::uuid, $2::text, $3::text, $4::integer, $5::boolean) AS next_status;",
      options: { queryReplacement: "={{ [$json.job_id, $json.error_code, $json.error_message, $json.http_status, $json.outcome_uncertain] }}" },
    }, { credentials: postgresCredential }),
  ],
  connections: {
    "Manual Controlled Trigger": { main: [[{ node: "Claim Publisher Job", type: "main", index: 0 }]] },
    "Polling Disabled Pending Approval": { main: [[{ node: "Claim Publisher Job", type: "main", index: 0 }]] },
    "Claim Publisher Job": { main: [[{ node: "Prepare Postiz Draft", type: "main", index: 0 }]] },
    "Prepare Postiz Draft": { main: [[{ node: "Create Postiz Draft", type: "main", index: 0 }]] },
    "Create Postiz Draft": { main: [[{ node: "Validate Draft Response", type: "main", index: 0 }]] },
    "Validate Draft Response": { main: [[{ node: "Draft Created?", type: "main", index: 0 }]] },
    "Draft Created?": {
      main: [
        [{ node: "Record Postiz Draft", type: "main", index: 0 }],
        [{ node: "Record Safe Failure", type: "main", index: 0 }],
      ],
    },
  },
  settings: {
    executionOrder: "v1",
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
    executionTimeout: 120,
  },
  meta: { templateCredsSetupCompleted: false },
  tags: [],
  pinData: {},
  versionId: "61000000-0000-4000-8000-000000000003",
};

writeFileSync(
  join(outputDir, "postiz-draft-publisher.v1.json"),
  `${JSON.stringify(workflow, null, 2)}\n`,
);
