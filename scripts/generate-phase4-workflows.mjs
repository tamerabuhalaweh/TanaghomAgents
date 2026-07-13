import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, "n8n", "workflows", "phase4");
mkdirSync(outputDir, { recursive: true });

const postgresCredential = {
  postgres: { id: "62000000-0000-4000-8000-000000000001", name: "Tanaghom Worker PostgreSQL" },
};
const gatewayCredential = {
  httpHeaderAuth: { id: "62000000-0000-4000-8000-000000000004", name: "Tanaghom Integration Gateway" },
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
      query: "SELECT * FROM tanaghom.claim_postiz_draft_job();",
      options: {},
    }, { credentials: postgresCredential }),
    node("postiz-prepare", "Prepare Postiz Draft", "n8n-nodes-base.postgres", 2.6, [480, 270], {
      operation: "executeQuery",
      query: "SELECT * FROM tanaghom.prepare_postiz_draft($1::uuid);",
      options: { queryReplacement: "={{ [$json.job_id] }}" },
    }, { credentials: postgresCredential }),
    node("postiz-request", "Create Postiz Draft", "n8n-nodes-base.httpRequest", 4.2, [720, 270], {
      method: "POST",
      url: "={{ $env.TANAGHOM_INTEGRATION_GATEWAY_URL }}/api/internal/integrations/postiz/draft",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: "Idempotency-Key", value: "={{ $json.idempotency_key }}" }],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ job_id: $json.job_id, request_body: $json.request_body }) }}",
      options: {
        timeout: 60000,
        response: { response: { fullResponse: true, neverError: true } },
      },
    }, { credentials: gatewayCredential, onError: "continueRegularOutput" }),
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
    saveDataSuccessExecution: "none",
    executionTimeout: 120,
  },
  meta: { templateCredsSetupCompleted: false },
  tags: [],
  pinData: {},
  versionId: "61000000-0000-4000-8000-000000000004",
};

writeFileSync(
  join(outputDir, "postiz-draft-publisher.v1.json"),
  `${JSON.stringify(workflow, null, 2)}\n`,
);

const normalizeAnalyticsCode = `const prepared = $('Prepare Analytics Request').first().json;
const response = $json;
if (response?.error) {
  return [{ json: { ...prepared, ok: false, error_code: 'postiz_analytics_network_error', error_message: String(response.error.message ?? response.error).slice(0, 1000), http_status: 0, retry_after_seconds: 300 } }];
}
const statusCode = Number(response.statusCode ?? response.status ?? 200);
const body = response.body ?? response;
if (statusCode < 200 || statusCode >= 300) {
  return [{ json: { ...prepared, ok: false, error_code: statusCode === 429 ? 'postiz_analytics_rate_limited' : 'postiz_analytics_http_error', error_message: String(body?.message ?? body?.error ?? statusCode).slice(0, 1000), http_status: statusCode, retry_after_seconds: statusCode === 429 ? 3600 : 300 } }];
}
if (!Array.isArray(body) || body.length > 250) {
  return [{ json: { ...prepared, ok: false, error_code: 'postiz_analytics_invalid_response', error_message: 'Postiz analytics response must be a bounded array', http_status: statusCode, retry_after_seconds: 300 } }];
}
const aliases = { impression: 'impressions', impressions: 'impressions', click: 'clicks', clicks: 'clicks', 'link clicks': 'clicks', like: 'likes', likes: 'likes', reaction: 'likes', reactions: 'likes', comment: 'comments', comments: 'comments', share: 'shares', shares: 'shares', view: 'views', views: 'views', reach: 'reach', follower: 'followers', followers: 'followers' };
const metrics = [];
for (const series of body) {
  if (!series || typeof series !== 'object' || typeof series.label !== 'string' || !Array.isArray(series.data) || series.data.length > 500) {
    return [{ json: { ...prepared, ok: false, error_code: 'postiz_analytics_invalid_series', error_message: 'Postiz returned an invalid analytics series', http_status: statusCode, retry_after_seconds: 300 } }];
  }
  const label = series.label.trim().slice(0, 160);
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const metricKey = aliases[normalized] ?? normalized.replace(/\s+/g, '_').slice(0, 80);
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(metricKey)) continue;
  for (const point of series.data) {
    const observedOn = typeof point?.date === 'string' ? point.date.slice(0, 10) : '';
    const numeric = Number(String(point?.total ?? '').replaceAll(',', ''));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || !Number.isFinite(numeric) || numeric < 0) {
      return [{ json: { ...prepared, ok: false, error_code: 'postiz_analytics_invalid_point', error_message: 'Postiz returned an invalid dated metric value', http_status: statusCode, retry_after_seconds: 300 } }];
    }
    const value = Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    metrics.push({ metric_key: metricKey, metric_label: label, observed_on: observedOn, value, percentage_change: Number.isFinite(Number(series.percentageChange)) ? Number(series.percentageChange) : null, provider_metadata: {} });
  }
}
return [{ json: { ...prepared, ok: true, result: { contract_version: 'phase4.postiz-performance-result.v1', metrics } } }];`;

