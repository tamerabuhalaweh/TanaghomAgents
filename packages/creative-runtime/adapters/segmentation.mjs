// Deterministic segmentation engines (P2a follow-up). Two named engines
// behind one `segment` operation boundary so Product Studio never
// hardwires a model:
//
// - local-deterministic: sharp-based auto-background segmentation for
//   fixtures, tests, and bounded refinement. No weights, no network.
// - birefnet: pinned BiRefNet inference through a fixed local Python
//   bridge (deployment-provisioned code+weights, never bundled).
//
// Every entry validates bounds first; no raw table or filesystem access
// beyond explicitly staged temp paths.
import sharp from "sharp";
import { spawn } from "node:child_process";

export const SEGMENT_ENGINES = Object.freeze(["birefnet", "local-deterministic"]);
export const SEGMENT_MIME_ALLOWLIST = Object.freeze(["image/png", "image/jpeg", "image/webp"]);
export const SEGMENT_MAX_LONG_EDGE = 2048;
export const SEGMENT_MAX_PIXELS = 16777216;
export const SEGMENT_MAX_BYTES = 20971520;
export const SEGMENT_BRIDGE_SIZES = Object.freeze([512, 768, 1024]);
export const SEGMENT_BRIDGE_DEVICES = Object.freeze(["cpu", "cuda"]);
export const REFINE_BOUNDS = Object.freeze({
  feather_px: [0, 8],
  erode_px: [0, 3],
  threshold: [1, 254],
});

