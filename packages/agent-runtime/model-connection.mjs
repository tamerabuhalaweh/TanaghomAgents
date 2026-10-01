// #177 successor model connection: explicit probe, hard per-run limits and a kill switch.
// Frozen workspace/evaluation packages are imported read-only, never retargeted.
import { readFileSync } from 'node:fs';

export const connectionManifest = JSON.parse(readFileSync(new URL('../../config/agency-model-connection.v1.json', import.meta.url), 'utf8'));
const limits = connectionManifest.limits;

export class ModelConnectionError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function boundedJson(response) {
  const text = await response.text();
  if (Buffer.byteLength(text) > limits.max_response_bytes) throw new ModelConnectionError('model_response_too_large');
  try { return JSON.parse(text); } catch { throw new ModelConnectionError('model_response_invalid'); }
}

export function modelsUrl(chatCompletionsUrl) {
  return chatCompletionsUrl.replace(/\/chat\/completions$/, '/models');
}

export async function probeModelConnection({ url, apiKey, model, fetch = globalThis.fetch, now = () => new Date() }) {
  const checked_at = now().toISOString();
  if (!apiKey) return { state: 'pending', code: 'model_key_missing', checked_at };
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` }, redirect: 'error',
      signal: AbortSignal.timeout(limits.probe_timeout_ms), cache: 'no-store' });
  } catch { return { state: 'failed', code: 'model_unreachable', checked_at }; }
  if (response.status === 401 || response.status === 403) return { state: 'failed', code: 'model_key_rejected', checked_at };
  if (!response.ok) return { state: 'failed', code: `model_probe_http_${response.status}`, checked_at };
  let body;
  try { body = await boundedJson(response); } catch (error) { return { state: 'failed', code: error.code, checked_at }; }
  const entry = Array.isArray(body?.data) ? body.data.find((item) => item?.id === model) : null;
  if (!entry) return { state: 'failed', code: 'model_not_served', checked_at };
  if (!Number.isInteger(entry.max_model_len)) return { state: 'failed', code: 'model_context_unknown', checked_at };
  return { state: 'verified', code: null, checked_at, model, context_limit: entry.max_model_len };
}

export function killSwitchActive(env = process.env) {
  return env[connectionManifest.kill_switch_env] !== 'false';
}

export function createRunBudget({ pricePer1kTokensUsd, env = process.env }) {
  if (!Number.isFinite(pricePer1kTokensUsd) || pricePer1kTokensUsd < 0) throw new ModelConnectionError('model_price_required');
  const used = { calls: 0, tokens: 0, spend_usd: 0 };
  return {
    used,
    authorize(maxOutputTokens, promptBytes) {
      if (killSwitchActive(env)) throw new ModelConnectionError('kill_switch_active');
      if (maxOutputTokens > limits.max_output_tokens_per_call) throw new ModelConnectionError('budget_output_tokens_exceeded');
      if (used.calls + 1 > limits.max_calls_per_run) throw new ModelConnectionError('budget_calls_exceeded');
      // Worst case: every prompt byte is one token plus the full output allowance.
      const worst = used.tokens + promptBytes + maxOutputTokens;
      if (worst > limits.max_total_tokens_per_run) throw new ModelConnectionError('budget_tokens_exceeded');
      if ((worst / 1000) * pricePer1kTokensUsd > limits.max_spend_usd_per_run) throw new ModelConnectionError('budget_spend_exceeded');
      used.calls += 1;
    },
    record(usage, promptBytes, maxOutputTokens) {
      const tokens = Number.isInteger(usage?.total_tokens) ? usage.total_tokens : promptBytes + maxOutputTokens;
      used.tokens += tokens;
      used.spend_usd = Number(((used.tokens / 1000) * pricePer1kTokensUsd).toFixed(6));
    },
  };
}

export async function callModel({ url, apiKey, request, budget, fetch = globalThis.fetch }) {
  const promptBytes = Buffer.byteLength(request.messages.map((m) => m.content).join('\n'));
  budget.authorize(request.max_tokens, promptBytes);
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(request), redirect: 'error', signal: AbortSignal.timeout(limits.request_timeout_ms), cache: 'no-store' });
  } catch {
    budget.record(null, promptBytes, request.max_tokens);
    throw new ModelConnectionError('inference_outcome_unknown');
  }
  const body = await boundedJson(response).catch((error) => { budget.record(null, promptBytes, request.max_tokens); throw error; });
  budget.record(body?.usage, promptBytes, request.max_tokens);
  if (!response.ok) throw new ModelConnectionError('inference_failed');
  return body;
}
