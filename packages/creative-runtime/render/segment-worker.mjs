// CPU segmentation worker (P2a follow-up). Executes one claimed
// capability=product_shoot, lane=cpu, operation=segment job end to end:
//
//   claimed job -> mark running -> get_creative_segment_input() ->
//   tenant-checked source bytes -> engine (BiRefNet bridge or local
//   deterministic) -> mask + cutout validation -> private storage ->
//   mask v1 + cutout v2 of ONE asset lineage ->
//   complete/fail job with provenance.
//
// The source asset is never mutated. The original ML mask always
// persists as v1 even when refinement shapes the cutout. Every
// database access is a controlled SECURITY DEFINER function via
// repository.mjs; the worker never reads tables.
import path from "node:path";
import { tmpdir } from "node:os";
import { readFile, rm, writeFile } from "node:fs/promises";
import sharp from "sharp";

import {
  SEGMENT_ENGINES,
  assertPngImage,
  normalizeSegmentRequest,
  probeSource,
  runBirefnetBridge,
  segmentLocalDeterministic,
} from "../adapters/segmentation.mjs";
import { sha256Hex } from "../storage/keys.mjs";
import {
  claimSegmentJob,
  completeJob,
  countRenderOutputs,
  failJob,
  getRenderVersionAsset,
  getSegmentInput,
  getSegmentSource,
  getSegmentState,
  markRunning,
  registerVersion,
} from "../repository.mjs";

export const SEGMENT_CAPABILITY = "product_shoot";
export const SEGMENT_LANE = "cpu";
export const SEGMENT_RENDER_METHOD = "segment";
export const SEGMENT_RENDERER_ID = "creative-segment-render/1";
// Cooperative cancel is polled around (not inside) the single inference
// call; the bridge also receives an AbortSignal for mid-run termination.
const SEGMENT_CANCEL_POLL_MS = 5000;

export async function claimSegmentRenderJob(db, { worker, leaseSeconds = 120 }) {
  const row = await claimSegmentJob(db, { worker, leaseSeconds });
  if (!row) return null;
  return { row, jobId: row.job_id ?? row.id };
}

