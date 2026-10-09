// CPU motion render worker (P3). Executes one claimed capability=motion,
// lane=cpu job end to end WITHOUT touching the preview HTTP route:
//
//   claimed job -> mark running -> get_creative_motion_input() ->
//   pinned motion + design documents -> timeline plan ->
//   per-frame frozen HTML -> offline PNG capture (active network block) ->
//   fixed-argv FFmpeg MP4 encode -> pure-JS MP4 validation ->
//   private storage -> create_creative_asset_version() ->
//   complete/fail job with cooperative cancellation polling.
//
// One motion job persists ONE asset with ONE version (the MP4). Source
// design assets arrive resolved inside the controlled input; the worker
// never reads tables — every database access is a controlled SECURITY
// DEFINER function via repository.mjs.
//
// FFmpeg is a deployment-provided binary (FFMPEG_PATH or PATH), never
// bundled: see tasks/234-motion-engine.md. Injected `capture` and
// `encode` keep unit tests browser/ffmpeg-free.
import path from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildMotionFrameHtml, planTimeline } from "./motion.mjs";
import { bundledFontCss } from "./document.mjs";
import { assertPngBytes } from "./worker.mjs";
import { buildFfmpegArgs, encodeMp4, resolveFfmpegPath, validateMp4 } from "./mp4.mjs";
import { sha256Hex } from "../storage/keys.mjs";
import {
  claimMotionJob,
  completeJob,
  countRenderOutputs,
  failJob,
  getMotionInput,
  getMotionState,
  markRunning,
  registerVersion,
} from "../repository.mjs";

export const MOTION_CAPABILITY = "motion";
export const MOTION_RENDER_MIME = "video/mp4";
export const MOTION_RENDER_METHOD = "render";
export const MOTION_RENDERER_ID = "creative-motion-render/1";
// Cooperative cancel is polled every N frames so a mid-render human
// cancel request lands promptly without any table access.
const CANCEL_POLL_FRAMES = 12;

function fontSha256(fontDir) {
  const fontPath = fontDir
    ? path.join(fontDir, "Cairo.ttf")
    : fileURLToPath(new URL("./fonts/Cairo.ttf", import.meta.url));
  return sha256Hex(readFileSync(fontPath));
}

export async function claimMotionRenderJob(db, { worker, leaseSeconds = 120 }) {
  const row = await claimMotionJob(db, { worker, leaseSeconds });
  if (!row) return null;
  return { row, jobId: row.job_id ?? row.id };
}

