// CPU/GPU-video provider worker (P4). Executes one claimed
// capability=video, lane=gpu_video job end to end WITHOUT trusting
// provider MIME, filenames, or billing state:
//
//   claimed job -> mark running -> get_creative_video_input() ->
//   blind-retry guard -> tenant-checked source bytes (i2v) ->
//   begin provider call -> provider create task -> poll reconcile ->
//   SSRF-safe download -> container/track/codec/duration validation ->
//   private storage -> create_creative_asset_version() ->
//   complete/fail job with provider cancellation semantics.
//
// Billing rule: a provider attempt that ends indeterminate (timeout,
// transport failure, 5xx at create) is finished as `indeterminate` and
// the job requeues transiently — but the next pass REFUSES a new
// provider call while the latest attempt is started/indeterminate, so a
// possibly-generating, possibly-billing request is never blindly
// duplicated. Provider cancel endpoints are undocumented for the
// selected vendors, so local cancel stops polling and records
// cancelled; the provider task may still complete remotely and that is
// recorded in provenance.
//
// Every database access is a controlled SECURITY DEFINER function via
// repository.mjs; the worker never reads tables.
import { normalizeVideoRequest, estimateVideoCostUsd } from "../adapters/http-video.mjs";
import { validateMp4 } from "./mp4.mjs";
import { sha256Hex } from "../storage/keys.mjs";
import {
  beginProviderCall,
  claimVideoJob,
  completeJob,
  countRenderOutputs,
  failJob,
  finishProviderCall,
  getMotionState,
  getVideoInput,
  getVideoSource,
  latestProviderCall,
  markRunning,
  registerVersion,
} from "../repository.mjs";

export const VIDEO_CAPABILITY = "video";
export const VIDEO_LANE = "gpu_video";
export const VIDEO_RENDER_MIME = "video/mp4";
export const VIDEO_RENDER_METHOD = "render";
export const VIDEO_RENDERER_ID = "creative-video-render/1";
// Provider clips validate against the vendor codec allowlist (never the
// in-house mp4v-only rule) and never trust declared MIME/filenames.
export const PROVIDER_VIDEO_CODECS = Object.freeze(["mp4v", "avc1"]);

export async function claimVideoRenderJob(db, { worker, leaseSeconds = 120 }) {
  const row = await claimVideoJob(db, { worker, leaseSeconds });
  if (!row) return null;
  return { row, jobId: row.job_id ?? row.id };
}