const performanceWorkflow = {
  id: "phase4PostizPerformanceV1",
  name: "Tanaghom — Postiz Performance Monitor v1",
  active: false,
  nodes: [
    node("performance-manual", "Manual Performance Trigger", "n8n-nodes-base.manualTrigger", 1, [0, 180], {}),
    node("performance-schedule", "Performance Polling Disabled", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 360], {
      rule: { interval: [{ field: "hours", hoursInterval: 6 }] },
    }, { disabled: true }),
    node("performance-claim", "Claim Performance Job", "n8n-nodes-base.postgres", 2.6, [240, 270], {
      operation: "executeQuery",
      query: "SELECT * FROM tanaghom.claim_postiz_performance_job();",
      options: {},
    }, { credentials: postgresCredential }),
    node("performance-prepare", "Prepare Analytics Request", "n8n-nodes-base.postgres", 2.6, [480, 270], {
      operation: "executeQuery",
      query: "SELECT * FROM tanaghom.prepare_postiz_performance_sync($1::uuid);",
      options: { queryReplacement: "={{ [$json.job_id] }}" },
    }, { credentials: postgresCredential }),
    node("performance-request", "Fetch Postiz Analytics", "n8n-nodes-base.httpRequest", 4.2, [720, 270], {
      method: "POST",
      url: "={{ $env.TANAGHOM_INTEGRATION_GATEWAY_URL }}/api/internal/integrations/postiz/analytics",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Idempotency-Key", value: "={{ $json.idempotency_key }}" }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ job_id: $json.job_id, request_body: $json.request_body }) }}",
      options: { timeout: 60000, response: { response: { fullResponse: true, neverError: true } } },
    }, { credentials: gatewayCredential, onError: "continueRegularOutput" }),
    node("performance-normalize", "Normalize Analytics Response", "n8n-nodes-base.code", 2, [960, 270], { jsCode: normalizeAnalyticsCode }),
    node("performance-valid", "Analytics Valid?", "n8n-nodes-base.if", 2.2, [1200, 270], {
      conditions: { options: { caseSensitive: true, typeValidation: "strict" }, conditions: [{
        id: "performance-ok", leftValue: "={{ $json.ok }}", rightValue: true,
        operator: { type: "boolean", operation: "equals" },
      }], combinator: "and" }, options: {},
    }),
    node("performance-complete", "Record Performance", "n8n-nodes-base.postgres", 2.6, [1440, 180], {
      operation: "executeQuery",
      query: "SELECT tanaghom.complete_postiz_performance_sync($1::uuid, $2::jsonb) AS metric_points;",
      options: { queryReplacement: "={{ [$json.job_id, JSON.stringify($json.result)] }}" },
    }, { credentials: postgresCredential }),
    node("performance-failure", "Record Analytics Failure", "n8n-nodes-base.postgres", 2.6, [1440, 360], {
      operation: "executeQuery",
      query: "SELECT tanaghom.record_postiz_performance_failure($1::uuid, $2::text, $3::text, $4::integer, $5::integer) AS next_status;",
      options: { queryReplacement: "={{ [$json.job_id, $json.error_code, $json.error_message, $json.http_status, $json.retry_after_seconds] }}" },
    }, { credentials: postgresCredential }),
  ],
  connections: {
    "Manual Performance Trigger": { main: [[{ node: "Claim Performance Job", type: "main", index: 0 }]] },
    "Performance Polling Disabled": { main: [[{ node: "Claim Performance Job", type: "main", index: 0 }]] },
    "Claim Performance Job": { main: [[{ node: "Prepare Analytics Request", type: "main", index: 0 }]] },
    "Prepare Analytics Request": { main: [[{ node: "Fetch Postiz Analytics", type: "main", index: 0 }]] },
    "Fetch Postiz Analytics": { main: [[{ node: "Normalize Analytics Response", type: "main", index: 0 }]] },
    "Normalize Analytics Response": { main: [[{ node: "Analytics Valid?", type: "main", index: 0 }]] },
    "Analytics Valid?": { main: [
      [{ node: "Record Performance", type: "main", index: 0 }],
      [{ node: "Record Analytics Failure", type: "main", index: 0 }],
    ] },
  },
  settings: {
    executionOrder: "v1",
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "none",
    executionTimeout: 120,
  },
  meta: { templateCredsSetupCompleted: false },
  tags: [],
  pinData: {},
  versionId: "61000000-0000-4000-8000-000000000005",
};

writeFileSync(
  join(outputDir, "postiz-performance-monitor.v1.json"),
  `${JSON.stringify(performanceWorkflow, null, 2)}\n`,
);
