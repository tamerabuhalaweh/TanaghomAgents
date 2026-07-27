import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { database } from "@/lib/server/database";
import { decryptCredential } from "@/lib/server/integration-crypto";
import {
  createPostizDraft,
  executeGhlAction,
  getPostizPostAnalytics,
  IntegrationProviderError,
  upsertGhlContact,
  validateGhlActionDispatch,
  validateProviderBaseUrl,
} from "@/lib/server/integration-providers";
import { noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

type Dispatch = {
  dispatch_id: string;
  invocation_id: string;
  organization_id: string;
  connection_id: string;
  provider: "postiz" | "ghl";
  operation: string;
  executor_ref: string;
  parameters: Record<string, unknown>;
};

type Connection = {
  base_url: string;
  configuration: Record<string, unknown>;
  credential_ciphertext: Buffer;
  credential_nonce: Buffer;
  credential_auth_tag: Buffer;
  credential_key_version: number;
};

function workerAuthorized(request: NextRequest) {
  const configured = process.env.INTEGRATION_WORKER_TOKEN || "";
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (configured.length < 32 || supplied.length !== configured.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(configured));
}

function uuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function exactRequest(value: unknown): value is {
  contract_version: "phase7.agent-provider-dispatch.v1";
  invocation_id: string;
  parameter_hash: string;
  idempotency_key: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).sort().join("|")
      === ["contract_version", "idempotency_key", "invocation_id", "parameter_hash"].sort().join("|")
    && body.contract_version === "phase7.agent-provider-dispatch.v1"
    && uuid(body.invocation_id)
    && typeof body.parameter_hash === "string"
    && /^sha256:[a-f0-9]{64}$/.test(body.parameter_hash)
    && typeof body.idempotency_key === "string"
    && /^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/.test(body.idempotency_key);
}

function providerReference(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  const reference = value.postId ?? value.id ?? value.messageId
    ?? (value.contact as Record<string, unknown> | undefined)?.id
    ?? (value.appointment as Record<string, unknown> | undefined)?.id
    ?? (value.opportunity as Record<string, unknown> | undefined)?.id
    ?? value.reference;
  return typeof reference === "string" && reference.trim()
    ? reference.trim().slice(0, 300) : null;
}

function normalizePostizMetrics(value: unknown) {
  if (!Array.isArray(value) || value.length > 250) {
    throw new IntegrationProviderError("postiz_analytics_invalid_response", 502);
  }
  const aliases: Record<string, string> = {
    impression: "impressions", impressions: "impressions",
    click: "clicks", clicks: "clicks", "link clicks": "clicks",
    like: "likes", likes: "likes", reaction: "likes", reactions: "likes",
    comment: "comments", comments: "comments", share: "shares", shares: "shares",
    view: "views", views: "views", reach: "reach",
    follower: "followers", followers: "followers",
  };
  const metrics: Array<Record<string, unknown>> = [];
  for (const rawSeries of value) {
    if (!rawSeries || typeof rawSeries !== "object" || Array.isArray(rawSeries)) {
      throw new IntegrationProviderError("postiz_analytics_invalid_series", 502);
    }
    const series = rawSeries as Record<string, unknown>;
    if (typeof series.label !== "string" || !Array.isArray(series.data) || series.data.length > 500) {
      throw new IntegrationProviderError("postiz_analytics_invalid_series", 502);
    }
    const label = series.label.trim().slice(0, 160);
    const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const metricKey = aliases[normalized] ?? normalized.replace(/\s+/g, "_").slice(0, 80);
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(metricKey)) continue;
    for (const rawPoint of series.data) {
      const point = rawPoint as Record<string, unknown> | null;
      const observedOn = typeof point?.date === "string" ? point.date.slice(0, 10) : "";
      const numeric = Number(String(point?.total ?? "").replaceAll(",", ""));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) || !Number.isFinite(numeric) || numeric < 0) {
        throw new IntegrationProviderError("postiz_analytics_invalid_point", 502);
      }
      const amount = Number.isInteger(numeric)
        ? String(numeric) : numeric.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
      const change = Number(series.percentageChange);
      metrics.push({
        metric_key: metricKey,
        metric_label: label,
        observed_on: observedOn,
        value: amount,
        percentage_change: Number.isFinite(change) ? change : null,
        provider_metadata: {},
      });
    }
  }
  return { contract_version: "phase4.postiz-performance-result.v1", metrics };
}

