// Bounded MP4 encode and validation for Motion Studio (P3). Zero new
// dependencies. FFmpeg is a deployment-provided binary, never bundled:
// the worker resolves it via FFMPEG_PATH or PATH `ffmpeg` and fails
// closed when absent. Arguments are constructed from validated integers
// against a fixed allowlist — user-controlled strings never reach argv,
// no shell is ever used, no filter graphs exist. Validation is pure JS
// (ftyp/moov/mvhd/trak walk), so no ffprobe dependency is needed.
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";

export const MOTION_CODECS = Object.freeze(["mpeg4"]);
export const MOTION_CONTAINER = "mp4";
export const MOTION_PIXEL_FORMAT = "yuv420p";
export const MAX_MP4_BYTES = 100 * 1024 * 1024;

function assertFrameDims(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error("mp4_dimensions_required");
  if (width !== 1080 || ![1080, 1350, 1920].includes(height)) throw new Error("mp4_dimensions_unsupported");
}

function assertFps(fps) {
  if (fps !== 24 && fps !== 30) throw new Error("mp4_fps_allowlist");
}

// Fixed argv allowlist. Every token is either a literal or a validated
// integer formatted by this module; callers cannot inject options, filters,
// URLs, or file paths. Input is stdin PNG frames (image2pipe lets FFmpeg's
// own decoder handle pixels — no raw-video plumbing, no user pixel
// formats). Output goes to a worker-generated temp file because the MP4
// muxer requires seekable output for `+faststart`; stdout is deliberately
// not an allowed output. The temp path is validated before use and removed
// after the bytes are read.
export function assertSafeOutputPath(path) {
  if (typeof path !== "string" || path.length < 6 || path.length > 512) throw new Error("mp4_output_path_rejected");
  // No shell ever interprets this path (argv array only), so the reject
  // set targets quoting/command separators and controls; path separators
  // including Windows backslashes are legitimate.
  if (path.includes("\0") || /["'$`\n\r;|&<>()*?~#]/.test(path)) throw new Error("mp4_output_path_rejected");
  if (!path.toLowerCase().endsWith(".mp4")) throw new Error("mp4_output_path_rejected");
  return path;
}

export function buildFfmpegArgs({ width, height, fps, codec = "mpeg4", outputPath }) {
  assertFrameDims(width, height);
  assertFps(fps);
  if (!MOTION_CODECS.includes(codec)) throw new Error("mp4_codec_allowlist");
  assertSafeOutputPath(outputPath);
  return Object.freeze([
    "-y",
    "-f", "image2pipe",
    "-framerate", String(fps),
    "-c:v", "png",
    "-i", "pipe:0",
    "-an",
    "-s", `${width}x${height}`,
    "-c:v", codec,
    "-pix_fmt", MOTION_PIXEL_FORMAT,
    "-movflags", "+faststart",
    "-f", MOTION_CONTAINER,
    outputPath,
  ]);
}

export function resolveFfmpegPath(env = process.env) {
  const configured = (env.FFMPEG_PATH ?? "").trim();
  if (configured) {
    if (configured.includes("\0") || /["'$`\\]/.test(configured)) throw new Error("mp4_ffmpeg_path_rejected");
    if (configured.length > 512) throw new Error("mp4_ffmpeg_path_rejected");
    return configured;
  }
  return "ffmpeg";
}

export async function encodeMp4({ ffmpegPath, args, frames, outputPath, timeoutMs = 300000, spawnFn = spawn }) {
  if (!Array.isArray(args) || !Object.isFrozen(args)) throw new Error("mp4_args_must_be_allowlisted");
  assertSafeOutputPath(outputPath);
  if (!args.includes(outputPath)) throw new Error("mp4_output_path_mismatch");
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 900) throw new Error("mp4_frame_count");
  for (const frame of frames) {
    if (!Buffer.isBuffer(frame) || frame.length === 0) throw new Error("mp4_frame_bytes_required");
  }
  return new Promise((resolve, reject) => {
    let child = null;
    try {
      // No shell: argv array only, stdin piped PNGs, stdout ignored, the
      // output path is the validated allowlist member above.
      child = spawnFn(ffmpegPath, [...args], { stdio: ["pipe", "ignore", "pipe"] });
    } catch (error) {
      reject(new Error(`mp4_spawn_failed:${error.message}`));
      return;
    }
    let errTail = "";
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try {
          child.kill("SIGKILL");
        } catch {}
        reject(new Error("mp4_encode_timeout"));
      }
    }, timeoutMs);
    child.on("error", (error) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(new Error(`mp4_spawn_failed:${error.message}`));
      }
    });
    child.stderr.on("data", (chunk) => {
      errTail = `${errTail}${chunk.toString()}`.slice(-2000);
    });
    child.on("close", async (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`mp4_encode_failed:exit_${code}:${errTail.split("\n").filter((line) => /error/i.test(line)).join("|").slice(0, 300)}`));
        return;
      }
      try {
        const bytes = await readFile(outputPath);
        await rm(outputPath, { force: true });
        if (bytes.length === 0 || bytes.length > MAX_MP4_BYTES) {
          reject(new Error("mp4_output_size"));
          return;
        }
        resolve(bytes);
      } catch (error) {
        reject(new Error(`mp4_output_unreadable:${error.message}`));
      }
    });
    (async () => {
      try {
        for (const frame of frames) {
          if (finished) break;
          const ok = child.stdin.write(frame);
          if (!ok) {
            await new Promise((resolveDrain) => child.stdin.once("drain", resolveDrain));
          }
        }
        child.stdin.end();
      } catch (error) {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          reject(new Error(`mp4_input_failed:${error.message}`));
        }
      }
    })();
    child.stdin.on("error", () => {});
  });
}

