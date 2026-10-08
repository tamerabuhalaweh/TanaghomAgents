// Config-driven HTTP image provider adapter. No hardcoded provider, model,
// or key: the caller supplies an allowlisted endpoint record plus a secret
// obtained from the environment at runtime. Tested against a localhost stub
// that mimics the fal.ai schnell response shape; vendor pixels require a
// real key and stay behind external acceptance.
export class ProviderAdapterError extends Error {
  constructor(errorClass, message, options = {}) {
    super(message);
    this.name = "ProviderAdapterError";
    this.errorClass = errorClass;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.requestId = options.requestId ?? null;
  }
}

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

function classifyStatus(status, bodyText) {
  if (status === 429) return { errorClass: "capacity", message: `provider rate limited: ${bodyText.slice(0, 200)}` };
  if (status >= 500) return { errorClass: "transient", message: `provider unavailable (${status}): ${bodyText.slice(0, 200)}` };
  return { errorClass: "deterministic", message: `provider rejected request (${status}): ${bodyText.slice(0, 200)}` };
}

export function normalizeImageRequest({ prompt, width = 1024, height = 1024, variants = 1, seed = null }) {
  if (typeof prompt !== "string" || prompt.trim().length < 1 || prompt.length > 4000) {
    throw new ProviderAdapterError("deterministic", "prompt must be 1..4000 characters");
  }
  for (const [name, value] of [["width", width], ["height", height]]) {
    if (!Number.isInteger(value) || value < 256 || value > 2048) {
      throw new ProviderAdapterError("deterministic", `${name} must be an integer 256..2048`);
    }
  }
  if (!Number.isInteger(variants) || variants < 1 || variants > 4) {
    throw new ProviderAdapterError("deterministic", "variants must be an integer 1..4");
  }
  return { prompt: prompt.trim(), width, height, variants, seed };
}

export function assertAllowlisted(allowlist, model) {
  const entry = (allowlist ?? []).find((item) => item.model === model);
  if (!entry) throw new ProviderAdapterError("policy", `model not allowlisted: ${model}`);
  return entry;
}

