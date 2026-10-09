// CPU design/carousel render worker (P2b). Executes one claimed
// capability=design|carousel, lane=cpu job end to end WITHOUT touching the
// authenticated preview HTTP route:
//
//   claimed job -> mark running -> get_creative_render_input() ->
//   pinned document + tenant-checked private source assets ->
//   offline capture per page -> PNG validation -> private storage ->
//   create_creative_asset_version() per output -> complete/fail job.
//
// Carousel jobs persist as ONE asset with N ordered versions (page_index in
// provenance) under a single correlation lineage. Ad jobs persist one
// asset with one version. Every mutation flows through the controlled
// SECURITY DEFINER functions; the worker never writes tables directly.
//
// Dependencies are injected (`db` pg-compatible, `storage` put/get,
// `capture` screenshot) so unit tests run without browsers or databases.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { buildPageHtml, bundledFontCss, validateDocument } from "./document.mjs";
import { buildObjectKey, sha256Hex } from "../storage/keys.mjs";
import { completeJob, claimJob, failJob, markRunning, registerVersion } from "../repository.mjs";

export const DESIGN_CAPABILITIES = Object.freeze(["design", "carousel"]);
export const DESIGN_RENDER_MIME = "image/png";
export const DESIGN_RENDER_METHOD = "render";
export const DESIGN_RENDERER_ID = "creative-design-render/1";
export const MAX_RENDER_BYTES = 25 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Authoritative canvas sizes mirror the document contracts. The render API
// enforces format/canvas agreement at enqueue; the worker re-asserts it so
// a hand-enqueued job cannot render a mismatched format.
const FORMAT_DIMENSIONS = Object.freeze({
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
  "9:16": [1080, 1920],
});

function fontSha256(fontDir) {
  const root = fontDir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");
  return sha256Hex(readFileSync(path.join(root, "Cairo.ttf")));
}

export function assertPngBytes(bytes, { width, height }) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33) throw new Error("render_output_empty");
  if (bytes.length > MAX_RENDER_BYTES) throw new Error("render_output_too_large");
  if (!bytes.subarray(0, 8).equals(PNG_MAGIC)) throw new Error("render_output_not_png");
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("render_output_bad_ihdr");
  }
  const actualWidth = bytes.readUInt32BE(16);
  const actualHeight = bytes.readUInt32BE(20);
  if (actualWidth !== width || actualHeight !== height) {
    throw new Error(`render_output_dimensions:${actualWidth}x${actualHeight}`);
  }
  return { width: actualWidth, height: actualHeight, bytes: bytes.length, sha256: sha256Hex(bytes) };
}

function collectAssetRefs(doc) {
  const refs = [];
  const seen = new Set();
  const push = (node) => {
    if (node && typeof node.asset_version_id === "string" && !seen.has(node.asset_version_id)) {
      seen.add(node.asset_version_id);
      refs.push(node.asset_version_id);
    }
  };
  if (doc.kind === "carousel") {
    for (const page of doc.pages ?? []) for (const node of page.nodes ?? []) push(node);
  } else {
    for (const node of doc.nodes ?? []) push(node);
  }
  const background = doc.background ?? {};
  if (typeof background.image_version_id === "string" && !seen.has(background.image_version_id)) {
    seen.add(background.image_version_id);
    refs.push(background.image_version_id);
  }
  return refs;
}

export async function getRenderInput(db, { jobId, worker }) {
  const result = await db.query(`SELECT tanaghom.get_creative_render_input($1,$2) AS input`, [jobId, worker]);
  return result.rows[0]?.input ?? null;
}

async function loadSourceAssets(db, storage, { organizationId, refs, fail }) {
  const assets = new Map();
  for (const ref of refs) {
    const found = await db.query(
      `SELECT version.object_key, version.mime
         FROM tanaghom.creative_asset_versions version
         JOIN tanaghom.creative_assets asset ON asset.id = version.asset_id
        WHERE version.id = $1 AND asset.organization_id = $2`,
      [ref, organizationId],
    );
    const row = found.rows[0];
    if (!row) await fail("deterministic", `render_source_asset_not_found:${ref}`);
    let stored = null;
    try {
      stored = await storage.get(row.object_key);
    } catch {
      stored = null;
    }
    if (!stored) await fail("deterministic", `render_source_artifact_missing:${ref}`);
    assets.set(ref, { bytes: stored.bytes, mime: stored.mime });
  }
  return assets;
}

// Bounded claim helper for the manual/operator runner. Returns the claimed
// row, or null when the queue is empty or the oldest job belongs to another
// capability (that job is left claimed for its own lane; the lease reaper
// returns it — the design worker never touches foreign jobs).
export async function claimDesignRenderJob(db, { lane = "cpu", worker, leaseSeconds = 120 }) {
  const row = await claimJob(db, { lane, worker, leaseSeconds });
  if (!row) return null;
  const capability = row.capability ?? row.capability_name;
  if (!DESIGN_CAPABILITIES.includes(capability)) return { skipped: true, row };
  return { skipped: false, row, jobId: row.job_id ?? row.id };
}

function slideTitle(name, format, index, count) {
  return `${name} · ${format} · slide ${index + 1}/${count}`.slice(0, 200);
}

