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
// Total intermediate byte budget across all frames of one encode. Typical
// screenshots are tens of KB; 900 worst-case frames stay far below this,
// while a runaway producer fails closed instead of exhausting the worker.
export const MAX_INTERMEDIATE_BYTES = 128 * 1024 * 1024;

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

// Incremental streaming encoder. Frames are written to FFmpeg as they are
// produced and discarded by the caller — no frame array is ever retained.
// Shape:
//
//   encoder = await beginMp4Encode(...)
//   await encoder.writeFrame(png)   // backpressure-aware, byte-budgeted
//   mp4 = await encoder.finish()    // ends stdin, awaits exit, reads+unlinks
//   await encoder.abort()           // kill, await exit, unlink temp
//
// Temp output is removed on EVERY exit path: success, timeout, spawn
// failure, non-zero exit, input failure, and abort/cancel. An AbortSignal
// may be supplied; aborting it terminates the child and settles pending
// operations as mp4_encode_aborted (errorClass 'cancelled').
export async function beginMp4Encode({
  ffmpegPath, args, outputPath, timeoutMs = 300000,
  maxIntermediateBytes = MAX_INTERMEDIATE_BYTES, signal, spawnFn = spawn,
}) {
  if (!Array.isArray(args) || !Object.isFrozen(args)) throw new Error("mp4_args_must_be_allowlisted");
  assertSafeOutputPath(outputPath);
  if (!args.includes(outputPath)) throw new Error("mp4_output_path_mismatch");
  if (!Number.isInteger(maxIntermediateBytes) || maxIntermediateBytes < 1024) {
    throw new Error("mp4_intermediate_budget");
  }
  let child = null;
  try {
    // No shell: argv array only, stdin piped PNGs, stdout ignored, the
    // output path is the validated allowlist member above.
    child = spawnFn(ffmpegPath, [...args], { stdio: ["pipe", "ignore", "pipe"] });
  } catch (error) {
    await rm(outputPath, { force: true });
    throw new Error(`mp4_spawn_failed:${error.message}`);
  }
  if (!child || typeof child.on !== "function" || !child.stdin || !child.stderr) {
    await rm(outputPath, { force: true });
    throw new Error("mp4_spawn_failed:invalid_child");
  }
  let state = "open";
  let bytesWritten = 0;
  let framesWritten = 0;
  let errTail = "";
  let exitCode = null;
  let exitError = null;
  let terminalError = null;
  let finishReject = null;
  const exitWaiters = [];
  function settleExit(code, error) {
    if (exitCode !== null || exitError !== null) return;
    if (error) exitError = error;
    else exitCode = code;
    for (const waiter of exitWaiters.splice(0)) waiter();
  }
  child.on("error", (error) => settleExit(null, error));
  child.on("close", (code) => settleExit(code, null));
  child.stderr.on("data", (chunk) => {
    errTail = `${errTail}${chunk.toString()}`.slice(-2000);
  });
  // One persistent stdin error listener: per-write `once("error")`
  // handlers would accumulate past MaxListeners on long renders.
  let stdinError = null;
  child.stdin.on("error", (error) => {
    stdinError = error;
  });
  const timer = setTimeout(() => {
    void terminate("mp4_encode_timeout", "transient");
  }, timeoutMs);
  async function removeTemp() {
    try {
      await rm(outputPath, { force: true });
    } catch {}
  }
  function awaitExit(graceMs = 5000) {
    if (exitCode !== null || exitError !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const grace = setTimeout(resolve, graceMs);
      exitWaiters.push(() => {
        clearTimeout(grace);
        resolve();
      });
    });
  }
  async function terminate(reason, errorClass) {
    if (state === "done" || state === "aborted") return terminalError;
    // The terminal error is fixed synchronously so concurrent finish()
    // continuations observe the true reason instead of a generic abort.
    const error = new Error(reason);
    if (errorClass) error.errorClass = errorClass;
    terminalError = error;
    state = "aborted";
    clearTimeout(timer);
    try {
      child.kill("SIGKILL");
    } catch {}
    await awaitExit();
    await removeTemp();
    if (finishReject) {
      const reject = finishReject;
      finishReject = null;
      reject(error);
    }
    return error;
  }
  if (signal) {
    if (signal.aborted) {
      await terminate("mp4_encode_aborted", "cancelled");
    }
    signal.addEventListener("abort", () => {
      void terminate("mp4_encode_aborted", "cancelled");
    }, { once: true });
  }
  async function writeFrame(frame) {
    if (state === "aborted") throw terminalError ?? new Error("mp4_encoder_closed");
    if (state !== "open") throw new Error("mp4_encoder_closed");
    if (!Buffer.isBuffer(frame) || frame.length === 0) throw new Error("mp4_frame_bytes_required");
    if (bytesWritten + frame.length > maxIntermediateBytes) {
      throw await terminate("mp4_intermediate_budget", "deterministic");
    }
    try {
      const ok = child.stdin.write(frame);
      if (!ok) {
        await new Promise((resolveDrain) => {
          child.stdin.once("drain", resolveDrain);
        });
      }
      if (stdinError) throw stdinError;
    } catch (error) {
      throw await terminate(`mp4_input_failed:${error.message}`, "transient");
    }
    bytesWritten += frame.length;
    framesWritten += 1;
    return { bytesWritten, framesWritten };
  }
  async function finish() {
    if (state === "aborted") throw terminalError ?? new Error("mp4_encoder_closed");
    if (state !== "open") throw new Error("mp4_encoder_closed");
    state = "finishing";
    try {
      child.stdin.end();
    } catch (error) {
      throw await terminate(`mp4_input_failed:${error.message}`, "transient");
    }
    return new Promise((resolveFinish, rejectFinish) => {
      finishReject = rejectFinish;
      void awaitExit().then(async () => {
        finishReject = null;
        if (state === "aborted") {
          rejectFinish(terminalError ?? new Error("mp4_encode_aborted"));
          return;
        }
        clearTimeout(timer);
        if (exitCode === null && !exitError) {
          state = "aborted";
          try {
            child.kill("SIGKILL");
          } catch {}
          await removeTemp();
          rejectFinish(new Error("mp4_encode_stalled"));
          return;
        }
        if (exitError) {
          state = "aborted";
          await removeTemp();
          rejectFinish(new Error(`mp4_spawn_failed:${exitError.message}`));
          return;
        }
        if (exitCode !== 0) {
          state = "aborted";
          await removeTemp();
          rejectFinish(new Error(`mp4_encode_failed:exit_${exitCode}:${errTail.split("\n").filter((line) => /error/i.test(line)).join("|").slice(0, 300)}`));
          return;
        }
        state = "done";
        try {
          const bytes = await readFile(outputPath);
          await removeTemp();
          if (bytes.length === 0 || bytes.length > MAX_MP4_BYTES) {
            rejectFinish(new Error("mp4_output_size"));
            return;
          }
          resolveFinish(bytes);
        } catch (error) {
          if (error.message.startsWith("mp4_")) rejectFinish(error);
          else rejectFinish(new Error(`mp4_output_unreadable:${error.message}`));
        }
      });
    });
  }
  async function abort() {
    throw (await terminate("mp4_encode_aborted", "cancelled")) ?? new Error("mp4_encode_aborted");
  }
  return Object.freeze({ writeFrame, finish, abort });
}