export async function executeSegmentJob({
  db, storage, jobId, worker, stagingDir,
  birefnet = null, localEngine = null,
}) {
  if (!db || !storage) throw new Error("segment_worker_dependencies_required");
  if (!jobId || !worker) throw new Error("segment_worker_job_required");
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
  if (running === "cancelled") await fail("cancelled", "segment_cancel_requested");
  try {
    if ((await countRenderOutputs(db, { jobId, worker })) > 0) {
      await fail("deterministic", "segment_duplicate_execution");
    }
    let input = null;
    try {
      input = await getSegmentInput(db, { jobId, worker });
    } catch (error) {
      await fail("deterministic", `segment_input_unresolvable:${error.message}`.slice(0, 200));
    }
    if (!input) await fail("deterministic", "segment_input_missing");
    const params = input.params ?? {};
    const ref = params.source_asset_version_id;
    if (typeof ref !== "string" || ref.length === 0) {
      await fail("deterministic", "segment_source_ref_missing");
    }
    const engine = params.engine ?? "local-deterministic";
    if (!SEGMENT_ENGINES.includes(engine)) await fail("deterministic", "segment_engine_allowlist");
    if (engine === "birefnet" && !birefnet) {
      await fail("deterministic", "segment_birefnet_unconfigured");
    }
    let source = null;
    try {
      source = await getSegmentSource(db, { jobId, worker, versionId: ref });
    } catch {
      source = null;
    }
    if (!source) await fail("deterministic", `segment_source_not_found:${ref}`);
    let sourceBytes = null;
    try {
      const stored = await storage.get(source.object_key);
      if (!stored) await fail("deterministic", `segment_source_artifact_missing:${ref}`);
      sourceBytes = stored.bytes;
    } catch (error) {
      if (error && error.errorClass) throw error;
      await fail("transient", `segment_source_unreadable:${error.message}`.slice(0, 200));
    }
    let probed = null;
    try {
      probed = await probeSource(sourceBytes);
    } catch (error) {
      await fail("deterministic", `segment_source_invalid:${error.message}`.slice(0, 200));
    }
    let request = null;
    try {
      request = normalizeSegmentRequest({
        engine, mime: probed.mime, width: probed.width, height: probed.height,
        bytesLength: sourceBytes.length, refine: params.refine ?? {},
      });
    } catch (error) {
      await fail("deterministic", `segment_request_invalid:${error.message}`.slice(0, 200));
    }
    try {
      const state = await getSegmentState(db, { jobId, worker });
      if (!state || state.status === "cancelled" || state.cancel_requested) {
        await fail("cancelled", "segment_cancel_requested");
      }
    } catch (error) {
      if (error && error.errorClass) throw error;
      await fail("transient", `segment_state_unreadable:${error.message}`.slice(0, 200));
    }
    const aborter = new AbortController();
    const cancelWatcher = setInterval(() => {
      void (async () => {
        try {
          const state = await getSegmentState(db, { jobId, worker });
          if (!state || state.status === "cancelled" || state.cancel_requested) aborter.abort();
        } catch {}
      })();
    }, SEGMENT_CANCEL_POLL_MS);
    let maskPng = null;
    let cutoutPng = null;
    let maskMeta = null;
    try {
      if (engine === "birefnet") {
        const staged = await stageInput({ stagingDir, jobId, bytes: sourceBytes, ext: probed.ext });
        try {
          const report = await runBirefnetBridge({
            pythonBin: birefnet.pythonBin, bridgeScript: birefnet.bridgeScript,
            codeDir: birefnet.codeDir, weightsPath: birefnet.weightsPath,
            inputPath: staged.inputPath, outputMaskPath: staged.maskPath,
            size: birefnet.size ?? 1024, device: birefnet.device ?? "cpu",
            timeoutMs: birefnet.timeoutMs ?? 600000, signal: aborter.signal,
            spawnFn: birefnet.spawnFn,
          });
          maskMeta = { ...report, engine: "birefnet", model: birefnet.model ?? "BiRefNet", weights: birefnet.weightsRef ?? null };
          maskPng = await readFile(staged.maskPath);
        } finally {
          await cleanupPaths([staged.inputPath, staged.maskPath]);
        }
      } else {
        const local = localEngine ?? segmentLocalDeterministic;
        const result = await local({ bytes: sourceBytes, refine: request.refine });
        maskPng = result.maskPng;
        cutoutPng = result.cutoutPng;
        maskMeta = {
          engine: "local-deterministic", width: result.width, height: result.height,
          coverage: result.coverage, provenance: result.provenance,
        };
      }
    } catch (error) {
      if (error?.name === "AbortError" || /abort|cancel/i.test(error?.message ?? "")) {
        await fail("cancelled", "segment_cancel_requested");
      }
      if (/timeout/i.test(error?.message ?? "")) {
        await fail("transient", `segment_inference_timeout:${error.message}`.slice(0, 200));
      }
      await fail("transient", `segment_inference_failed:${error.message}`.slice(0, 200));
    } finally {
      clearInterval(cancelWatcher);
    }
    try {
      const posted = await getSegmentState(db, { jobId, worker });
      if (!posted || posted.status === "cancelled" || posted.cancel_requested) {
        await fail("cancelled", "segment_cancel_requested");
      }
    } catch (error) {
      if (error && error.errorClass) throw error;
      await fail("transient", `segment_state_unreadable:${error.message}`.slice(0, 200));
    }
    // Original mask persists untouched; refinement (if any) shapes only
    // the cutout alpha, reproducibly from v1 + recorded params.
    assertPngImage(maskPng, { width: probed.width, height: probed.height });
    if (!cutoutPng) {
      cutoutPng = await applyMask(sourceBytes, maskPng, request.refine, probed);
    }
    assertPngImage(cutoutPng, { width: probed.width, height: probed.height });
    const maskKey = buildSegmentKey({ organizationId: input.organization_id, jobId, version: 1 });
    const cutoutKey = buildSegmentKey({ organizationId: input.organization_id, jobId, version: 2 });
    for (const [key, bytes, label] of [[maskKey, maskPng, "mask"], [cutoutKey, cutoutPng, "cutout"]]) {
      try {
        const written = await storage.put(key, bytes, "image/png");
        if (written && written.sha256 && written.sha256.toLowerCase() !== sha256Hex(bytes)) {
          await fail("deterministic", `segment_checksum_mismatch:${label}`);
        }
      } catch (error) {
        if (/object_key_exists|object_key_immutable/.test(error.message)) {
          await fail("deterministic", `segment_output_key_exists:${label}`);
        }
        await fail("transient", `segment_storage_failed:${label}:${error.message}`.slice(0, 200));
      }
    }
    const baseProvenance = {
      renderer: SEGMENT_RENDERER_ID,
      method: SEGMENT_RENDER_METHOD,
      operation: "segment",
      engine,
      source_asset_version_id: ref,
      source: { width: probed.width, height: probed.height, mime: probed.mime },
      refine: request.refine,
      mask: maskMeta,
      correlation_id: input.correlation_id,
      job_id: jobId,
    };
    let maskVersionId = null;
    try {
      maskVersionId = await registerVersion(db, {
        jobId, worker, assetId: null,
        title: "Segmentation mask",
        mime: "image/png", width: probed.width, height: probed.height,
        bytes: maskPng.length, sha256: sha256Hex(maskPng), objectKey: maskKey,
        provenance: { ...baseProvenance, kind: "mask" },
        templateRef: null, method: SEGMENT_RENDER_METHOD,
      });
    } catch (error) {
      await fail("transient", `segment_version_register_failed:mask:${error.message}`.slice(0, 200));
    }
    let assetId = null;
    try {
      assetId = await getRenderVersionAsset(db, { jobId, worker, versionId: maskVersionId });
    } catch (error) {
      await fail("transient", `segment_asset_lookup_failed:${error.message}`.slice(0, 200));
    }
    let cutoutVersionId = null;
    try {
      cutoutVersionId = await registerVersion(db, {
        jobId, worker, assetId,
        title: "Transparent cutout",
        mime: "image/png", width: probed.width, height: probed.height,
        bytes: cutoutPng.length, sha256: sha256Hex(cutoutPng), objectKey: cutoutKey,
        provenance: { ...baseProvenance, kind: "cutout", mask_version_id: maskVersionId },
        templateRef: null, method: SEGMENT_RENDER_METHOD,
      });
    } catch (error) {
      await fail("transient", `segment_version_register_failed:cutout:${error.message}`.slice(0, 200));
    }
    await completeJob(db, { jobId, worker, assetVersionId: cutoutVersionId });
    return {
      jobId,
      correlationId: input.correlation_id,
      capability: SEGMENT_CAPABILITY,
      assetId,
      maskVersionId,
      cutoutVersionId,
      output: {
        maskKey, cutoutKey,
        maskSha256: sha256Hex(maskPng), cutoutSha256: sha256Hex(cutoutPng),
        width: probed.width, height: probed.height,
      },
    };
  } catch (error) {
    if (error && error.errorClass) throw error;
    await fail("transient", `segment_worker_failed:${error.message}`.slice(0, 200));
  }
}