// Minimal pure-JS MP4 validation: ftyp brand, one moov with mvhd
// timescale/duration, one video trak with tkhd dimensions. Rejects
// truncated, non-MP4, dimension-mismatched, and duration-skewed outputs.
export function validateMp4(bytes, { width, height, fps, frames }) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32) throw new Error("mp4_empty");
  if (bytes.length > MAX_MP4_BYTES) throw new Error("mp4_too_large");
  const top = readBoxes(bytes, 0, bytes.length);
  const ftyp = top.find((box) => box.type === "ftyp");
  if (!ftyp) throw new Error("mp4_missing_ftyp");
  const brand = bytes.toString("ascii", ftyp.start + 8, ftyp.start + 12);
  if (!["isom", "mp42", "mp41", "avc1", "iso2", "iso5", "iso6"].includes(brand)) {
    throw new Error(`mp4_brand:${brand}`);
  }
  const moov = top.find((box) => box.type === "moov");
  if (!moov) throw new Error("mp4_missing_moov");
  const inner = readBoxes(bytes, moov.start + 8, moov.end);
  const mvhd = inner.find((box) => box.type === "mvhd");
  if (!mvhd) throw new Error("mp4_missing_mvhd");
  const version = bytes[mvhd.start + 8];
  const timescale = version === 1
    ? bytes.readUInt32BE(mvhd.start + 28)
    : bytes.readUInt32BE(mvhd.start + 20);
  const duration = version === 1
    ? Number(bytes.readBigUInt64BE(mvhd.start + 32))
    : bytes.readUInt32BE(mvhd.start + 24);
  if (!Number.isFinite(timescale) || timescale <= 0) throw new Error("mp4_bad_timescale");
  const durationSec = duration / timescale;
  const expectedSec = frames / fps;
  if (Math.abs(durationSec - expectedSec) > 1 / fps + 0.05) {
    throw new Error(`mp4_duration:${durationSec.toFixed(3)}s_expected_${expectedSec.toFixed(3)}s`);
  }
  let trackDims = null;
  for (const trak of inner.filter((box) => box.type === "trak")) {
    const trakBoxes = readBoxes(bytes, trak.start + 8, trak.end);
    const tkhd = trakBoxes.find((box) => box.type === "tkhd");
    if (!tkhd) continue;
    const tkhdVersion = bytes[tkhd.start + 8];
    // v0: 4+4+4+4+4+4+8+8 before matrix; v1 widens creation/modification/
    // duration to 8 bytes (+12). Width/height are 16.16 fixed point.
    const base = tkhd.start + 8 + (tkhdVersion === 1 ? 88 : 76);
    const trackWidth = bytes.readUInt32BE(base) / 65536;
    const trackHeight = bytes.readUInt32BE(base + 4) / 65536;
    if (trackWidth > 0 && trackHeight > 0) {
      trackDims = { width: trackWidth, height: trackHeight };
      break;
    }
  }
  if (!trackDims) throw new Error("mp4_missing_track_dims");
  if (trackDims.width !== width || trackDims.height !== height) {
    throw new Error(`mp4_dimensions:${trackDims.width}x${trackDims.height}`);
  }
  return {
    brand,
    width: trackDims.width,
    height: trackDims.height,
    durationSec,
    fps,
    frames,
    bytes: bytes.length,
  };
}

function readBoxes(bytes, start, end) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(bytes.readBigUInt64BE(offset + 8));
      header = 16;
    }
    if (!Number.isFinite(size) || size < header || offset + size > end) break;
    boxes.push({ type, start: offset, end: Math.min(offset + size, end) });
    if (size === 0) break;
    offset += size;
  }
  return boxes;
}
