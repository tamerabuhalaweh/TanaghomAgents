// Config-driven HTTP video provider adapter (MiniMax V2 primary). No
// hardcoded provider, model, or key: the caller supplies an allowlisted
// endpoint record plus a secret obtained from the environment at runtime.
// Tested against a localhost stub that mimics the MiniMax V2 task shape
// (create -> task_id; query -> queued/running/succeeded/failed/cancelled
// with time-limited content.url); vendor pixels require a real key and
// stay behind external acceptance. See tasks/236-provider-decision.md.
import {
  ProviderAdapterError,
  downloadArtifact,
  validateArtifactUrl,
} from "./http-image.mjs";

export { ProviderAdapterError, downloadArtifact, validateArtifactUrl };

const MAX_PROMPT_CHARS = 7000;
const RESOLUTIONS = Object.freeze(["480P", "768P", "2K"]);
const RATIOS = Object.freeze(["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
const TASK_STATUSES = Object.freeze(["queued", "running", "succeeded", "failed", "cancelled"]);

function classifyStatus(status, bodyText) {
  if (status === 429) return { errorClass: "capacity", message: `provider rate limited: ${bodyText.slice(0, 200)}` };
  if (status >= 500 || status === 529) return { errorClass: "transient", message: `provider unavailable (${status}): ${bodyText.slice(0, 200)}` };
  return { errorClass: "deterministic", message: `provider rejected request (${status}): ${bodyText.slice(0, 200)}` };
}

export function normalizeVideoRequest({ operation, prompt, duration = 5, resolution = "768P", ratio = "adaptive", imageUrl = null }) {
  if (operation !== "text_to_video" && operation !== "image_to_video") {
    throw new ProviderAdapterError("deterministic", "operation must be text_to_video or image_to_video");
  }
  if (typeof prompt !== "string" || prompt.trim().length < 1 || prompt.length > MAX_PROMPT_CHARS) {
    throw new ProviderAdapterError("deterministic", `prompt must be 1..${MAX_PROMPT_CHARS} characters`);
  }
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) {
    throw new ProviderAdapterError("deterministic", "duration must be an integer 4..15 seconds");
  }
  if (!RESOLUTIONS.includes(resolution)) {
    throw new ProviderAdapterError("deterministic", "resolution must be 480P, 768P, or 2K");
  }
  if (!RATIOS.includes(ratio)) {
    throw new ProviderAdapterError("deterministic", "ratio is not allowlisted");
  }
  if (operation === "text_to_video" && ratio === "adaptive") {
    throw new ProviderAdapterError("deterministic", "text-to-video requires an explicit ratio");
  }
  let image = null;
  if (operation === "image_to_video") {
    if (typeof imageUrl !== "string" || imageUrl.length < 8) {
      throw new ProviderAdapterError("deterministic", "image-to-video requires a source image reference");
    }
    // Public URLs stay small; data URIs carry inline bytes (MiniMax
    // accepts data:image/<format>;base64 inputs, capped well under the
    // 64MB request body limit).
    if (/^data:image\/(png|jpe?g|webp|heic|heif);base64,[A-Za-z0-9+/=]+$/.test(imageUrl)) {
      if (imageUrl.length > 40000000) throw new ProviderAdapterError("deterministic", "image data URI too large");
    } else if (!/^https?:\/\/[^/\s]+\/\S{1,1900}$/.test(imageUrl)) {
      throw new ProviderAdapterError("deterministic", "image reference must be an https URL or image data URI");
    }
    image = imageUrl;
  } else if (imageUrl !== null) {
    throw new ProviderAdapterError("deterministic", "text-to-video takes no image reference");
  }
  return { operation, prompt: prompt.trim(), duration, resolution, ratio, imageUrl: image };
}

export function estimateVideoCostUsd({ duration, unitPriceUsd = 0.08 }) {
  if (!Number.isInteger(duration) || duration < 1) throw new ProviderAdapterError("deterministic", "duration required for estimate");
  return Math.round(duration * unitPriceUsd * 1000) / 1000;
}

function readErrorMessage(payload, fallback) {
  const message = payload?.error?.message ?? payload?.message;
  return typeof message === "string" && message.length > 0 ? message.slice(0, 300) : fallback;
}

async function postVideoJson({ url, apiKey, body, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new ProviderAdapterError("indeterminate", `provider call failed before a billable verdict: ${error?.message ?? error}`);
  } finally {
    clearTimeout(timer);
  }
  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    const classified = classifyStatus(response.status, readErrorMessage(safeJson(bodyText), bodyText));
    throw new ProviderAdapterError(classified.errorClass, classified.message, {
      status: response.status,
      requestId: safeJson(bodyText)?.request_id ?? null,
    });
  }
  try {
    return { payload: JSON.parse(bodyText), headers: response.headers };
  } catch {
    throw new ProviderAdapterError("deterministic", "provider returned malformed JSON");
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toContent(request) {
  const content = [{ type: "text", text: request.prompt }];
  if (request.operation === "image_to_video") {
    content.push({ type: "image_url", image_url: { url: request.imageUrl }, role: "first_frame" });
  }
  return content;
}

export async function createVideoTask({ endpoint, apiKey, request, timeoutMs = 120000, fetchImpl = fetch }) {
  const startedAt = Date.now();
  const { payload } = await postVideoJson({
    url: endpoint,
    apiKey,
    body: {
      model: request.model,
      content: toContent(request),
      resolution: request.resolution,
      duration: request.duration,
      ratio: request.ratio,
    },
    timeoutMs,
    fetchImpl,
  });
  const taskId = payload?.task_id;
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new ProviderAdapterError("deterministic", "provider returned no task id");
  }
  return { taskId, latencyMs: Date.now() - startedAt };
}

export async function queryVideoTask({ queryEndpoint, apiKey, taskId, timeoutMs = 60000, fetchImpl = fetch }) {
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new ProviderAdapterError("deterministic", "task id required");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${queryEndpoint}/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
  } catch (error) {
    throw new ProviderAdapterError("indeterminate", `provider query failed before a verdict: ${error?.message ?? error}`);
  } finally {
    clearTimeout(timer);
  }
  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    const classified = classifyStatus(response.status, readErrorMessage(safeJson(bodyText), bodyText));
    throw new ProviderAdapterError(classified.errorClass, classified.message, { status: response.status });
  }
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new ProviderAdapterError("deterministic", "provider returned malformed JSON");
  }
  const task = payload?.task ?? {};
  if (!TASK_STATUSES.includes(task.status)) {
    throw new ProviderAdapterError("deterministic", `provider returned unknown task status: ${String(task.status).slice(0, 60)}`);
  }
  if (task.status === "failed") {
    const message = task?.error?.message ?? "provider task failed";
    // Moderation/safety rejections are deterministic AND, per the official
    // packages doc, not deducted — record the provider code either way.
    throw new ProviderAdapterError("deterministic", `provider task failed (${task?.error?.code ?? "unknown"}): ${String(message).slice(0, 200)}`);
  }
  if (task.status === "succeeded") {
    if (typeof task?.content?.url !== "string" || task.content.url.length === 0) {
      throw new ProviderAdapterError("deterministic", "provider task succeeded without an artifact URL");
    }
    return {
      status: "succeeded",
      url: task.content.url,
      duration: task.duration ?? null,
      resolution: task.resolution ?? null,
      ratio: task.ratio ?? null,
      usage: task.usage ?? null,
    };
  }
  return { status: task.status };
}