async function executeProvider(
  dispatch: Dispatch,
  connection: Connection,
  secret: string,
) {
  const baseUrl = validateProviderBaseUrl(dispatch.provider, connection.base_url);
  const parameters = dispatch.parameters;

  if (dispatch.operation === "postiz.draft.create"
      && dispatch.executor_ref === "postiz_draft_publisher") {
    if (parameters.contract_version !== "tanaghom.postiz-draft-command.v1"
        || parameters.organization_id !== dispatch.organization_id
        || !uuid(parameters.job_id) || !uuid(parameters.content_item_id)
        || typeof parameters.provider_integration_id !== "string"
        || !new Set(["facebook", "instagram", "linkedin", "tiktok", "youtube", "x"])
          .has(String(parameters.channel))
        || typeof parameters.copy !== "string" || !parameters.copy.length
        || parameters.copy.length > 20_000) {
      throw new IntegrationProviderError("agent_runtime_postiz_draft_invalid");
    }
    const requestBody = {
      type: "draft",
      date: new Date().toISOString(),
      shortLink: false,
      tags: [],
      posts: [{
        integration: { id: parameters.provider_integration_id },
        value: [{
          content: parameters.copy,
          image: typeof parameters.media_url === "string" ? [parameters.media_url] : [],
        }],
        settings: { __type: parameters.channel },
      }],
    };
    const response = await createPostizDraft(baseUrl, secret, requestBody);
    const reference = providerReference(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300 && !reference) {
      throw new IntegrationProviderError("postiz_invalid_response", 502);
    }
    return {
      ...response,
      providerReference: reference,
      output: {
        contract_version: "tanaghom.postiz-draft-result.v1",
        job_id: parameters.job_id,
        organization_id: dispatch.organization_id,
        content_item_id: parameters.content_item_id,
        outcome: response.statusCode >= 200 && response.statusCode < 300
          ? "draft_created" : "indeterminate",
        provider_operation_id: reference,
        evidence: { dispatch_id: dispatch.dispatch_id },
      },
    };
  }

  if (dispatch.operation === "postiz.performance.read"
      && dispatch.executor_ref === "postiz_performance_monitor") {
    if (parameters.contract_version !== "phase4.postiz-performance-job.v1"
        || parameters.organization_id !== dispatch.organization_id
        || !uuid(parameters.post_id)
        || !Number.isInteger(parameters.lookback_days)
        || Number(parameters.lookback_days) < 1 || Number(parameters.lookback_days) > 90) {
      throw new IntegrationProviderError("agent_runtime_postiz_analytics_invalid");
    }
    const post = await database().query<{ provider_post_id: string }>(
      `SELECT post.provider_post_id
         FROM tanaghom.posts post
         JOIN tanaghom.content_items content ON content.id=post.content_item_id
         JOIN tanaghom.campaigns campaign ON campaign.id=content.campaign_id
        WHERE post.id=$1 AND campaign.organization_id=$2
          AND post.provider='postiz' AND post.provider_post_id IS NOT NULL`,
      [parameters.post_id, dispatch.organization_id],
    );
    if (!post.rows[0]) throw new IntegrationProviderError("postiz_post_not_found", 404);
    const response = await getPostizPostAnalytics(
      baseUrl,
      secret,
      post.rows[0].provider_post_id,
      Number(parameters.lookback_days),
    );
    return {
      ...response,
      providerReference: post.rows[0].provider_post_id,
      output: normalizePostizMetrics(response.body),
    };
  }

  if (dispatch.operation === "ghl.contact.upsert"
      && dispatch.executor_ref === "ghl_contact_sync") {
    if (parameters.contract_version !== "phase5.ghl-contact-upsert-job.v1"
        || parameters.organization_id !== dispatch.organization_id
        || !uuid(parameters.lead_id) || !Number.isInteger(parameters.sync_version)
        || Number(parameters.sync_version) < 1) {
      throw new IntegrationProviderError("agent_runtime_ghl_contact_invalid");
    }
    const lead = await database().query<{
      name: string | null;
      contact_email: string | null;
      contact_phone: string | null;
    }>(
      `SELECT lead.name,lead.contact_email,lead.contact_phone
         FROM tanaghom.leads lead
         JOIN tanaghom.campaigns campaign ON campaign.id=lead.campaign_id
        WHERE lead.id=$1 AND campaign.organization_id=$2`,
      [parameters.lead_id, dispatch.organization_id],
    );
    const locationId = connection.configuration.location_id;
    if (!lead.rows[0] || typeof locationId !== "string"
        || !/^[A-Za-z0-9_-]{3,100}$/.test(locationId)) {
      throw new IntegrationProviderError("ghl_contact_source_not_found", 404);
    }
    const requestBody = {
      ...(lead.rows[0].name ? { name: lead.rows[0].name } : {}),
      ...(lead.rows[0].contact_email ? { email: lead.rows[0].contact_email } : {}),
      ...(lead.rows[0].contact_phone ? { phone: lead.rows[0].contact_phone } : {}),
      locationId,
      source: "Tanaghom",
      createNewIfDuplicateAllowed: false,
    };
    const response = await upsertGhlContact(baseUrl, secret, requestBody);
    const body = response.body as { contact?: { id?: unknown; locationId?: unknown }; new?: unknown };
    const contactId = typeof body?.contact?.id === "string" ? body.contact.id.trim() : "";
    const resultLocation = typeof body?.contact?.locationId === "string"
      ? body.contact.locationId.trim() : "";
    if (response.statusCode >= 200 && response.statusCode < 300
        && (!contactId || resultLocation !== locationId)) {
      throw new IntegrationProviderError("ghl_invalid_response", 502);
    }
    return {
      ...response,
      providerReference: contactId || null,
      output: {
        contract_version: "phase5.ghl-contact-upsert-result.v1",
        provider_contact_id: contactId,
        location_id: resultLocation,
        created: body?.new === true,
      },
    };
  }

  if (dispatch.operation.startsWith("ghl.")
      && dispatch.operation.endsWith(".execute")
      && dispatch.executor_ref === "governed_ghl_actions") {
    if (parameters.contract_version !== "phase5.ghl-action-job.v1"
        || parameters.organization_id !== dispatch.organization_id
        || !uuid(parameters.conversation_id)
        || typeof parameters.contact_id !== "string"
        || typeof parameters.action_type !== "string"
        || !parameters.payload || typeof parameters.payload !== "object"
        || Array.isArray(parameters.payload)) {
      throw new IntegrationProviderError("agent_runtime_ghl_action_invalid");
    }
    const expectedOperation = new Set(["won", "lost"]).has(parameters.action_type)
      ? "ghl.status.execute" : `ghl.${parameters.action_type}.execute`;
    if (dispatch.operation !== expectedOperation) {
      throw new IntegrationProviderError("agent_runtime_ghl_operation_mismatch");
    }
    const locationId = connection.configuration.location_id;
    if (typeof locationId !== "string" || !/^[A-Za-z0-9_-]{3,100}$/.test(locationId)) {
      throw new IntegrationProviderError("ghl_location_id_required");
    }
    const requestBody = validateGhlActionDispatch({
      contract_version: "phase5.ghl-action-dispatch.v1",
      action_type: parameters.action_type,
      contact_id: parameters.contact_id,
      conversation_id: parameters.conversation_id,
      channel: parameters.channel ?? "system",
      payload: parameters.payload,
    });
    const response = await executeGhlAction(baseUrl, secret, requestBody, locationId);
    const reference = providerReference(response.body);
    return {
      ...response,
      providerReference: reference,
      output: {
        contract_version: "phase5.ghl-action-result.v1",
        outcome: "succeeded",
        provider_reference: reference,
        provider_payload: response.body && typeof response.body === "object"
          && !Array.isArray(response.body) ? response.body : {},
      },
    };
  }

  throw new IntegrationProviderError("agent_runtime_provider_operation_not_reviewed", 403);
}

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) {
    return noStore({ error: "worker_authentication_required", dispatch_started: false }, { status: 401 });
  }
  if (process.env.AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED !== "true") {
    return noStore({ error: "agent_runtime_provider_execution_disabled", dispatch_started: false }, { status: 503 });
  }
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return noStore({ error: "invalid_json", dispatch_started: false }, { status: 400 }); }
  if (!exactRequest(raw)) {
    return noStore({ error: "invalid_gateway_request", dispatch_started: false }, { status: 400 });
  }

  let dispatch: Dispatch | undefined;
  try {
    const started = await database().query<Dispatch>(
      `SELECT * FROM tanaghom.begin_agent_runtime_provider_dispatch($1::uuid,$2::text,$3::text)`,
      [raw.invocation_id, raw.parameter_hash, raw.idempotency_key],
    );
    dispatch = started.rows[0];
    if (!dispatch) throw new IntegrationProviderError("agent_runtime_dispatch_not_authorized", 409);
    const connectionResult = await database().query<Connection>(
      `SELECT base_url,configuration,credential_ciphertext,credential_nonce,
              credential_auth_tag,credential_key_version
         FROM tanaghom.integration_connections
        WHERE id=$1 AND organization_id=$2 AND provider=$3 AND status='connected'
          AND last_test_status='passed'`,
      [dispatch.connection_id, dispatch.organization_id, dispatch.provider],
    );
    const connection = connectionResult.rows[0];
    if (!connection) throw new IntegrationProviderError("agent_runtime_connection_not_ready", 409);
    const secret = decryptCredential(connection);
    const result = await executeProvider(dispatch, connection, secret);
    const responseBody = {
      contract_version: "phase7.agent-provider-result.v1",
      dispatch_started: true,
      dispatch_id: dispatch.dispatch_id,
      invocation_id: dispatch.invocation_id,
      provider: dispatch.provider,
      operation: dispatch.operation,
      provider_reference: result.providerReference,
      output: result.output,
      ...(result.statusCode >= 200 && result.statusCode < 300
        ? {} : { error: "provider_request_rejected" }),
    };
    return noStore(responseBody, { status: result.statusCode });
  } catch (error) {
    const started = Boolean(dispatch);
    const code = error instanceof IntegrationProviderError
      ? error.code
      : error instanceof Error && /^[A-Za-z0-9_ ;.-]+$/.test(error.message)
        ? error.message.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 120)
        : "agent_runtime_gateway_unavailable";
    const status = started ? 502 : error instanceof IntegrationProviderError ? error.status : 409;
    return noStore({
      error: code,
      dispatch_started: started,
      dispatch_id: dispatch?.dispatch_id ?? null,
      invocation_id: dispatch?.invocation_id ?? raw.invocation_id,
    }, { status });
  }
}
