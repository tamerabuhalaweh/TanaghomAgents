const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_ID = /^[a-z0-9][a-z0-9.-]{1,80}$/;
const MAX_RESPONSE_BYTES = 100000;

export class GeminiWorkspaceError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'GeminiWorkspaceError';
    this.code = code;
    this.status = status;
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

function statusError(status) {
  if (status === 429) return new GeminiWorkspaceError('provider_quota_exceeded', 429);
  if (status === 400 || status === 401 || status === 403) return new GeminiWorkspaceError('provider_request_rejected', 400);
  if (status === 404) return new GeminiWorkspaceError('model_unavailable', 404);
  if (status === 408 || status >= 500) return new GeminiWorkspaceError('inference_outcome_unknown', 502);
  return new GeminiWorkspaceError('inference_failed', 502);
}

export function geminiGenerateEndpoint(model, baseUrl = DEFAULT_BASE_URL) {
  return `${baseUrl.replace(/\/$/, '')}/${modelResource(model)}:generateContent`;
}

export function createGeminiWorkspaceClient({
  apiKey: providedKey,
  baseUrl = DEFAULT_BASE_URL,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 90000,
  inventoryTimeoutMs = 10000,
} = {}) {
  const key = apiKey(providedKey);
  if (typeof fetchImpl !== 'function') throw new GeminiWorkspaceError('model_unavailable', 503);
  const base = String(baseUrl).replace(/\/$/, '');

  async function inventory(model) {
    const resource = modelResource(model);
    let response;
    try {
      response = await fetchImpl(`${base}/models?pageSize=1000`, {
        headers: { 'x-goog-api-key': key, accept: 'application/json' },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(inventoryTimeoutMs),
      });
    } catch {
      throw new GeminiWorkspaceError('model_unavailable', 503);
    }
    if (!response.ok) throw response.status === 429
      ? new GeminiWorkspaceError('provider_quota_exceeded', 429)
      : new GeminiWorkspaceError('model_unavailable', 503);
    const body = await boundedJson(response);
    const found = Array.isArray(body?.models)
      ? body.models.find((entry) => entry?.name === resource)
      : undefined;
    if (!found || !Array.isArray(found.supportedGenerationMethods)
      || !found.supportedGenerationMethods.includes('generateContent')) {
      throw new GeminiWorkspaceError('model_unavailable', 503);
    }
    const inputTokenLimit = Number(found.inputTokenLimit);
    const outputTokenLimit = Number(found.outputTokenLimit);
    if (!Number.isInteger(inputTokenLimit) || inputTokenLimit < 2048
      || !Number.isInteger(outputTokenLimit) || outputTokenLimit < 1) {
      throw new GeminiWorkspaceError('model_unavailable', 503);
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
    let response;
    try {
      response = await fetchImpl(geminiGenerateEndpoint(model, base), {
        method: 'POST',
        headers: { 'x-goog-api-key': key, accept: 'application/json', 'content-type': 'application/json' },
        body,
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new GeminiWorkspaceError('inference_outcome_unknown', 502);
    }
    if (!response.ok) throw statusError(response.status);
    return boundedJson(response);
  }

  return { inventory, generate };
}
