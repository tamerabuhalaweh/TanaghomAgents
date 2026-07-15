import "server-only";

export type IntegrationProvider = "postiz" | "ghl";

export interface DiscoveredPostizChannel {
  id: string;
  name: string;
  identifier: string;
  profile: string;
  disabled: boolean;
}

export interface ProviderTestResult {
  accountLabel: string;
  channels?: DiscoveredPostizChannel[];
}

export interface GhlActionDispatch {
  contract_version: "phase5.ghl-action-dispatch.v1";
  action_type: "message" | "qualification" | "tag" | "assignment" | "appointment" | "opportunity" | "nurture" | "won" | "lost";
  contact_id: string;
  conversation_id: string;
  channel: "whatsapp" | "sms" | "email" | "instagram" | "facebook" | "live_chat" | "system";
  payload: Record<string, unknown>;
}

export class IntegrationProviderError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code);
  }
}

const definitions = {
  postiz: {
    label: "Postiz",
    defaultBaseUrl: "https://api.postiz.com/public/v1",
    credentialKind: "api_key",
  },
  ghl: {
    label: "GoHighLevel",
    defaultBaseUrl: "https://services.leadconnectorhq.com",
    credentialKind: "private_token",
  },
} as const;

export function providerDefinition(provider: IntegrationProvider) {
  return definitions[provider];
}

export function parseProvider(value: string): IntegrationProvider {
  if (value !== "postiz" && value !== "ghl") {
    throw new IntegrationProviderError("integration_provider_invalid");
  }
  return value;
}

function normalizeProviderBaseUrl(provider: IntegrationProvider, rawUrl: string) {
  let parsed: URL;
  try { parsed = new URL(rawUrl.trim()); }
  catch { throw new IntegrationProviderError("integration_base_url_invalid"); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new IntegrationProviderError("integration_base_url_invalid");
  }
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (provider === "postiz" && pathname.endsWith("/is-connected")) {
    pathname = pathname.slice(0, -"/is-connected".length).replace(/\/+$/, "");
  }
  return `${parsed.origin}${pathname}`;
}

function configuredBaseUrls(provider: IntegrationProvider) {
  const variable = provider === "postiz" ? "POSTIZ_ALLOWED_BASE_URLS" : "GHL_ALLOWED_BASE_URLS";
  return (process.env[variable] || "").split(",").map((value) => value.trim()).filter(Boolean);
}

function testBaseUrls(provider: IntegrationProvider) {
  if (!new Set(["test", "integration"]).has(process.env.APP_ENV || "")) return new Set<string>();
  return new Set((process.env.INTEGRATION_TEST_BASE_URLS || "").split(",")
    .map((value) => value.trim()).filter(Boolean)
    .map((value) => normalizeProviderBaseUrl(provider, value)));
}

export function validateProviderBaseUrl(provider: IntegrationProvider, rawUrl?: string) {
  const expected = definitions[provider].defaultBaseUrl;
  const candidate = normalizeProviderBaseUrl(provider, rawUrl || expected);
  const testUrls = testBaseUrls(provider);
  const allowed = new Set([
    expected,
    ...configuredBaseUrls(provider).map((value) => normalizeProviderBaseUrl(provider, value)),
    ...testUrls,
  ]);
  if (!allowed.has(candidate)) {
    throw new IntegrationProviderError("integration_base_url_not_allowed", 403);
  }
  if (!candidate.startsWith("https://") && !testUrls.has(candidate)) {
    throw new IntegrationProviderError("integration_base_url_https_required");
  }
  return candidate;
}

async function providerFetch(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store", redirect: "error" });
  } catch {
    throw new IntegrationProviderError("integration_provider_unreachable", 502);
  } finally {
    clearTimeout(timer);
  }
}

async function jsonBody(response: Response) {
  const text = await response.text();
  if (text.length > 1_000_000) throw new IntegrationProviderError("integration_response_too_large", 502);
  try { return text ? JSON.parse(text) as unknown : {}; }
  catch { throw new IntegrationProviderError("integration_response_invalid", 502); }
}