export async function executeVideoJob({
  db, storage, provider, download, jobId, worker,
  pollIntervalMs = 10000, pollTimeoutMs = 600000,
}) {
  if (!db || !storage || !provider || !download) throw new Error("video_worker_dependencies_required");
  if (!jobId || !worker) throw new Error("video_worker_job_required");
  const fail = async (errorClass, message) => {
    try {
      await failJob(db, { jobId, worker, errorClass, errorMessage: message.slice(0, 500) });
    } catch {}
    const error = new Error(message);
    error.errorClass = errorClass;
    throw error;
  };
  let running = null;
  try {
    running = await markRunning(db, { jobId, worker });
  } catch (error) {
    throw error;
  }
  if (running === "cancelled") await fail("cancelled", "video_cancel_requested");
  let callId = null;
  try {
    if ((await countRenderOutputs(db, { jobId, worker })) > 0) {
      await fail("deterministic", "video_duplicate_execution");
    }
    let input = null;
    try {
      input = await getVideoInput(db, { jobId, worker });
    } catch (error) {
      await fail("deterministic", `video_input_unresolvable:${error.message}`.slice(0, 200));
    }
    if (!input) await fail("deterministic", "video_input_missing");
    const params = input.params ?? {};
    // Never duplicate a possibly-live provider request.
    const latest = await latestProviderCall(db, { jobId, worker, operation: params.operation ?? "text_to_video" })
      .catch(() => null);
    if (latest === "started" || latest === "indeterminate") {
      await fail("deterministic", "video_blind_retry_refused");
    }
    // Resolve image-to-video source bytes through the controlled reader
    // FIRST: the provider receives a data URI via the adapter input
    // contract (MiniMax accepts data:image/...;base64 inputs), never a
    // private storage URL — so the data URI must exist before the
    // request normalizes.
    let imageUrl = null;
    if ((params.operation ?? null) === "image_to_video") {
      const ref = params.source_asset_version_id;
      if (typeof ref !== "string" || ref.length === 0) {
        await fail("deterministic", "video_source_ref_missing");
      }
      let source = null;
      try {
        source = await getVideoSource(db, { jobId, worker, versionId: ref });
      } catch {
        source = null;
      }
      if (!source) await fail("deterministic", `video_source_not_found:${ref}`);
      try {
        const stored = await storage.get(source.object_key);
        if (!stored) await fail("deterministic", `video_source_artifact_missing:${ref}`);
        imageUrl = `data:${stored.mime};base64,${stored.bytes.toString("base64")}`;
      } catch (error) {
        if (error && error.errorClass) throw error;
        await fail("transient", `video_source_unreadable:${error.message}`.slice(0, 200));
      }
    }
    let request = null;
    try {
      request = normalizeVideoRequest({
        operation: params.operation,
        prompt: params.prompt,
        duration: params.duration,
        resolution: params.resolution,
        ratio: params.ratio,
        imageUrl,
      });
    } catch (error) {
      await fail("deterministic", `video_request_invalid:${error.message}`.slice(0, 200));
    }
    const unitPrice = typeof params.unit_price_usd === "number" ? params.unit_price_usd : 0.08;
    const estimated = estimateVideoCostUsd({ duration: request.duration, unitPriceUsd: unitPrice });
    async function finishCall(status, errorClass, message) {
      try {
        await finishProviderCall(db, {
          callId, worker, requestId: taskId, actualCostUsd: null,
          status, errorClass, errorMessage: String(message ?? "").slice(0, 500),
        });
      } catch {}
    }
    async function failJobTransient(message) {
      await fail("transient", message.slice(0, 200));
    }
    try {
      callId = await beginProviderCall(db, {
        jobId, worker,
        provider: provider.name,
        model: provider.model,
        modelVersion: provider.modelVersion,
        operation: request.operation,
        units: { seconds: request.duration, resolution: request.resolution },
        estimatedCostUsd: estimated,
        adapterConfig: provider.adapterConfig ?? "creative.video-providers.v1",
      });
    } catch (error) {
      await fail("transient", `video_call_begin_failed:${error.message}`.slice(0, 200));
    }
    let taskId = null;
    try {
      const created = await provider.createTask({
        operation: request.operation,
        prompt: request.prompt,
        duration: request.duration,
        resolution: request.resolution,
        ratio: request.ratio,
        imageUrl,
      });
      taskId = created.taskId;
    } catch (error) {
      const errorClass = error?.errorClass ?? "transient";
      if (errorClass === "capacity") {
        await finishCall("failed", "capacity", error.message);
        await failJobTransient(`video_provider_capacity:${error.message}`);
      }
      if (errorClass === "deterministic") {
        await finishCall("failed", "deterministic", error.message);
        await fail("deterministic", `video_provider_rejected:${error.message}`.slice(0, 200));
      }
      // Transient (5xx) and indeterminate (timeout/transport) at create:
      // the provider may still be generating/billing, so record
      // indeterminate and requeue once — the next pass will refuse a
      // blind retry while this attempt is unresolved.
      await finishCall("indeterminate", "indeterminate", error.message);
      await fail("transient", `video_provider_uncertain:${error.message}`.slice(0, 200));
    }
    // Reconcile: bounded poll loop with cooperative cancel. No provider
    // cancel endpoint is documented, so cancel stops polling locally.
    const started = Date.now();
    let terminal = null;
    while (Date.now() - started < pollTimeoutMs) {
      let state = null;
      try {
        state = await getMotionState(db, { jobId, worker });
      } catch {
        state = null;
      }
      if (state && (state.status === "cancelled" || state.cancel_requested)) {
        await finishCall("cancelled", "cancelled", "video_cancel_requested");
        await fail("cancelled", "video_cancel_requested");
      }
      try {
        terminal = await provider.queryTask(taskId);
      } catch (error) {
        if ((error?.errorClass ?? "transient") === "indeterminate") {
          await finishCall("indeterminate", "indeterminate", error.message);
          await fail("transient", `video_reconcile_uncertain:${error.message}`.slice(0, 200));
        }
        await finishCall("failed", "transient", error.message);
        await fail("transient", `video_reconcile_failed:${error.message}`.slice(0, 200));
      }
      if (terminal.status === "succeeded" || terminal.status === "failed" || terminal.status === "cancelled") break;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    if (!terminal || (terminal.status !== "succeeded" && terminal.status !== "failed" && terminal.status !== "cancelled")) {
      await finishCall("indeterminate", "indeterminate", "video_reconcile_timeout");
      await fail("transient", "video_reconcile_timeout");
    }
    if (terminal.status === "failed") {
      await finishCall("failed", "deterministic", "provider task failed without artifact");
      await fail("deterministic", "video_provider_task_failed");
    }
    if (terminal.status === "cancelled") {
      await finishCall("cancelled", "cancelled", "provider task cancelled");
      await fail("cancelled", "video_provider_task_cancelled");
    }
    // SSRF-safe retrieval: exact artifact-host allowlist enforced inside
    // the injected download boundary (DNS pinning, no private targets).
    let artifact = null;
    try {
      artifact = await download({
        url: terminal.url,
        maxBytes: provider.maxBytes ?? 104857600,
        allowedOrigins: provider.artifactOrigins ?? [],
        testLoopback: provider.testLoopback ?? false,
      });
    } catch (error) {
      await finishCall("failed", error?.errorClass ?? "transient", error.message);
      if ((error?.errorClass ?? "transient") === "deterministic") {
        await fail("deterministic", `video_artifact_rejected:${error.message}`.slice(0, 200));
      }
      await fail("transient", `video_artifact_failed:${error.message}`.slice(0, 200));
    }
    let checked = null;
    try {
      checked = validateMp4(artifact.bytes, {
        width: null, height: null, expectedDurationSec: request.duration,
        allowedCodecs: [...PROVIDER_VIDEO_CODECS],
      });
    } catch (error) {
      await finishCall("failed", "deterministic", error.message);
      await fail("deterministic", `video_output_invalid:${error.message}`.slice(0, 200));
    }
    const billedSeconds = Number(terminal?.usage?.output_seconds ?? request.duration);
    const actualCost = Math.round((Number.isFinite(billedSeconds) ? billedSeconds : request.duration) * unitPrice * 1000) / 1000;
    try {
      await finishProviderCall(db, {
        callId, worker, requestId: taskId, actualCostUsd: actualCost,
        status: "succeeded", errorClass: null, errorMessage: null,
      });
    } catch (error) {
      await fail("transient", `video_call_finish_failed:${error.message}`.slice(0, 200));
    }
    const objectKey = `t/${input.organization_id}/video/${jobId}/v1.mp4`;
    try {
      const written = await storage.put(objectKey, artifact.bytes, VIDEO_RENDER_MIME);
      if (written && written.sha256 && written.sha256.toLowerCase() !== sha256Hex(artifact.bytes)) {
        await fail("deterministic", "video_checksum_mismatch");
      }
    } catch (error) {
      if (/object_key_exists|object_key_immutable/.test(error.message)) {
        await fail("deterministic", "video_output_key_exists");
      }
      await fail("transient", `video_storage_failed:${error.message}`.slice(0, 200));
    }
    const provenance = {
      renderer: VIDEO_RENDERER_ID,
      method: VIDEO_RENDER_METHOD,
      provider: provider.name,
      model: provider.model,
      model_version: provider.modelVersion,
      operation: request.operation,
      provider_task_id: taskId,
      provider_request_id: taskId,
      provider_usage: terminal?.usage ?? null,
      units: { seconds: request.duration, resolution: request.resolution },
      estimated_cost_usd: estimated,
      actual_cost_usd: actualCost,
      adapter_config: provider.adapterConfig ?? "creative.video-providers.v1",
      video: { codec: checked.codec, width: checked.width, height: checked.height, duration_sec: checked.durationSec },
      source_asset_version_id: params.source_asset_version_id ?? null,
      correlation_id: input.correlation_id,
      job_id: jobId,
    };
    let versionId = null;
    try {
      versionId = await registerVersion(db, {
        jobId, worker,
        assetId: null,
        title: `${request.operation === "image_to_video" ? "Image" : "Text"} to video · ${request.duration}s`.slice(0, 200),
        mime: VIDEO_RENDER_MIME,
        width: checked.width, height: checked.height, durationMs: Math.round(checked.durationSec * 1000),
        bytes: artifact.bytes.length, sha256: sha256Hex(artifact.bytes), objectKey,
        provenance, templateRef: null,
        method: VIDEO_RENDER_METHOD,
      });
    } catch (error) {
      await fail("transient", `video_version_register_failed:${error.message}`.slice(0, 200));
    }
    await completeJob(db, { jobId, worker, assetVersionId: versionId });
    return {
      jobId,
      correlationId: input.correlation_id,
      capability: VIDEO_CAPABILITY,
      versionId,
      output: {
        objectKey, bytes: artifact.bytes.length,
        width: checked.width, height: checked.height,
        durationSec: checked.durationSec, codec: checked.codec,
        actualCostUsd: actualCost,
      },
      provider: { name: provider.name, model: provider.model, taskId },
    };
  } catch (error) {
    if (error && error.errorClass) throw error;
    await fail("transient", `video_worker_failed:${error.message}`.slice(0, 200));
  }
}