// Convenience wrapper preserving the all-frames call shape. Streaming
// callers should use beginMp4Encode directly.
export async function encodeMp4({ ffmpegPath, args, frames, outputPath, timeoutMs = 300000, signal, spawnFn = spawn }) {
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 900) throw new Error("mp4_frame_count");
  const encoder = await beginMp4Encode({ ffmpegPath, args, outputPath, timeoutMs, signal, spawnFn });
  try {
    for (const frame of frames) {
      await encoder.writeFrame(frame);
    }
    return await encoder.finish();
  } catch (error) {
    try {
      await encoder.abort();
    } catch {}
    throw error;
  }
}

// Minimal pure-JS MP4 validation: ftyp brand, one moov with mvhd
// timescale/duration, one VIDEO trak (mdia/hdlr handler 'vide') with tkhd
// dimensions AND an stsd sample entry proving the actual codec. Only the
// `mp4v` sample entry passes: avc1/hvc1/hev1/unknown entries, audio-only
// files, and malformed tracks are rejected. Rejects truncated, non-MP4,
// dimension-mismatched, and duration-skewed outputs.
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
  const codec = videoSampleEntry(bytes, moov);
  if (codec !== "mp4v") {
    throw new Error(`mp4_codec:${/^[A-Za-z0-9]{4}$/.test(codec) ? codec : "unknown"}`);
  }
  return {
    brand,
    codec,
    width: trackDims.width,
    height: trackDims.height,
    durationSec,
    fps,
    frames,
    bytes: bytes.length,
  };
}

// Walk trak -> mdia/hdlr (vide) -> minf/stbl/stsd and return the first
// video sample entry fourcc. Every level is bounds-checked against its
// parent box so truncated files fail closed instead of over-reading.
function videoSampleEntry(bytes, moov) {
  const inner = readBoxes(bytes, moov.start + 8, moov.end);
  for (const trak of inner.filter((box) => box.type === "trak")) {
    const mdia = childBox(bytes, trak, "mdia");
    if (!mdia) continue;
    const hdlr = childBox(bytes, mdia, "hdlr");
    if (!hdlr || hdlr.start + 20 > hdlr.end) continue;
    if (bytes.toString("ascii", hdlr.start + 16, hdlr.start + 20) !== "vide") continue;
    const minf = childBox(bytes, mdia, "minf");
    if (!minf) throw new Error("mp4_malformed_track:minf");
    const stbl = childBox(bytes, minf, "stbl");
    if (!stbl) throw new Error("mp4_malformed_track:stbl");
    const stsd = childBox(bytes, stbl, "stsd");
    if (!stsd) throw new Error("mp4_malformed_track:stsd");
    if (stsd.start + 16 > stsd.end) throw new Error("mp4_malformed_stsd");
    const entryCount = bytes.readUInt32BE(stsd.start + 12);
    if (entryCount < 1) throw new Error("mp4_empty_stsd");
    if (stsd.start + 24 > stsd.end) throw new Error("mp4_malformed_stsd");
    return bytes.toString("ascii", stsd.start + 20, stsd.start + 24);
  }
  throw new Error("mp4_no_video_track");
}

function childBox(bytes, parent, type) {
  return readBoxes(bytes, parent.start + 8, parent.end).find((box) => box.type === type) ?? null;
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