export async function testProviderConnection(
  provider: IntegrationProvider,
  baseUrl: string,
  secret: string,
  configuration: Record<string, unknown>,
): Promise<ProviderTestResult> {
  if (provider === "postiz") {
    const statusResponse = await providerFetch(`${baseUrl}/is-connected`, {
      headers: { Authorization: secret, Accept: "application/json" },
    });
    const status = await jsonBody(statusResponse) as { connected?: boolean };
    if (!statusResponse.ok || status.connected !== true) {
      throw new IntegrationProviderError(statusResponse.status === 401 ? "integration_credential_rejected" : "integration_test_failed", 422);
    }
    const channelsResponse = await providerFetch(`${baseUrl}/integrations`, {
      headers: { Authorization: secret, Accept: "application/json" },
    });
    const rawChannels = await jsonBody(channelsResponse);
    if (!channelsResponse.ok || !Array.isArray(rawChannels)) {
      throw new IntegrationProviderError("integration_channel_discovery_failed", 502);
    }
    const channels = rawChannels.slice(0, 250).flatMap((entry): DiscoveredPostizChannel[] => {
      if (!entry || typeof entry !== "object") return [];
      const channel = entry as Record<string, unknown>;
      if (typeof channel.id !== "string" || typeof channel.identifier !== "string") return [];
      return [{
        id: channel.id.slice(0, 300),
        name: typeof channel.name === "string" ? channel.name.slice(0, 160) : channel.identifier,
        identifier: channel.identifier.slice(0, 80),
        profile: typeof channel.profile === "string" ? channel.profile.slice(0, 160) : "",
        disabled: channel.disabled === true,
      }];
    });
    return { accountLabel: channels[0]?.name || "Connected Postiz workspace", channels };
  }

  const locationId = typeof configuration.location_id === "string" ? configuration.location_id.trim() : "";
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(locationId)) {
    throw new IntegrationProviderError("ghl_location_id_required");
  }
  const response = await providerFetch(`${baseUrl}/locations/${encodeURIComponent(locationId)}`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
      Version: "v3",
    },
  });
  const body = await jsonBody(response) as { location?: { name?: string } };
  if (!response.ok) {
    throw new IntegrationProviderError(response.status === 401 ? "integration_credential_rejected" : "integration_test_failed", 422);
  }
  return { accountLabel: body.location?.name?.slice(0, 160) || `Location ${locationId}` };
}