export async function executeImageRequest({ endpoint, apiKey, request, timeoutMs = 120000, fetchImpl = fetch }) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${apiKey}` },
      body: JSON.stringify({
        prompt: request.prompt,
        image_size: { width: request.width, height: request.height },
        num_images: request.variants,
        ...(request.seed === null ? {} : { seed: request.seed }),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new ProviderAdapterError("indeterminate", `provider call failed before a billable verdict: ${error?.message ?? error}`);
  } finally {
    clearTimeout(timer);
  }
  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    const classified = classifyStatus(response.status, bodyText);
    throw new ProviderAdapterError(classified.errorClass, classified.message, { status: response.status });
  }
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new ProviderAdapterError("deterministic", "provider returned malformed JSON");
  }
  const images = Array.isArray(payload?.images) ? payload.images : [];
  if (images.length === 0 || typeof images[0]?.url !== "string") {
    throw new ProviderAdapterError("deterministic", "provider returned no image artifact");
  }
  return {
    images: images.map((image) => ({ url: image.url, contentType: image.content_type ?? null })),
    requestId: response.headers?.get?.("x-fal-request-id") ?? null,
    latencyMs: Date.now() - startedAt,
  };
}

export function createHttpImageAdapter({ name, endpoint, apiKey, model, modelVersion, timeoutMs = 120000, fetchImpl = fetch }) {
  if (!name || !endpoint || !apiKey || !model) throw new Error("http_adapter_config_incomplete");
  // Production endpoints must be https. Plain http is accepted only for
  // loopback test doubles (127.0.0.1/localhost); never for real providers.
  const https = /^https:\/\//.test(endpoint);
  const loopbackHttp = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(endpoint);
  if (!https && !loopbackHttp) throw new Error("http_adapter_endpoint_must_be_https");
  return Object.freeze({
    name,
    capabilities: Object.freeze(["image"]),
    model,
    modelVersion: modelVersion ?? null,
    async execute({ prompt, width, height, variants, seed = null }) {
      const request = normalizeImageRequest({ prompt, width, height, variants, seed });
      const startedAt = Date.now();
      const result = await executeImageRequest({ endpoint, apiKey, request, timeoutMs, fetchImpl });
      return { ...result, model, modelVersion: modelVersion ?? null, elapsedMs: Date.now() - startedAt };
    },
  });
}

export function validateArtifactUrl(url, { allowedOrigins = [], testLoopback = false } = {}) {
  let parsed;
  try {
    parsed = new URL(url ?? "");
  } catch {
    throw new ProviderAdapterError("deterministic", "provider artifact URL is malformed");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ProviderAdapterError("deterministic", "provider artifact URL scheme must be http(s)");
  }
  if (parsed.username || parsed.password) {
    throw new ProviderAdapterError("deterministic", "provider artifact URL must not carry credentials");
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) throw new ProviderAdapterError("deterministic", "provider artifact URL has no host");
  if (isBlockedAddress(host) && !(testLoopback && isLoopbackHost(host))) {
    throw new ProviderAdapterError("deterministic", "provider artifact host is not retrievable");
  }
  const allowlisted = (allowedOrigins ?? []).some((origin) => {
    const candidate = String(origin).toLowerCase();
    return host === candidate || host.endsWith(`.${candidate}`);
  });
  if (!allowlisted && !(testLoopback && isLoopbackHost(host))) {
    throw new ProviderAdapterError("deterministic", "provider artifact host is not allowlisted");
  }
  if (parsed.protocol !== "https:" && !(testLoopback && isLoopbackHost(host))) {
    throw new ProviderAdapterError("deterministic", "provider artifact URL must be https");
  }
  return { host, protocol: parsed.protocol };
}

function isLoopbackHost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isBlockedAddress(host) {
  if (isLoopbackHost(host)) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    return false;
  }
  if (host.includes(":")) {
    const lower = host.toLowerCase();
    return lower === "::" || lower.startsWith("fe80:") || lower.startsWith("fec0:") || lower.startsWith("fc00:") || lower.startsWith("fd");
  }
  return false;
}

async function fetchValidatedArtifact({ url, options, redirectBudget = 3 }) {
  validateArtifactUrl(url, options);
  const response = await options.fetchImpl(url, { ...(options.init ?? {}), redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    if (redirectBudget <= 0) {
      throw new ProviderAdapterError("deterministic", "provider artifact redirect chain too long");
    }
    const location = response.headers?.get?.("location");
    if (!location) throw new ProviderAdapterError("deterministic", "provider artifact redirect has no location");
    return fetchValidatedArtifact({ url: new URL(location, url).toString(), options, redirectBudget: redirectBudget - 1 });
  }
  return response;
}

export async function downloadArtifact({ url, maxBytes = MAX_RESPONSE_BYTES, timeoutMs = 120000, fetchImpl = fetch, allowedOrigins = [], testLoopback = false }) {
  validateArtifactUrl(url, { allowedOrigins, testLoopback });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchValidatedArtifact({
      url,
      options: {
        fetchImpl, allowedOrigins, testLoopback,
        init: { signal: controller.signal },
      },
    });
    if (!response.ok) throw new ProviderAdapterError("transient", `artifact download failed (${response.status})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > maxBytes) {
      throw new ProviderAdapterError("deterministic", "artifact byte size out of bounds");
    }
    return { bytes: buffer, contentType: response.headers?.get?.("content-type") ?? null };
  } catch (error) {
    if (error instanceof ProviderAdapterError) throw error;
    throw new ProviderAdapterError("indeterminate", `artifact download failed before a verdict: ${error?.message ?? error}`);
  } finally {
    clearTimeout(timer);
  }
}
