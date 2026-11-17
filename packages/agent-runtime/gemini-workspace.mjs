const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_ID = /^[a-z0-9][a-z0-9.-]{1,80}$/;
const MAX_RESPONSE_BYTES = 100000;
const MAX_DETAIL_CHARS = 300;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 45000;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export class GeminiWorkspaceError extends Error {
  constructor(code, status = 502, details = null) {
    super(code);
    this.name = 'GeminiWorkspaceError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.http_status = details?.http_status ?? null;
    this.upstream_error = details?.upstream_error ?? null;
    this.finish_reason = details?.finish_reason ?? null;
  }
}

function apiKey(value) {
  if (typeof value !== 'string') throw new GeminiWorkspaceError('model_unavailable', 503);
  const key = value.trim();
  if (key.length < 20 || key.length > 500 || /\s/.test(key)) {
    throw new GeminiWorkspaceError('model_unavailable', 503);
  }
  return key;
}

function modelResource(model) {
  if (typeof model !== 'string' || !MODEL_ID.test(model)) {
    throw new GeminiWorkspaceError('model_unavailable', 503);
  }
  return `models/${model}`;
}

function sanitizeDetail(value, secret = '') {
  let text = typeof value === 'string' ? value : '';
  if (secret) text = text.split(secret).join('[redacted]');
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL_CHARS);
}

function transportDetails(error, attempt, secret) {
  return {
    attempt,
    error_name: typeof error?.name === 'string' ? error.name : 'Error',
    error_message: sanitizeDetail(error?.message, secret),
  };
}

async function readUpstreamError(response, secret) {
  let raw = '';
  const reader = response.body?.getReader?.();
  if (reader) {
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        raw += Buffer.from(part.value).toString('utf8');
        if (size >= 4096) {
          await reader.cancel();
          break;
        }
      }
    } catch {
      /* the status is still diagnostic evidence when the body fails */
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  }
  let message = raw;
  try {
    const parsed = JSON.parse(raw);
    message = parsed?.error?.message || parsed?.error?.status || parsed?.message || raw;
  } catch { /* plain-text upstream error */ }
  return {
    http_status: response.status,
    upstream_error: sanitizeDetail(message, secret),
  };
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new GeminiWorkspaceError('output_rejected', 502);
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GeminiWorkspaceError('output_rejected', 502);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new GeminiWorkspaceError('output_rejected', 502);
  }
}

function statusError(status, details = null) {
  if (status === 429) return new GeminiWorkspaceError('provider_quota_exceeded', 429, details);
  if (status === 400 || status === 401 || status === 403) return new GeminiWorkspaceError('provider_request_rejected', 400, details);
  if (status === 404) return new GeminiWorkspaceError('model_unavailable', 404, details);
  if (status === 408 || status >= 500) return new GeminiWorkspaceError('inference_outcome_unknown', 502, details);
  return new GeminiWorkspaceError('inference_failed', 502, details);
}

export function retryDelayFor(response, fallbackMs) {
  const header = response?.headers?.get?.('retry-after');
  if (typeof header === 'string' && /^\d+$/.test(header.trim())) {
    const seconds = Number(header.trim());
    if (Number.isSafeInteger(seconds) && seconds > 0) {
      return Math.min(25000, Math.max(fallbackMs, seconds * 1000));
    }
  }
  return fallbackMs;
}

async function releaseBody(response) {
  try { await response?.body?.cancel?.(); } catch { /* cross-runtime empty bodies */ }
}

export function geminiGenerateEndpoint(model, baseUrl = DEFAULT_BASE_URL) {
  return `${baseUrl.replace(/\/$/, '')}/${modelResource(model)}:generateContent`;
}