export async function createPostizDraft(baseUrl: string, secret: string, requestBody: unknown) {
  const response = await providerFetch(`${baseUrl}/posts`, {
    method: "POST",
    headers: { Authorization: secret, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  return { statusCode: response.status, body: await jsonBody(response) };
}

export async function getPostizPostAnalytics(
  baseUrl: string,
  secret: string,
  providerPostId: string,
  lookbackDays: number,
) {
  if (!providerPostId || providerPostId.length > 300 || !Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 90) {
    throw new IntegrationProviderError("postiz_analytics_request_invalid");
  }
  const url = new URL(`${baseUrl}/analytics/post/${encodeURIComponent(providerPostId)}`);
  url.searchParams.set("date", String(lookbackDays));
  const response = await providerFetch(url.toString(), {
    headers: { Authorization: secret, Accept: "application/json" },
  });
  return { statusCode: response.status, body: await jsonBody(response) };
}

export async function upsertGhlContact(baseUrl: string, secret: string, requestBody: unknown) {
  const response = await providerFetch(`${baseUrl}/contacts/upsert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Version: "v3",
    },
    body: JSON.stringify(requestBody),
  });
  return { statusCode: response.status, body: await jsonBody(response) };
}

function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function boundedId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{3,300}$/.test(value);
}

function boundedText(value: unknown, maximum = 5000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

export function validateGhlActionDispatch(value: unknown): GhlActionDispatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IntegrationProviderError("ghl_action_request_invalid");
  }
  const request = value as Record<string, unknown>;
  if (!exactKeys(request, ["contract_version", "action_type", "contact_id", "conversation_id", "channel", "payload"])
      || request.contract_version !== "phase5.ghl-action-dispatch.v1"
      || !new Set(["message", "qualification", "tag", "assignment", "appointment", "opportunity", "nurture", "won", "lost"]).has(String(request.action_type))
      || !boundedId(request.contact_id) || !boundedId(request.conversation_id)
      || !new Set(["whatsapp", "sms", "email", "instagram", "facebook", "live_chat", "system"]).has(String(request.channel))
      || !request.payload || typeof request.payload !== "object" || Array.isArray(request.payload)) {
    throw new IntegrationProviderError("ghl_action_request_invalid");
  }
  return request as unknown as GhlActionDispatch;
}

export async function executeGhlAction(
  baseUrl: string,
  secret: string,
  request: GhlActionDispatch,
  locationId: string,
) {
  const payload = request.payload;
  let method = "POST";
  let path: string;
  let body: Record<string, unknown>;

  if (request.action_type === "qualification" || request.action_type === "nurture") {
    if (!exactKeys(payload, request.action_type === "qualification"
      ? ["temperature", "reason", "confidence", "next_action"] : ["reason", "sequence_key"])) {
      throw new IntegrationProviderError("ghl_action_payload_invalid");
    }
    return {
      statusCode: 200,
      body: { internal: true, action: request.action_type, reference: `tanaghom:${request.action_type}:${request.contact_id}` },
    };
  }

  if (request.action_type === "message") {
    if (!exactKeys(payload, ["message"]) || !boundedText(payload.message)) {
      throw new IntegrationProviderError("ghl_action_payload_invalid");
    }
    const messageTypes: Partial<Record<GhlActionDispatch["channel"], string>> = {
      whatsapp: "WhatsApp", sms: "SMS", email: "Email", instagram: "IG",
      facebook: "FB", live_chat: "Live_Chat",
    };
    const messageType = messageTypes[request.channel];
    if (!messageType) throw new IntegrationProviderError("ghl_action_channel_invalid");
    path = "/conversations/messages";
    body = { type: messageType, contactId: request.contact_id, message: payload.message, status: "pending" };
  } else if (request.action_type === "tag") {
    if (!exactKeys(payload, ["tags"]) || !Array.isArray(payload.tags) || payload.tags.length < 1 || payload.tags.length > 20
        || payload.tags.some((tag) => !boundedText(tag, 80))) {
      throw new IntegrationProviderError("ghl_action_payload_invalid");
    }
    path = `/contacts/${encodeURIComponent(request.contact_id)}/tags`;
    body = { tags: payload.tags };
  } else if (request.action_type === "assignment") {
    if (!exactKeys(payload, ["assigned_to"]) || !boundedId(payload.assigned_to)) {
      throw new IntegrationProviderError("ghl_action_payload_invalid");
    }
    method = "PUT";
    path = `/contacts/${encodeURIComponent(request.contact_id)}`;
    body = { assignedTo: payload.assigned_to };
  } else if (request.action_type === "appointment") {
    if (!exactKeys(payload, ["calendar_id", "start_time", "end_time", "title", "assigned_user_id"])
        || !boundedId(payload.calendar_id) || !boundedText(payload.start_time, 80)
        || !boundedText(payload.end_time, 80) || !boundedText(payload.title, 300)
        || (payload.assigned_user_id !== undefined && !boundedId(payload.assigned_user_id))) {
      throw new IntegrationProviderError("ghl_action_payload_invalid");
    }
    path = "/calendars/events/appointments";
    body = {
      calendarId: payload.calendar_id, locationId, contactId: request.contact_id,
      startTime: payload.start_time, endTime: payload.end_time, title: payload.title,
      appointmentStatus: "confirmed",
      ...(payload.assigned_user_id ? { assignedUserId: payload.assigned_user_id } : {}),
    };
  } else if (request.action_type === "opportunity") {
    if (!exactKeys(payload, ["opportunity_id", "pipeline_id", "pipeline_stage_id", "name", "status", "monetary_value", "assigned_to"])
        || !boundedId(payload.opportunity_id) || !boundedId(payload.pipeline_id)
        || !boundedId(payload.pipeline_stage_id) || !boundedText(payload.name, 300)
        || (payload.status !== undefined && !new Set(["open", "won", "lost", "abandoned"]).has(String(payload.status)))
        || (payload.monetary_value !== undefined && (typeof payload.monetary_value !== "number" || payload.monetary_value < 0))
        || (payload.assigned_to !== undefined && !boundedId(payload.assigned_to))) {
      throw new IntegrationProviderError("ghl_action_payload_invalid");
    }
    method = "PUT";
    path = `/opportunities/${encodeURIComponent(String(payload.opportunity_id))}`;
    body = {
      pipelineId: payload.pipeline_id, pipelineStageId: payload.pipeline_stage_id,
      name: payload.name, status: payload.status || "open",
      ...(payload.monetary_value !== undefined ? { monetaryValue: payload.monetary_value } : {}),
      ...(payload.assigned_to ? { assignedTo: payload.assigned_to } : {}),
    };
  } else {
    if (!exactKeys(payload, ["opportunity_id", "reason"]) || !boundedId(payload.opportunity_id)
        || (payload.reason !== undefined && !boundedText(payload.reason, 1000))) {
      throw new IntegrationProviderError("ghl_action_payload_invalid");
    }
    method = "PUT";
    path = `/opportunities/${encodeURIComponent(String(payload.opportunity_id))}/status`;
    body = { status: request.action_type };
  }

  const response = await providerFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Version: "v3",
    },
    body: JSON.stringify(body),
  });
  return { statusCode: response.status, body: await jsonBody(response) };
}