export async function executeMotionRenderJob({
  db, storage, capture, encode, jobId, worker, fontDir,
  ffmpegPath, stagingDir, frameTimeoutMs = 60000, encodeTimeoutMs = 300000,
}) {
  if (!db || !storage || !capture || !encode) throw new Error("motion_worker_dependencies_required");
  if (!jobId || !worker) throw new Error("motion_worker_job_required");
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
    // Ownership/claim problems propagate raw: a foreign job is not ours to fail.
    throw error;
  }
  // Cooperative cancel that arrived between claim and execution: the marker
  // already terminalized the job, so report cancellation, not failure.
  if (running === "cancelled") await fail("cancelled", "motion_cancel_requested");
  try {
    if ((await countRenderOutputs(db, { jobId, worker })) > 0) {
      await fail("deterministic", "motion_duplicate_execution");
    }
    let input = null;
    try {
      input = await getMotionInput(db, { jobId, worker });
    } catch (error) {
      await fail("deterministic", `motion_input_unresolvable:${error.message}`.slice(0, 200));
    }
    if (!input) await fail("deterministic", "motion_input_missing");
    const motion = input.motion?.spec;
    const designDoc = input.design?.spec;
    let plan = null;
    try {
      if (motion?.design_template_id !== input.design?.id) await fail("deterministic", "motion_design_ref_mismatch");
      if (motion?.design_version !== undefined && motion?.design_version !== input.design?.version) {
        await fail("deterministic", "motion_design_version_mismatch");
      }
      plan = planTimeline(motion, designDoc);
    } catch (error) {
      if (error && error.errorClass) throw error;
      await fail("deterministic", `motion_document_invalid:${error.message}`.slice(0, 200));
    }
    const assets = new Map();
    for (const source of input.source_assets ?? []) {
      let stored = null;
      try {
        stored = await storage.get(source.object_key);
      } catch {
        stored = null;
      }
      if (!stored) await fail("deterministic", `motion_source_artifact_missing:${source.version_id}`);
      assets.set(source.version_id, { bytes: stored.bytes, mime: stored.mime });
    }
    const fontCss = bundledFontCss(fontDir);
    const fontHash = fontSha256(fontDir);
    const motionName = String(input.motion?.name ?? "motion").slice(0, 120);
    const canvas = designDoc.canvas;
    const frames = [];
    let attemptedExternal = 0;
    for (let index = 0; index < plan.totalFrames; index += 1) {
      if (index % CANCEL_POLL_FRAMES === 0) {
        let state = null;
        try {
          state = await getMotionState(db, { jobId, worker });
        } catch (error) {
          await fail("transient", `motion_state_unreadable:${error.message}`.slice(0, 200));
        }
        if (!state || state.status === "cancelled" || state.cancel_requested) {
          await fail("cancelled", "motion_cancel_requested");
        }
        if (state.status !== "running" && state.status !== "claimed") {
          await fail("deterministic", `motion_job_inactive:${state.status}`);
        }
      }
      const t = (index * 1000) / plan.fps;
      const { html } = buildMotionFrameHtml({ motion, designDoc, assets, fontCss, fontFamily: "Cairo", t });
      let shot = null;
      try {
        shot = await capture({ html, width: canvas.width, height: canvas.height, pageId: `frame-${index}`, pageIndex: index, timeoutMs: frameTimeoutMs });
      } catch (error) {
        await fail("transient", `motion_capture_failed:${error.message}`.slice(0, 200));
      }
      attemptedExternal += shot.attemptedExternal ?? 0;
      if ((shot.attemptedExternal ?? 0) > 0) {
        await fail("deterministic", "motion_external_network_attempted");
      }
      try {
        assertPngBytes(shot.bytes, { width: canvas.width, height: canvas.height });
      } catch (error) {
        await fail("deterministic", `motion_frame_invalid:${error.message}`.slice(0, 200));
      }
      frames.push(shot.bytes);
    }
    const ffmpeg = ffmpegPath ?? resolveFfmpegPath();
    const outputPath = path.join(stagingDir ?? tmpdir(), `tmg-${jobId}-v1.mp4`);
    const args = buildFfmpegArgs({ width: canvas.width, height: canvas.height, fps: plan.fps, outputPath });
    let mp4 = null;
    try {
      mp4 = await encode({ ffmpegPath: ffmpeg, args, frames, outputPath, timeoutMs: encodeTimeoutMs });
    } catch (error) {
      if (/timeout/i.test(error.message)) await fail("transient", `motion_encode_timeout:${error.message}`.slice(0, 200));
      if (/spawn|ENOENT|missing|absent/i.test(error.message)) await fail("deterministic", `motion_encoder_unavailable:${error.message}`.slice(0, 200));
      await fail("transient", `motion_encode_failed:${error.message}`.slice(0, 200));
    }
    let checked = null;
    try {
      checked = validateMp4(mp4, { width: canvas.width, height: canvas.height, fps: plan.fps, frames: frames.length });
    } catch (error) {
      await fail("deterministic", `motion_output_invalid:${error.message}`.slice(0, 200));
    }
    const objectKey = `t/${input.organization_id}/motion/${jobId}/v1.mp4`;
    try {
      const written = await storage.put(objectKey, mp4, MOTION_RENDER_MIME);
      if (written && written.sha256 && written.sha256.toLowerCase() !== sha256Hex(mp4)) {
        await fail("deterministic", "motion_checksum_mismatch");
      }
    } catch (error) {
      if (/object_key_exists|object_key_immutable/.test(error.message)) {
        await fail("deterministic", "motion_output_key_exists");
      }
      await fail("transient", `motion_storage_failed:${error.message}`.slice(0, 200));
    }
    const provenance = {
      renderer: MOTION_RENDERER_ID,
      method: MOTION_RENDER_METHOD,
      motion_template_id: input.motion.id,
      motion_name: motionName,
      motion_version: input.motion.version,
      design_template_id: input.design.id,
      design_name: String(input.design?.name ?? "design").slice(0, 120),
      design_version: input.design.version,
      document_kind: designDoc.kind,
      canvas: { width: canvas.width, height: canvas.height },
      fps: plan.fps,
      frames: frames.length,
      duration_ms: plan.totalMs,
      codec: "mpeg4",
      container: "mp4",
      font_family: "Cairo",
      font_sha256: fontHash,
      brand_kit_version_id: input.brand_kit_version?.id ?? null,
      source_asset_version_ids: (input.source_assets ?? []).map((source) => source.version_id),
      correlation_id: input.correlation_id,
      job_id: jobId,
    };
    let versionId = null;
    try {
      versionId = await registerVersion(db, {
        jobId, worker,
        assetId: null,
        title: `${motionName} · ${plan.fps}fps · ${frames.length}f`.slice(0, 200),
        mime: MOTION_RENDER_MIME,
        width: canvas.width, height: canvas.height, durationMs: plan.totalMs,
        bytes: mp4.length, sha256: sha256Hex(mp4), objectKey,
        provenance, templateRef: motionName,
        method: MOTION_RENDER_METHOD,
      });
    } catch (error) {
      await fail("transient", `motion_version_register_failed:${error.message}`.slice(0, 200));
    }
    await completeJob(db, { jobId, worker, assetVersionId: versionId });
    return {
      jobId,
      correlationId: input.correlation_id,
      capability: MOTION_CAPABILITY,
      versionId,
      slides: [],
      output: {
        objectKey, sha256: sha256Hex(mp4), bytes: mp4.length,
        width: canvas.width, height: canvas.height, fps: plan.fps,
        frames: frames.length, durationMs: plan.totalMs,
      },
      attemptedExternalTotal: attemptedExternal,
    };
  } catch (error) {
    if (error && error.errorClass) throw error;
    await fail("transient", `motion_worker_failed:${error.message}`.slice(0, 200));
  }
}