export function createGeminiWorkspaceClient({
  apiKey: providedKey,
  baseUrl = DEFAULT_BASE_URL,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 130000,
  attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
  inventoryTimeoutMs = attemptTimeoutMs,
  retryDelaysMs = [2000, 5000, 10000],
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const key = apiKey(providedKey);
  if (typeof fetchImpl !== 'function') throw new GeminiWorkspaceError('model_unavailable', 503);
  if (!Number.isFinite(attemptTimeoutMs) || attemptTimeoutMs < 1000) {
    throw new GeminiWorkspaceError('model_unavailable', 503);
  }
  const base = String(baseUrl).replace(/\/$/, '');

  async function inventory(model) {
    const resource = modelResource(model);
    const deadline = Date.now() + inventoryTimeoutMs;
    const remainingMs = () => deadline - Date.now();
    const send = () => fetchImpl(`${base}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': key, accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(1, Math.min(attemptTimeoutMs, remainingMs()))),
    });
    let response;
    for (let attempt = 0; ; attempt += 1) {
      const remaining = remainingMs();
      if (remaining <= 0) {
        throw new GeminiWorkspaceError('model_unavailable', 503, { attempt: attempt + 1, error_name: 'DeadlineExceeded' });
      }
      try {
        response = await send();
        break;
      } catch (error) {
        if (attempt >= retryDelaysMs.length) {
          throw new GeminiWorkspaceError('model_unavailable', 503, transportDetails(error, attempt + 1, key));
        }
        const delay = retryDelaysMs[attempt];
        const left = remainingMs();
        if (left <= 0) throw new GeminiWorkspaceError('model_unavailable', 503, transportDetails(error, attempt + 1, key));
        await sleep(Math.min(delay, left));
      }
    }
    for (let attempt = 0; RETRYABLE_STATUSES.has(response.status) && attempt < retryDelaysMs.length; attempt += 1) {
      const delay = retryDelayFor(response, retryDelaysMs[attempt]);
      const details = await readUpstreamError(response, key);
      const remaining = remainingMs();
      if (remaining <= 0) throw new GeminiWorkspaceError('model_unavailable', 503, details);
      await sleep(Math.min(delay, remaining));
      if (remainingMs() <= 0) throw new GeminiWorkspaceError('model_unavailable', 503, details);
      try {
        response = await send();
      } catch (error) {
        throw new GeminiWorkspaceError('model_unavailable', 503, transportDetails(error, attempt + 2, key));
      }
    }
    if (!response.ok) {
      const details = await readUpstreamError(response, key);
      throw response.status === 429
        ? new GeminiWorkspaceError('provider_quota_exceeded', 429, details)
        : new GeminiWorkspaceError('model_unavailable', 503, details);
    }
    const body = await boundedJson(response);
    const found = Array.isArray(body?.models)
      ? body.models.find((entry) => entry?.name === resource)
      : undefined;
    if (!found || !Array.isArray(found.supportedGenerationMethods)
      || !found.supportedGenerationMethods.includes('generateContent')) {
      throw new GeminiWorkspaceError('model_unavailable', 503, { model, upstream_error: 'model lacks generateContent' });
    }
    const inputTokenLimit = Number(found.inputTokenLimit);
    const outputTokenLimit = Number(found.outputTokenLimit);
    if (!Number.isInteger(inputTokenLimit) || inputTokenLimit < 2048
      || !Number.isInteger(outputTokenLimit) || outputTokenLimit < 1) {
      throw new GeminiWorkspaceError('model_unavailable', 503, {
        model,
        upstream_error: `invalid token limits: input=${found.inputTokenLimit} output=${found.outputTokenLimit}`,
      });
    }
    return { id: model, resource, inputTokenLimit, outputTokenLimit };
  }

  async function generate(model, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new GeminiWorkspaceError('inference_failed', 400);
    }
    let body;
    try {
      body = JSON.stringify(payload);
    } catch {
      throw new GeminiWorkspaceError('inference_failed', 400);
    }
    if (Buffer.byteLength(body, 'utf8') > 64000) throw new GeminiWorkspaceError('inference_failed', 400);
    // One overall deadline covers retry delays and every inference attempt, so
    // a retry loop cannot outlive the Postgres workspace lease. Each attempt is
    // independently bounded: a stalled upstream socket aborts and retries
    // instead of holding the task until lease recovery.
    const deadline = Date.now() + timeoutMs;
    const remainingMs = () => deadline - Date.now();
    const send = () => fetchImpl(geminiGenerateEndpoint(model, base), {
      method: 'POST',
      headers: { 'x-goog-api-key': key, accept: 'application/json', 'content-type': 'application/json' },
      body,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(1, Math.min(attemptTimeoutMs, remainingMs()))),
    });
    let response;
    // Workspace generation is pure text (external_actions: 0), so repeating
    // the identical request is safe after a transport timeout or transient
    // quota/capacity status.
    for (let attempt = 0; ; attempt += 1) {
      const remaining = remainingMs();
      if (remaining <= 0) {
        throw new GeminiWorkspaceError('inference_outcome_unknown', 502, { attempt: attempt + 1, error_name: 'DeadlineExceeded' });
      }
      try {
        response = await send();
        break;
      } catch (error) {
        const details = transportDetails(error, attempt + 1, key);
        if (attempt >= retryDelaysMs.length) {
          throw new GeminiWorkspaceError('inference_outcome_unknown', 502, details);
        }
        const delay = retryDelaysMs[attempt];
        const left = remainingMs();
        if (left <= 0) throw new GeminiWorkspaceError('inference_outcome_unknown', 502, details);
        await sleep(Math.min(delay, left));
      }
    }
    for (let attempt = 0; RETRYABLE_STATUSES.has(response.status) && attempt < retryDelaysMs.length; attempt += 1) {
      const delay = retryDelayFor(response, retryDelaysMs[attempt]);
      const details = await readUpstreamError(response, key);
      const remaining = remainingMs();
      if (remaining <= 0) throw statusError(response.status, details);
      await sleep(Math.min(delay, remaining));
      if (remainingMs() <= 0) throw statusError(response.status, details);
      try {
        response = await send();
      } catch (error) {
        throw new GeminiWorkspaceError('inference_outcome_unknown', 502, transportDetails(error, attempt + 2, key));
      }
    }
    if (!response.ok) throw statusError(response.status, await readUpstreamError(response, key));
    return boundedJson(response);
  }

  return { inventory, generate };
}