export function createHttpVideoAdapter({ name, endpoint, queryEndpoint, apiKey, model, modelVersion = null, timeoutMs = 120000, pollIntervalMs = 10000, pollTimeoutMs = 600000, fetchImpl = fetch, testLoopback = false }) {
  if (!name || !endpoint || !queryEndpoint || !apiKey || !model) throw new Error("http_video_adapter_config_incomplete");
  const https = /^https:\/\//.test(endpoint) && /^https:\/\//.test(queryEndpoint);
  const loopbackHttp = testLoopback
    && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(endpoint)
    && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(queryEndpoint);
  if (!https && !loopbackHttp) throw new Error("http_video_adapter_endpoint_must_be_https");
  return Object.freeze({
    name,
    capabilities: Object.freeze(["video"]),
    model,
    modelVersion: modelVersion ?? null,
    async createTask(input) {
      const request = normalizeVideoRequest(input);
      const startedAt = Date.now();
      const created = await createVideoTask({ endpoint, apiKey, request: { ...request, model }, timeoutMs, fetchImpl });
      return { ...created, model, modelVersion: modelVersion ?? null, elapsedMs: Date.now() - startedAt };
    },
    async queryTask(taskId) {
      return queryVideoTask({ queryEndpoint, apiKey, taskId, fetchImpl });
    },
    pollIntervalMs,
    pollTimeoutMs,
  });
}