export function buildSegmentKey({ organizationId, jobId, version }) {
  if (!/^[0-9a-f-]{36}$/i.test(organizationId ?? "") || !/^[0-9a-f-]{36}$/i.test(jobId ?? "")) {
    throw new Error("segment_key_scope");
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("segment_key_shape");
  }
  return `t/${organizationId}/product_shoot/${jobId}/v${version}.png`;
}

async function stageInput({ stagingDir, jobId, bytes, ext }) {
  const { mkdir } = await import("node:fs/promises");
  const root = stagingDir ?? `${tmpdir()}/seg-${jobId}`;
  await mkdir(root, { recursive: true });
  const inputPath = `${root}/source.${ext}`;
  const maskPath = `${root}/mask.png`;
  await writeFile(inputPath, bytes);
  return { inputPath, maskPath };
}

async function cleanupPaths(paths) {
  for (const path of paths) {
    try {
      await rm(path, { force: true });
    } catch {}
  }
}

// Applies a (possibly refined) grayscale mask as the alpha channel of the
// source image. RGB channels pass through untouched, so product pixels —
// logos, text, colors — are preserved by construction.
async function applyMask(sourceBytes, maskPng, refine, probed) {
  const { data, info } = await sharp(sourceBytes, { limitInputPixels: 80000000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let alpha = await sharp(maskPng, { limitInputPixels: 80000000 }).raw().toBuffer();
  if (refine.feather_px > 0) {
    alpha = await sharp(alpha, { raw: { width: info.width, height: info.height, channels: 1 } }).blur(refine.feather_px).raw().toBuffer();
    alpha = Buffer.from(alpha);
  }
  const rgba = Buffer.from(data);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
    rgba[i + 3] = alpha[p];
  }
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}
