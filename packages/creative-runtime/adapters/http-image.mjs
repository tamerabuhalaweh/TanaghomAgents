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

export function createHttpImageAdapter({ name, endpoint, apiKey, model, modelVersion, timeoutMs = 120000, fetchImpl = fetch, testLoopback = false }) {
  if (!name || !endpoint || !apiKey || !model) throw new Error("http_adapter_config_incomplete");
  // Production endpoints must be https. Plain-http loopback doubles require
  // an explicit test-only opt-in so production construction can never
  // accidentally point at localhost.
  const https = /^https:\/\//.test(endpoint);
  const loopbackHttp = testLoopback && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(endpoint);
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
  // IP literals are gated here; hostnames pass to the DNS resolution stage,
  // which rejects any non-public answer (see resolveAndPin).
  const classification = classifyIp(host);
  if (classification !== "public" && classification !== "not-an-ip" && !(testLoopback && isLoopbackHost(host))) {
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

export function isLoopbackHost(host) {
  const lower = String(host ?? "").toLowerCase();
  return lower === "localhost" || lower === "127.0.0.1" || lower === "::1";
}

// Positive IP gate: returns "public" only for globally routable unicast.
// Everything else (loopback, private, link-local, unspecified, multicast,
// reserved, documentation, benchmark, CGNAT, IPv4-mapped IPv6 unwrapped to
// its v4 form) returns a reason string.
export function classifyIp(ip) {
  const lower = String(ip ?? "").toLowerCase();
  if (isLoopbackHost(lower)) return "loopback";
  const mapped = lower.startsWith("::ffff:") ? lower.slice("::ffff:".length) : null;
  const v4 = mapped ?? lower;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b, c, d] = v4.split(".").map(Number);
    if ([a, b, c, d].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return "invalid";
    if (a === 10) return "rfc1918";
    if (a === 172 && b >= 16 && b <= 31) return "rfc1918";
    if (a === 192 && b === 168) return "rfc1918";
    if (a === 169 && b === 254) return "link-local";
    if (a === 127) return "loopback";
    if (a === 0) return "unspecified";
    if (a === 100 && b >= 64 && b <= 127) return "cgnat";
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return "reserved";
    if (a === 198 && ((b === 18 || b === 19) || (b === 51 && c === 100))) return "reserved";
    if (a === 203 && b === 0 && c === 113) return "documentation";
    if (a >= 224 && a <= 239) return "multicast";
    if (a >= 240) return "reserved";
    return "public";
  }
  if (lower.includes(":")) {
    if (lower === "::") return "unspecified";
    if (lower.startsWith("fe80:")) return "link-local";
    if (lower.startsWith("fec0:")) return "site-local";
    if (lower.startsWith("fc00:") || lower.split(":")[0].startsWith("fd")) return "ula";
    if (lower.startsWith("ff")) return "multicast";
    if (lower.startsWith("2001:db8")) return "documentation";
    if (lower.startsWith("64:ff9b:")) return classifyIp(lower.slice("64:ff9b:".length));
    return "public";
  }
  return "not-an-ip";
}

// Resolves ALL A/AAAA answers through the injected resolver and rejects
// unless every usable destination is public. Test loopback bypass applies
// only to loopback-literal hosts with explicit test mode.
export async function resolveAndPin(hostname, { resolveHost = defaultResolveHost, testLoopback = false } = {}) {
  const host = String(hostname ?? "").toLowerCase();
  if (testLoopback && isLoopbackHost(host)) return { addresses: [host], pinned: host, loopback: true };
  let answers;
  try {
    answers = await resolveHost(host);
  } catch {
    throw new ProviderAdapterError("deterministic", "provider artifact host does not resolve");
  }
  const addresses = (Array.isArray(answers) ? answers : []).map(String);
  if (addresses.length === 0) throw new ProviderAdapterError("deterministic", "provider artifact host has no addresses");
  for (const address of addresses) {
    if (classifyIp(address) !== "public") {
      throw new ProviderAdapterError("deterministic", `provider artifact destination is not public (${classifyIp(address)})`);
    }
  }
  return { addresses, pinned: addresses[0], loopback: false };
}

async function defaultResolveHost(hostname) {
  const { lookup } = await import("node:dns/promises");
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function defaultPort(protocol) {
  return protocol === "https:" ? 443 : 80;
}

// Pinned retrieval: TCP/TLS goes to the validated address while Host and
// SNI preserve the original hostname, so validation and connection cannot
// diverge (no DNS TOCTOU between check and fetch).
async function pinnedRequest({ url, address, timeoutMs, maxBytes, init = {} }) {
  const parsed = new URL(url);
  const secure = parsed.protocol === "https:";
  const transport = secure ? await import("node:https") : await import("node:http");
  const port = parsed.port ? Number(parsed.port) : defaultPort(parsed.protocol);
  const headers = { ...(init.headers ?? {}), Host: parsed.host };
  const options = {
    host: address,
    port,
    path: `${parsed.pathname}${parsed.search}`,
    method: init.method ?? "GET",
    headers,
    timeout: timeoutMs,
    ...(secure ? { servername: parsed.hostname } : {}),
  };
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      request.destroy(new Error("pinned request timed out"));
      reject(new ProviderAdapterError("indeterminate", "provider artifact request timed out"));
    }, timeoutMs);
    const request = transport.request(options, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          clearTimeout(timer);
          request.destroy();
          if (!settled) {
            settled = true;
            reject(new ProviderAdapterError("deterministic", "artifact byte size out of bounds"));
          }
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          headers: { get: (name) => response.headers[String(name).toLowerCase()] ?? null },
          arrayBuffer: async () => Buffer.concat(chunks),
        });
      });
      response.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    request.on("timeout", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy();
      reject(new ProviderAdapterError("indeterminate", "provider artifact request timed out"));
    });
    request.end();
  });
}

async function fetchValidatedArtifact({ url, options, redirectBudget = 3 }) {
  validateArtifactUrl(url, options);
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  let response;
  if (options.testLoopback && isLoopbackHost(host)) {
    response = await options.fetchImpl(url, { ...(options.init ?? {}), redirect: "manual" });
  } else {
    const pinned = await resolveAndPin(host, options);
    response = await (options.pinnedRequest ?? pinnedRequest)({
      url, address: pinned.pinned, timeoutMs: options.timeoutMs, maxBytes: options.maxBytes, init: options.init ?? {},
    });
  }
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

export async function downloadArtifact({ url, maxBytes = MAX_RESPONSE_BYTES, timeoutMs = 120000, fetchImpl = fetch, allowedOrigins = [], testLoopback = false, resolveHost, pinnedRequest }) {
  validateArtifactUrl(url, { allowedOrigins, testLoopback });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchValidatedArtifact({
      url,
      options: {
        fetchImpl, allowedOrigins, testLoopback, timeoutMs, maxBytes, resolveHost, pinnedRequest,
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
