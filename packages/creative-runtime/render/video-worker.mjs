// CPU/GPU-video provider worker (P4). Executes one claimed
// capability=video, lane=gpu_video job end to end WITHOUT trusting
// provider MIME, filenames, or billing state:
//
//   claimed job -> mark running -> get_creative_video_input() ->
//   resolve prior attempt record ->
//     CREATE_NEW (no prior billable attempt) |
//     RESUME (prior task_id anchored) |
//     REFUSE (unknown remote state) ->
//   tenant-checked source bytes (i2v) ->
//   begin provider call -> provider create task ->
//   attach task_id IMMEDIATELY (crash-recovery anchor) ->
//   poll reconcile (cancel-aware) ->
//   SSRF-safe download -> container/track/codec/duration validation ->
//   private storage -> create_creative_asset_version() ->
//   complete/fail job with truthful provider cancellation semantics.
//
// Anchor rule (the double-charge guard): at most ONE provider task per
// Tanaghom job. Once a task_id exists, every retry/resume/restart
// queries the SAME task_id; createTask is never called again for the
// job. A started/indeterminate attempt WITHOUT an attached task_id
// means the remote state is unknowable -> deterministic refusal.
// The only retry that creates anew is a capacity/deterministic
// rejection that provably never started remote work.
//
// Cancel rule (no provider cancel endpoint is documented): local cancel
// NEVER records provider-cancelled. With a task_id, polling CONTINUES
// until the provider reports terminal truth or timeout; success is
// then persisted as a draft/reconciled output (charged work is never
// silently dropped) while the job records the user's cancel intent.
// Only a provider-reported `cancelled` status marks the attempt
// cancelled.
//
// Every database access is a controlled SECURITY DEFINER function via
// repository.mjs; the worker never reads tables.
import { normalizeVideoRequest, estimateVideoCostUsd } from "../adapters/http-video.mjs";
import { validateMp4 } from "./mp4.mjs";
import { sha256Hex } from "../storage/keys.mjs";
import {
  attachProviderRequest,
  beginProviderCall,
  claimVideoJob,
  completeJob,
  countRenderOutputs,
  failJob,
  finishProviderCall,
  getMotionState,
  getProviderCall,
  getVideoInput,
  getVideoSource,
  markRunning,
  reconcileProviderCall,
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
  let taskId = null;
  let resumed = false;
  // Mirrors the call row: 'started' routes settles through finish (P2a
  // path); anything else routes through reconcile. Updated on every
  // successful settle; initialized from the prior record on resume.
  let callStatus = null;
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
    // Anchor decision from the full prior-attempt record. One provider
    // task per job: resume it, refuse the unknown, or create anew only
    // when no billable attempt could exist.
    const prior = await getProviderCall(db, { jobId, worker, operation: params.operation ?? "text_to_video" })
      .catch(() => null);
    if (prior && (prior.status === "started" || prior.status === "indeterminate") && prior.provider_request_id) {
      taskId = prior.provider_request_id;
      callId = prior.call_id;
      callStatus = prior.status;
      resumed = true;
    } else if (prior && (prior.status === "started" || prior.status === "indeterminate")) {
      await fail("deterministic", "video_blind_retry_refused");
    } else if (prior && prior.provider_request_id) {
      // Terminal record WITH a task: re-enter reconciliation of the same
      // task (fresh time-limited URL, same charge) — never a new create.
      taskId = prior.provider_request_id;
      callId = prior.call_id;
      callStatus = prior.status;
      resumed = true;
    } else if (!prior || prior.error_class === "capacity") {
      // No prior attempt, or a capacity/deterministic rejection that
      // provably never started remote work... except deterministic
      // rejections (e.g. moderation) must never recreate: the job is
      // already terminal in those paths, and this guard closes the hole
      // if it ever requeues.
      if (prior && prior.error_class === "deterministic") {
        await fail("deterministic", "video_no_second_provider_task");
      }
    } else {
      await fail("deterministic", "video_no_second_provider_task");
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
    // Settles the CURRENT attempt: first settle goes through finish (P2a
    // started-state path), every later settle through reconcile. Throws
    // on failure so the success path can abort loudly; best-effort
    // wrapper below swallows for paths that fail the job right after.
    async function settleCall(status, errorClass, message, actual = null) {
      const clean = message === null || message === undefined ? null : String(message).slice(0, 500);
      if (callStatus === "started") {
        await finishProviderCall(db, {
          callId, worker, requestId: taskId, actualCostUsd: actual,
          status, errorClass, errorMessage: clean,
        });
      } else {
        await reconcileProviderCall(db, {
          callId, worker, requestId: taskId, status, errorClass,
          errorMessage: clean, actualCostUsd: actual,
        });
      }
      callStatus = status;
    }
    async function settleBestEffort(status, errorClass, message, actual = null) {
      try {
        await settleCall(status, errorClass, message, actual);
      } catch {}
    }
    async function failJobTransient(message) {
      await fail("transient", message.slice(0, 200));
    }
    async function readCancel() {
      try {
        const state = await getMotionState(db, { jobId, worker });
        return !!(state && (state.status === "cancelled" || state.cancel_requested));
      } catch {
        return false;
      }
    }
    if (!resumed) {
      // CREATE_NEW path: cancel first (no task exists, nothing remote to
      // reconcile), then begin + create + attach the anchor immediately.
      if (await readCancel()) await fail("cancelled", "video_cancel_requested");
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
        callStatus = "started";
      } catch (error) {
        await fail("transient", `video_call_begin_failed:${error.message}`.slice(0, 200));
      }
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
          await settleBestEffort("failed", "capacity", error.message);
          await failJobTransient(`video_provider_capacity:${error.message}`);
        }
        if (errorClass === "deterministic") {
          await settleBestEffort("failed", "deterministic", error.message);
          await fail("deterministic", `video_provider_rejected:${error.message}`.slice(0, 200));
        }
        // Transient (5xx) and indeterminate (timeout/transport) at create:
        // the provider may still be generating/billing, so record
        // indeterminate and requeue once — the anchor gate above refuses
        // any blind retry while this attempt is unresolved.
        await settleBestEffort("indeterminate", "indeterminate", error.message);
        await fail("transient", `video_provider_uncertain:${error.message}`.slice(0, 200));
      }
      try {
        await attachProviderRequest(db, { callId, worker, requestId: taskId });
      } catch (error) {
        await fail("transient", `video_anchor_failed:${error.message}`.slice(0, 200));
      }
    }
    // RECONCILE (fresh or resumed): bounded poll loop. Local cancel does
    // NOT stop reconciliation and NEVER records provider-cancelled: the
    // loop continues until the provider reports terminal truth or the
    // poll budget runs out, and the job records the user's cancel intent
    // separately at the end.
    let localCancel = await readCancel();
    const started = Date.now();
    let terminal = null;
    while (Date.now() - started < pollTimeoutMs) {
      if (!localCancel && await readCancel()) localCancel = true;
      try {
        terminal = await provider.queryTask(taskId);
      } catch (error) {
        const errorClass = error?.errorClass ?? "transient";
        if (errorClass === "deterministic") {
          await settleBestEffort("failed", "deterministic", error.message);
          if (localCancel) await fail("cancelled", "video_cancel_requested");
          await fail("deterministic", `video_reconcile_rejected:${error.message}`.slice(0, 200));
        }
        // Transient/capacity/indeterminate poll errors: keep reconciling
        // the SAME task within budget — never terminalize, never recreate.
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        continue;
      }
      if (terminal.status === "succeeded" || terminal.status === "failed" || terminal.status === "cancelled") break;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    if (!terminal || (terminal.status !== "succeeded" && terminal.status !== "failed" && terminal.status !== "cancelled")) {
      await settleBestEffort("indeterminate", "indeterminate", localCancel ? "video_reconcile_timeout_after_local_cancel" : "video_reconcile_timeout");
      // No cancel: requeue so reconciliation resumes against the anchor.
      // Cancel: terminal cancelled job = the documented manual state;
      // the indeterminate call row keeps the remote truth recoverable.
      if (localCancel) await fail("cancelled", "video_cancel_requested");
      await fail("transient", "video_reconcile_timeout");
    }
    if (terminal.status === "cancelled") {
      // The ONLY path that records provider-cancelled: the provider said so.
      await settleBestEffort("cancelled", "cancelled", "provider task cancelled");
      await fail("cancelled", "video_provider_task_cancelled");
    }
    if (terminal.status === "failed") {
      await settleBestEffort("failed", "deterministic", "provider task failed without artifact");
      if (localCancel) await fail("cancelled", "video_cancel_requested");
      await fail("deterministic", "video_provider_task_failed");
    }
    // Provider truth first: the ledger becomes succeeded WITH actual cost
    // BEFORE any artifact work. Downstream failures (download, validation,
    // storage, registration) are Tanaghom failures — the provider row
    // stays succeeded+actual because MiniMax already completed and may
    // have charged us. Retries re-query/re-download the SAME task.
    const billedSeconds = Number(terminal?.usage?.output_seconds ?? request.duration);
    const actualCost = Math.round((Number.isFinite(billedSeconds) ? billedSeconds : request.duration) * unitPrice * 1000) / 1000;
    try {
      await settleCall("succeeded", null, null, actualCost);
    } catch (error) {
      await fail("transient", `video_call_settle_failed:${error.message}`.slice(0, 200));
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
      // The provider ledger already says succeeded+actual: downstream
      // failures must not rewrite it (reconcile would reject the
      // conflict, swallowed here).
      await settleBestEffort("failed", error?.errorClass ?? "transient", error.message);
      if (localCancel) await fail("cancelled", "video_cancel_requested");
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
      await settleBestEffort("failed", "deterministic", error.message);
      if (localCancel) await fail("cancelled", "video_cancel_requested");
      await fail("deterministic", `video_output_invalid:${error.message}`.slice(0, 200));
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
      remote_outcome: terminal.status,
      local_cancel_requested: localCancel,
      reconciliation_resumed: resumed,
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
    // Success with a pending local cancel still honors the user's intent:
    // the charged artifact persists as draft output, the job closes
    // cancelled — completeJob is never called on this path.
    if (localCancel) await fail("cancelled", "video_cancel_requested");
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