export async function executeDesignRenderJob({ db, storage, capture, jobId, worker, fontDir }) {
  if (!db || !storage || !capture) throw new Error("render_worker_dependencies_required");
  if (!jobId || !worker) throw new Error("render_worker_job_required");
  // The job must already be claimed by this worker; a mismatch throws here
  // before any failure is recorded, because a foreign job is not ours to fail.
  await markRunning(db, { jobId, worker });
  const fail = async (errorClass, message) => {
    try {
      await failJob(db, { jobId, worker, errorClass, errorMessage: message.slice(0, 500) });
    } catch {
      // Failure recording is best effort; the original error still throws.
    }
    const error = new Error(message);
    error.errorClass = errorClass;
    throw error;
  };
  try {
    const prior = await db.query(
      `SELECT count(*)::int AS n FROM tanaghom.creative_asset_versions WHERE job_id = $1`,
      [jobId],
    );
    if ((prior.rows[0]?.n ?? 0) > 0) await fail("deterministic", "render_duplicate_execution");
    let input = null;
    try {
      input = await getRenderInput(db, { jobId, worker });
    } catch (error) {
      await fail("deterministic", `render_input_unresolvable:${error.message}`.slice(0, 200));
    }
    if (!input) await fail("deterministic", "render_input_missing");
    if (!DESIGN_CAPABILITIES.includes(input.capability)) await fail("deterministic", `render_capability_unsupported:${input.capability}`);
    const doc = input.template?.spec;
    try {
      validateDocument(doc);
    } catch (error) {
      await fail("deterministic", `render_document_invalid:${error.message}`.slice(0, 200));
    }
    const canvas = doc.canvas;
    const format = input.params?.format;
    if (typeof format === "string" && FORMAT_DIMENSIONS[format]) {
      const [expectedWidth, expectedHeight] = FORMAT_DIMENSIONS[format];
      if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
        await fail("deterministic", "render_format_canvas_mismatch");
      }
    }
    const pageIds = doc.kind === "carousel" ? doc.pages.map((page) => page.id) : ["page-1"];
    const refs = collectAssetRefs(doc);
    const assets = await loadSourceAssets(db, storage, { organizationId: input.organization_id, refs, fail });
    const fontCss = bundledFontCss(fontDir);
    const fontHash = fontSha256(fontDir);
    const designName = String(input.template?.name ?? "design").slice(0, 120);
    const slides = [];
    let assetVersionId = null;
    let assetId = null;
    for (let index = 0; index < pageIds.length; index += 1) {
      const pageId = pageIds[index];
      const html = buildPageHtml({ doc, pageId, assets, fontCss, fontFamily: "Cairo" });
      let shot = null;
      try {
        shot = await capture({ html, width: canvas.width, height: canvas.height, pageId, pageIndex: index });
      } catch (error) {
        await fail("transient", `render_capture_failed:${error.message}`.slice(0, 200));
      }
      if ((shot.attemptedExternal ?? 0) > 0) {
        await fail("deterministic", "render_external_network_attempted");
      }
      let checked = null;
      try {
        checked = assertPngBytes(shot.bytes, { width: canvas.width, height: canvas.height });
      } catch (error) {
        await fail("deterministic", `render_output_invalid:${error.message}`.slice(0, 200));
      }
      const objectKey = buildObjectKey({
        organizationId: input.organization_id,
        capability: input.capability,
        assetId: jobId,
        version: index + 1,
        mime: DESIGN_RENDER_MIME,
      });
      try {
        const written = await storage.put(objectKey, shot.bytes, DESIGN_RENDER_MIME);
        if (written && written.sha256 && written.sha256.toLowerCase() !== checked.sha256) {
          await fail("deterministic", "render_checksum_mismatch");
        }
      } catch (error) {
        if (/object_key_exists|object_key_immutable/.test(error.message)) {
          await fail("deterministic", "render_output_key_exists");
        }
        await fail("transient", `render_storage_failed:${error.message}`.slice(0, 200));
      }
      const provenance = {
        renderer: DESIGN_RENDERER_ID,
        method: DESIGN_RENDER_METHOD,
        design_template_id: input.template.id,
        design_name: designName,
        design_version: input.template.version,
        document_kind: doc.kind,
        canvas: { width: canvas.width, height: canvas.height },
        format: format ?? null,
        page_id: pageId,
        page_index: index,
        page_count: pageIds.length,
        font_family: "Cairo",
        font_sha256: fontHash,
        brand_kit_version_id: input.brand_kit_version?.id ?? null,
        source_asset_version_ids: refs,
        correlation_id: input.correlation_id,
        job_id: jobId,
      };
      try {
        assetVersionId = await registerVersion(db, {
          jobId, worker,
          assetId,
          title: slideTitle(designName, format ?? `${canvas.width}x${canvas.height}`, index, pageIds.length),
          mime: DESIGN_RENDER_MIME,
          width: canvas.width, height: canvas.height,
          bytes: checked.bytes, sha256: checked.sha256, objectKey,
          provenance, templateRef: designName,
          method: DESIGN_RENDER_METHOD,
        });
      } catch (error) {
        await fail("transient", `render_version_register_failed:${error.message}`.slice(0, 200));
      }
      if (assetId === null) {
        const created = await db.query(
          `SELECT asset_id FROM tanaghom.creative_asset_versions WHERE id = $1`, [assetVersionId],
        );
        assetId = created.rows[0]?.asset_id ?? null;
      }
      slides.push({
        pageId, pageIndex: index, versionId: assetVersionId, objectKey,
        sha256: checked.sha256, bytes: checked.bytes, width: canvas.width, height: canvas.height,
      });
    }
    await completeJob(db, { jobId, worker, assetVersionId });
    return {
      jobId,
      correlationId: input.correlation_id,
      capability: input.capability,
      assetId,
      versionIds: slides.map((slide) => slide.versionId),
      slides,
      attemptedExternalTotal: 0,
    };
  } catch (error) {
    if (error && error.errorClass) throw error;
    await fail("transient", `render_worker_failed:${error.message}`.slice(0, 200));
  }
}