function assertIntIn(value, [min, max], label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}_bounds`);
}

export function normalizeSegmentRequest({ engine, mime, width, height, bytesLength, refine = {} }) {
  if (!SEGMENT_ENGINES.includes(engine)) throw new Error("segment_engine_allowlist");
  if (!SEGMENT_MIME_ALLOWLIST.includes(mime)) throw new Error("segment_mime_allowlist");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8) {
    throw new Error("segment_dimensions");
  }
  if (Math.max(width, height) > SEGMENT_MAX_LONG_EDGE) throw new Error("segment_dimensions_too_large");
  if (width * height > SEGMENT_MAX_PIXELS) throw new Error("segment_pixels_too_many");
  if (!Number.isInteger(bytesLength) || bytesLength < 1 || bytesLength > SEGMENT_MAX_BYTES) {
    throw new Error("segment_bytes");
  }
  if (refine === null || typeof refine !== "object" || Array.isArray(refine)) {
    throw new Error("segment_refine_shape");
  }
  const clean = {};
  for (const [key, [min, max]] of Object.entries(REFINE_BOUNDS)) {
    const value = refine[key] ?? (key === "threshold" ? 48 : 0);
    assertIntIn(value, [min, max], `segment_refine_${key}`);
    clean[key] = value;
  }
  for (const key of Object.keys(refine)) {
    if (!(key in REFINE_BOUNDS)) throw new Error(`segment_refine_unknown:${key}`);
  }
  return { engine, mime, width, height, bytesLength, refine: clean };
}

function detectMime(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: "image/png", ext: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

export async function probeSource(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("segment_source_empty");
  if (bytes.length > SEGMENT_MAX_BYTES) throw new Error("segment_source_too_large");
  const detected = detectMime(bytes);
  if (!detected) throw new Error("segment_source_mime");
  const meta = await sharp(bytes, { limitInputPixels: 80000000 }).metadata();
  if (!meta.width || !meta.height) throw new Error("segment_source_unreadable");
  return { width: meta.width, height: meta.height, ...detected, bytesLength: bytes.length };
}

export function assertPngImage(bytes, { width, height }) {  if (!Buffer.isBuffer(bytes) || bytes.length < 33) throw new Error("segment_output_empty");
  if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error("segment_output_not_png");
  }
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("segment_output_bad_ihdr");
  }
  const actualWidth = bytes.readUInt32BE(16);
  const actualHeight = bytes.readUInt32BE(20);
  if (actualWidth !== width || actualHeight !== height) {
    throw new Error(`segment_output_dimensions:${actualWidth}x${actualHeight}`);
  }
  return { width: actualWidth, height: actualHeight, bytes: bytes.length };
}

function sampleBackground(data, width, height) {
  // Median of border pixels: robust background estimate without any model.
  const samples = [];
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  for (let x = 0; x < width; x += 4) {
    samples.push(at(x, 0), at(x, height - 1));
  }
  for (let y = 0; y < height; y += 4) {
    samples.push(at(0, y), at(width - 1, y));
  }
  samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  return samples[Math.floor(samples.length / 2)];
}

function erodeMask(mask, width, height, pixels) {
  let current = mask;
  for (let pass = 0; pass < pixels; pass += 1) {
    const next = Buffer.from(current);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        if (current[i] === 0) continue;
        if (current[i - 1] === 0 || current[i + 1] === 0 || current[i - width] === 0 || current[i + width] === 0) {
          next[i] = 0;
        }
      }
    }
    current = next;
  }
  return current;
}

export async function segmentLocalDeterministic({ bytes, refine = {} }) {
  const meta = await sharp(bytes, { limitInputPixels: 80000000 }).metadata();
  if (!meta.width || !meta.height) throw new Error("segment_unreadable_image");
  const { threshold, feather_px: feather, erode_px: erode } = normalizeSegmentRequest({
    engine: "local-deterministic",
    mime: meta.format === "jpeg" ? "image/jpeg" : meta.format === "webp" ? "image/webp" : "image/png",
    width: meta.width, height: meta.height, bytesLength: bytes.length, refine,
  }).refine;
  const { data, info } = await sharp(bytes, { limitInputPixels: 80000000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const [br, bg, bb] = sampleBackground(data, width, height);
  const mask = Buffer.alloc(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const dr = data[i] - br;
    const dg = data[i + 1] - bg;
    const db = data[i + 2] - bb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    mask[p] = dist > threshold ? 255 : 0;
  }
  const cleaned = erode > 0 ? erodeMask(mask, width, height, erode) : mask;
  let covered = 0;
  for (let p = 0; p < cleaned.length; p += 1) {
    if (cleaned[p]) covered += 1;
  }
  let alpha = cleaned;
  if (feather > 0) {
    const blurred = await sharp(cleaned, { raw: { width, height, channels: 1 } }).blur(feather).raw().toBuffer();
    alpha = Buffer.from(blurred);
  }
  const maskPng = await sharp(cleaned, { raw: { width, height, channels: 1 } }).png().toBuffer();
  const rgba = Buffer.from(data);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
    rgba[i + 3] = alpha[p];
  }
  const cutoutPng = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return {
    maskPng, cutoutPng, width, height,
    coverage: covered / (width * height),
    provenance: {
      adapter: "segmentation", engine: "local-deterministic",
      operation: "segment", threshold, feather_px: feather, erode_px: erode,
    },
  };
}

function assertSafePath(path, label) {
  if (typeof path !== "string" || path.length < 1 || path.length > 512 || path.includes("\0")) {
    throw new Error(`${label}_path_rejected`);
  }
  return path;
}

// Fixed-argv BiRefNet bridge runner. No shell, no dynamic code, no
// network: one pinned script, scalar-only validated arguments, a single
// JSON line on stdout, timeout kill. Model/code/weights are
// deployment-provisioned and validated here by shape only.
export async function runBirefnetBridge({
  pythonBin, bridgeScript, codeDir, weightsPath, inputPath, outputMaskPath,
  size = 1024, device = "cpu", timeoutMs = 600000, signal, spawnFn = spawn,
}) {
  for (const [label, value] of [["python", pythonBin], ["bridge", bridgeScript], ["code_dir", codeDir], ["weights", weightsPath], ["input", inputPath], ["output_mask", outputMaskPath]]) {
    assertSafePath(value, `segment_bridge_${label}`);
  }
  if (!SEGMENT_BRIDGE_SIZES.includes(size)) throw new Error("segment_bridge_size_allowlist");
  if (!SEGMENT_BRIDGE_DEVICES.includes(device)) throw new Error("segment_bridge_device_allowlist");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10000 || timeoutMs > 1800000) {
    throw new Error("segment_bridge_timeout_bounds");
  }
  const args = Object.freeze([
    bridgeScript,
    "--code-dir", codeDir,
    "--weights", weightsPath,
    "--input", inputPath,
    "--output-mask", outputMaskPath,
    "--size", String(size),
    "--device", device,
  ]);
  return new Promise((resolve, reject) => {
    let child = null;
    try {
      child = spawnFn(pythonBin, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(new Error(`segment_bridge_spawn_failed:${error.message}`));
      return;
    }
    let stdout = "";
    let stderr = "";
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try {
          child.kill("SIGKILL");
        } catch {}
        reject(new Error("segment_bridge_timeout"));
      }
    }, timeoutMs);
    child.on("error", (error) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(new Error(`segment_bridge_spawn_failed:${error.message}`));
      }
    });
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk.toString()}`.slice(-4096);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-2000);
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`segment_bridge_failed:exit_${code}:${stderr.split("\n").pop()?.slice(0, 200) ?? ""}`));
        return;
      }
      let report = null;
      try {
        report = JSON.parse(stdout.trim().split("\n").pop());
      } catch {
        reject(new Error("segment_bridge_malformed_report"));
        return;
      }
      if (!report || !/^[0-9a-f]{64}$/i.test(report.mask_sha256 ?? "")
        || !Number.isInteger(report.width) || !Number.isInteger(report.height)
        || !Number.isInteger(report.infer_ms) || !SEGMENT_BRIDGE_DEVICES.includes(report.device)) {
        reject(new Error("segment_bridge_invalid_report"));
        return;
      }
      resolve({
        maskSha256: report.mask_sha256.toLowerCase(),
        width: report.width, height: report.height,
        inferMs: report.infer_ms, device: report.device,
      });
    });
    child.stdin?.on("error", () => {});
    const onAbort = () => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        try {
          child.kill("SIGKILL");
        } catch {}
        reject(Object.assign(new Error("segment_bridge_aborted"), { name: "AbortError" }));
      }
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
