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
