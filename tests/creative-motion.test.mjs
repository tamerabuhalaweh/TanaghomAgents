import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  MOTION_MAX_FRAMES,
  buildMotionFrameHtml,
  keyframesFor,
  physicalDirection,
  planTimeline,
  validateMotion,
} from "../packages/creative-runtime/render/motion.mjs";
import {
  beginMp4Encode,
  buildFfmpegArgs,
  encodeMp4,
  resolveFfmpegPath,
  validateMp4,
} from "../packages/creative-runtime/render/mp4.mjs";
import {
  claimMotionRenderJob,
  executeMotionRenderJob,
} from "../packages/creative-runtime/render/motion-worker.mjs";
import { bundledFontCss } from "../packages/creative-runtime/render/document.mjs";
import { createTestStorage } from "../packages/creative-runtime/storage/test-adapter.mjs";

const ORG = "10000000-0000-4000-8000-000000000001";
const JOB = "20000000-0000-4000-8000-000000000001";
const MOTION_TPL = "30000000-0000-4000-8000-000000000001";
const DESIGN_TPL = "30000000-0000-4000-8000-000000000002";
const CORR = "40000000-0000-4000-8000-000000000001";
const WORKER = "worker-motion-test";

function designDoc() {
  return {
    kind: "ad", locale: "ar", direction: "rtl",
    canvas: { width: 1080, height: 1080 }, background: { color: "#ffffff" },
    nodes: [
      { id: "h1", type: "text", role: "headline", x: 90, y: 120, width: 900, height: 220, text: "عنوان", font_size: 96, font_weight: 800, align: "start", color: "#111111" },
      { id: "cta-1", type: "badge", role: "cta", x: 90, y: 580, width: 420, height: 110, text: "زر", font_size: 44, font_weight: 700, align: "center", color: "#ffffff", background_color: "#0f766e", corner_radius: 55 },
    ],
  };
}

function motionDoc() {
  return {
    contract_version: "creative.motion-document.v1",
    kind: "motion", locale: "ar", direction: "rtl",
    design_template_id: DESIGN_TPL, design_version: 1, fps: 24,
    scenes: [{ id: "s1", page_id: "page-1", duration_ms: 2000, transition: { preset: "fade", duration_ms: 500 } }],
    elements: [
      { node_id: "h1", preset: "slide", direction: "start", delay_ms: 0, duration_ms: 800, easing: "ease-out" },
      { node_id: "cta-1", preset: "scale", delay_ms: 400, duration_ms: 600 },
    ],
    captions: [{ text: "شاهد", start_ms: 500, end_ms: 1800 }],
  };
}

function motionInput(doc = motionDoc()) {
  return {
    job_id: JOB, organization_id: ORG, capability: "motion", lane: "cpu",
    correlation_id: CORR, attempt: 1, max_attempts: 3,
    params: { motion_template_id: MOTION_TPL, motion_version: 1, format: "1:1" },
    motion: { id: MOTION_TPL, kind: "motion", name: "Test Motion", version: 1, is_active: true, spec: doc },
    design: { id: DESIGN_TPL, kind: "ad", name: "Test Design", version: 1, is_active: true, spec: designDoc() },
    brand_kit_version: null,
    source_assets: [],
  };
}

function pngBytes(width, height) {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8;
  header[25] = 2;
  return header;
}

function box(type, ...payloads) {
  const body = Buffer.concat(payloads);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, body]);
}

function craftedMp4({ width = 1080, height = 1080, timescale = 1000, duration = 2000, brand = "isom", fourcc = "mp4v", audioOnly = false, corruptStsd = false } = {}) {
  const u32 = (value) => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(value, 0);
    return buffer;
  };
  const matrix = Buffer.concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);
  const ftyp = box("ftyp", Buffer.from(`${brand}....isom`, "ascii"));
  const mvhd = box("mvhd",
    Buffer.concat([u32(0), u32(0), u32(0), u32(timescale), u32(duration), u32(0x00010000), Buffer.alloc(10), matrix, Buffer.alloc(24), u32(2)]));
  const tkhd = box("tkhd",
    Buffer.concat([u32(0), u32(0), u32(0), u32(1), u32(0), u32(duration), Buffer.alloc(8), Buffer.alloc(8), matrix,
      (() => {
        const dims = Buffer.alloc(8);
        dims.writeUInt32BE(width * 65536, 0);
        dims.writeUInt32BE(height * 65536, 4);
        return dims;
      })()]));
  const handler = audioOnly ? "soun" : "vide";
  const hdlr = box("hdlr", Buffer.concat([u32(0), u32(0), Buffer.from(handler, "ascii"), Buffer.alloc(12)]));
  const entry = corruptStsd
    ? box("stsd", Buffer.concat([u32(0), u32(1)]))
    : box("stsd", Buffer.concat([u32(0), u32(1),
      (() => {
        const header = Buffer.alloc(8);
        header.writeUInt32BE(86, 0);
        header.write(fourcc, 4, "ascii");
        return Buffer.concat([header, Buffer.alloc(78)]);
      })()]));
  const mdia = box("mdia", box("mdhd", Buffer.concat([u32(0), u32(0), u32(0), u32(timescale), u32(duration), Buffer.alloc(8)])), hdlr, box("minf", box("stbl", entry)));
  const moov = box("moov", mvhd, box("trak", tkhd, mdia));
  return Buffer.concat([ftyp, moov]);
}

function stubDb({ input, outputs = 0, state = { status: "running", cancel_requested: false }, stateFn = null, markStatus = "running", calls = null }) {
  const log = calls ?? { marks: [], registers: [], completes: [], fails: [] };
  return {
    log,
    async query(text, params) {
      if (text.includes("mark_creative_job_running")) {
        log.marks.push(params);
        return { rows: [{ status: markStatus }] };
      }
      if (text.includes("count_creative_render_outputs")) {
        return { rows: [{ outputs }] };
      }
      if (text.includes("get_creative_motion_input")) {
        return { rows: [{ input }] };
      }
      if (text.includes("get_creative_motion_state")) {
        log.stateCalls = (log.stateCalls ?? 0) + 1;
        const current = stateFn ? stateFn(log.stateCalls) : state;
        log.statesSeen = [...(log.statesSeen ?? []), current];
        return { rows: [{ state: current }] };
      }
      if (text.includes("create_creative_asset_version")) {
        log.registers.push(params);
        return { rows: [{ asset_version_id: "50000000-0000-4000-8000-000000000001" }] };
      }
      if (text.includes("complete_creative_job")) {
        log.completes.push(params);
        return { rows: [{ status: "succeeded" }] };
      }
      if (text.includes("fail_creative_job")) {
        log.fails.push(params);
        return { rows: [{ status: "failed" }] };
      }
      throw new Error(`unexpected query: ${text.slice(0, 80)}`);
    },
  };
}

function memoryStorage() {
  const mem = createTestStorage();
  return {
    put: (key, bytes, mime) => mem.put({ key, bytes, mime }),
    get: (key) => {
      try {
        return mem.get(key);
      } catch {
        return null;
      }
    },
  };
}

test("motion worker module stays EXECUTE-only: no direct table reads", async () => {
  const source = await readFile(new URL("../packages/creative-runtime/render/motion-worker.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /FROM tanaghom\./);
  assert.doesNotMatch(source, /db\.query/);
  for (const name of ["getMotionInput", "getMotionState", "countRenderOutputs", "claimMotionJob", "markRunning", "registerVersion", "completeJob", "failJob"]) {
    assert.match(source, new RegExp(`\\b${name}\\b`));
  }
});

test("motion contract validates through JSON schema", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const { readFileSync } = await import("node:fs");
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync("packages/contracts/schemas/creative/motion-document.v1.schema.json", "utf8")));
  assert.equal(validate(motionDoc()), true);
  assert.equal(validate({ ...motionDoc(), fps: 60 }), false);
  assert.equal(validate({ ...motionDoc(), elements: [{ node_id: "h1", preset: "spin" }] }), false);
  assert.equal(validate({ ...motionDoc(), elements: [{ node_id: "h1", preset: "fade", easing: "cubic-bezier(0,0,1,1)" }] }), false);
  assert.equal(validate({ ...motionDoc(), scenes: [{ id: "s1", page_id: "page-1", duration_ms: 100 }] }), false);
});

test("timeline plans totals and freezes frames deterministically with RTL entrances", () => {
  const doc = motionDoc();
  const plan = planTimeline(doc, designDoc());
  assert.equal(plan.totalMs, 2000);
  assert.equal(plan.totalFrames, 48);
  assert.equal(planTimeline(doc, designDoc()).totalFrames, 48);
  // RTL start entrance slides in from the right (+120px).
  assert.match(keyframesFor("slide", physicalDirection("start", "rtl")).from, /translate\(120px, 0px\)/);
  assert.match(keyframesFor("slide", physicalDirection("start", "ltr")).from, /translate\(-120px, 0px\)/);
  const fontCss = "";
  const first = buildMotionFrameHtml({ motion: doc, designDoc: designDoc(), assets: new Map(), fontCss, t: 0 });
  const again = buildMotionFrameHtml({ motion: doc, designDoc: designDoc(), assets: new Map(), fontCss, t: 0 });
  assert.equal(first.html, again.html);
  assert.doesNotMatch(first.html, /https?:\/\//);
  assert.doesNotMatch(first.html, /<script/);
  // Malicious caption text is escaped, never executed.
  const evil = buildMotionFrameHtml({
    motion: { ...doc, captions: [{ text: "<script>alert(1)</script>", start_ms: 0, end_ms: 2000 }] },
    designDoc: designDoc(), assets: new Map(), fontCss, t: 100,
  });
  assert.doesNotMatch(evil.html, /<script/);
  assert.match(evil.html, /&lt;script&gt;/);
});

test("malicious and oversized motion JSON is rejected", () => {
  const doc = motionDoc();
  const design = designDoc();
  assert.throws(() => validateMotion({ ...doc, elements: [{ node_id: "h1", preset: "fade", duration_ms: -5 }] }, design), /invalid_motion_document/);
  assert.throws(() => validateMotion({ ...doc, elements: [{ node_id: "h1", preset: "fade", delay_ms: 40000 }] }, design), /invalid_motion_document/);
  assert.throws(() => validateMotion({ ...doc, elements: [{ node_id: "h1", preset: "fade", evil: true }] }, design), /unknown_element_property/);
  assert.throws(() => validateMotion({ ...doc, scenes: [{ id: "s1", page_id: "nope", duration_ms: 2000 }] }, design), /scene_page_unknown/);
  assert.throws(() => validateMotion({ ...doc, scenes: [{ id: "s1", page_id: "page-1", duration_ms: 20000 }] }, design), /invalid_motion_document/);
  const long = { ...doc, scenes: Array.from({ length: 10 }, (_, index) => ({ id: `s${index}`, page_id: "page-1", duration_ms: 10000 })) };
  assert.throws(() => validateMotion(long, design), /total_duration|frame_count/);
  assert.throws(() => validateMotion({ ...doc, elements: [{ node_id: "h1", preset: "fade", easing: "ease-out;color:red" }] }, design), /invalid_motion_document/);
  // Design mismatch: locale, canvas, and node scope are enforced.
  assert.throws(() => validateMotion({ ...doc, locale: "en", direction: "ltr" }, design), /locale_direction_design_mismatch/);
  const ltrDesign = { ...design, locale: "en", direction: "ltr" };
  assert.doesNotThrow(() => validateMotion({ ...doc, locale: "en", direction: "ltr" }, ltrDesign));
  assert.ok(MOTION_MAX_FRAMES === 900);
});

test("ffmpeg argv allowlist rejects codecs, dims, fps, and path injection", () => {
  const out = "C:/tmp/tmg-test.mp4";
  const args = buildFfmpegArgs({ width: 1080, height: 1080, fps: 24, outputPath: out });
  assert.ok(Object.isFrozen(args));
  assert.ok(!args.some((token) => /sh|bash|filter|http/i.test(token)));
  assert.throws(() => buildFfmpegArgs({ width: 1080, height: 1080, fps: 24, codec: "libx264", outputPath: out }), /mp4_codec_allowlist/);
  assert.throws(() => buildFfmpegArgs({ width: 1920, height: 1080, fps: 24, outputPath: out }), /mp4_dimensions_unsupported/);
  assert.throws(() => buildFfmpegArgs({ width: 1080, height: 1080, fps: 60, outputPath: out }), /mp4_fps_allowlist/);
  assert.throws(() => buildFfmpegArgs({ width: 1080, height: 1080, fps: 24, outputPath: "out; rm -rf /" }), /mp4_output_path_rejected/);
  assert.throws(() => buildFfmpegArgs({ width: 1080, height: 1080, fps: 24, outputPath: "out.mp4`id`" }), /mp4_output_path_rejected/);
  assert.equal(resolveFfmpegPath({}), "ffmpeg");
  assert.equal(resolveFfmpegPath({ FFMPEG_PATH: "C:/tools/ffmpeg.exe" }), "C:/tools/ffmpeg.exe");
  assert.throws(() => resolveFfmpegPath({ FFMPEG_PATH: "x$(id)" }), /mp4_ffmpeg_path_rejected/);
});

test("pure-JS MP4 validator enforces container, codec, dims, and duration", () => {
  const mp4 = craftedMp4({ width: 1080, height: 1080, timescale: 1000, duration: 2000 });
  const info = validateMp4(mp4, { width: 1080, height: 1080, fps: 24, frames: 48 });
  assert.equal(info.brand, "isom");
  assert.equal(info.codec, "mp4v");
  assert.equal(info.durationSec, 2);
  assert.throws(() => validateMp4(mp4, { width: 1080, height: 1350, fps: 24, frames: 48 }), /mp4_dimensions/);
  assert.throws(() => validateMp4(mp4, { width: 1080, height: 1080, fps: 24, frames: 12 }), /mp4_duration/);
  assert.throws(() => validateMp4(Buffer.from("garbage bytes that are not an mp4 container...."), { width: 1080, height: 1080, fps: 24, frames: 48 }), /mp4_missing_ftyp/);
  assert.throws(() => validateMp4(craftedMp4({ brand: "xxxx" }), { width: 1080, height: 1080, fps: 24, frames: 48 }), /mp4_brand/);
  assert.throws(
    () => validateMp4(craftedMp4({ fourcc: "avc1" }), { width: 1080, height: 1080, fps: 24, frames: 48 }),
    /mp4_codec:avc1/,
  );
  assert.throws(
    () => validateMp4(craftedMp4({ fourcc: "hvc1" }), { width: 1080, height: 1080, fps: 24, frames: 48 }),
    /mp4_codec:hvc1/,
  );
  assert.throws(
    () => validateMp4(craftedMp4({ fourcc: "xxxx" }), { width: 1080, height: 1080, fps: 24, frames: 48 }),
    /mp4_codec:xxxx/,
  );
  assert.throws(
    () => validateMp4(craftedMp4({ audioOnly: true }), { width: 1080, height: 1080, fps: 24, frames: 48 }),
    /mp4_no_video_track/,
  );
  assert.throws(
    () => validateMp4(craftedMp4({ corruptStsd: true }), { width: 1080, height: 1080, fps: 24, frames: 48 }),
    /mp4_malformed_stsd/,
  );
});

test("encode fails closed on timeout and spawn errors without shell", async () => {
  const out = "C:/tmp/tmg-never.mp4";
  const args = buildFfmpegArgs({ width: 1080, height: 1080, fps: 24, outputPath: out });
  const frames = [pngBytes(1080, 1080)];
  const hangingSpawn = () => {
    const handlers = {};
    return {
      on: (event, handler) => { handlers[event] = handler; },
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      stdin: { write: () => true, end: () => {}, on: () => {} },
      kill: () => { handlers.close?.(0); },
    };
  };
  await assert.rejects(
    encodeMp4({ ffmpegPath: "ffmpeg", args, frames, outputPath: out, timeoutMs: 20, spawnFn: hangingSpawn }),
    /mp4_encode_timeout/,
  );
  await assert.rejects(
    encodeMp4({ ffmpegPath: "ffmpeg", args, frames: [], outputPath: out }),
    /mp4_frame_count/,
  );
  const mutated = [...args];
  await assert.rejects(
    encodeMp4({ ffmpegPath: "ffmpeg", args: mutated, frames, outputPath: out }),
    /mp4_args_must_be_allowlisted/,
  );
  let shellUsed = null;
  const fakeSpawn = (path, argv, opts) => {
    shellUsed = opts;
    const handlers = {};
    return {
      on: (event, handler) => { handlers[event] = handler; },
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      stdin: { write: () => true, end: () => { handlers.close?.(0); }, on: () => {} },
      kill: () => {},
    };
  };
  await assert.rejects(
    encodeMp4({ ffmpegPath: "ffmpeg", args: buildFfmpegArgs({ width: 1080, height: 1080, fps: 24, outputPath: "C:/no/such/dir/x.mp4" }), frames, outputPath: "C:/no/such/dir/x.mp4", spawnFn: fakeSpawn }),
    /mp4_output_unreadable/,
  );
  assert.equal(shellUsed.shell, undefined);
});

test("streaming encoder cleans temp output on every exit path", async () => {
  const { writeFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  function tempOut() {
    const path = join(tmpdir(), `tmg-test-${randomUUID()}.mp4`);
    writeFileSync(path, Buffer.from("partial"));
    return path;
  }
  function controllableSpawn({ exitCode = 0, payload = null } = {}) {
    const log = { kills: 0 };
    return {
      log,
      spawnFn: (path, argv, opts) => {
        assert.equal(opts.shell, undefined);
        const handlers = {};
        return {
          on: (event, handler) => { handlers[event] = handler; },
          stderr: { on: () => {} },
          stdin: {
            write: () => true,
            end: () => {
              if (payload && opts && argv.includes(payload.path)) {
                writeFileSync(payload.path, payload.bytes);
              }
              handlers.close?.(exitCode);
            },
            on: () => {},
            once: (event, handler) => {
              if (event === "drain") setImmediate(handler);
            },
          },
          kill: () => {
            log.kills += 1;
            handlers.close?.(exitCode);
          },
        };
      },
    };
  }
  // Success: bytes returned, temp removed.
  {
    const path = tempOut();
    const fake = controllableSpawn({});
    const mp4Bytes = craftedMp4({});
    const encoder = await beginMp4Encode({
      ffmpegPath: "ffmpeg",
      args: buildFfmpegArgs({ width: 1080, height: 1080, fps: 24, outputPath: path }),
      outputPath: path,
      spawnFn: fake.spawnFn,
    });
    await encoder.writeFrame(pngBytes(1080, 1080));
    // Swap in real bytes for the read path.
    writeFileSync(path, mp4Bytes);
    const done = await encoder.finish();
    assert.deepEqual(done, mp4Bytes);
    assert.equal(existsSync(path), false);
  }
  // Non-zero exit: temp removed, exit error surfaces.
  {
    const path = tempOut();
    const fake = controllableSpawn({ exitCode: 1 });
    const encoder = await beginMp4Encode({
      ffmpegPath: "ffmpeg",
      args: buildFfmpegArgs({ width: 1080, height: 1080, fps: 24, outputPath: path }),
      outputPath: path,
      spawnFn: fake.spawnFn,
    });
    await encoder.writeFrame(pngBytes(1080, 1080));
    await assert.rejects(encoder.finish(), /mp4_encode_failed:exit_1/);
    assert.equal(existsSync(path), false);
  }
  // Timeout: child killed, temp removed.
  {
    const path = tempOut();
    const hangingHandlers = {};
    const hanging = {
      on: (event, handler) => { hangingHandlers[event] = handler; },
      stderr: { on: () => {} },
      stdin: { write: () => true, end: () => {}, on: () => {}, once: (event, handler) => { if (event === "drain") setImmediate(handler); } },
      kill: () => { hangingHandlers.close?.(0); },
    };
    const encoder = await beginMp4Encode({
      ffmpegPath: "ffmpeg",
      args: buildFfmpegArgs({ width: 1080, height: 1080, fps: 24, outputPath: path }),
      outputPath: path, timeoutMs: 20,
      spawnFn: () => hanging,
    });
    await encoder.writeFrame(pngBytes(1080, 1080));
    await new Promise((resolve) => setTimeout(resolve, 60));
    await assert.rejects(encoder.finish(), /mp4_encoder_closed|mp4_encode_timeout/);
    assert.equal(existsSync(path), false);
  }
  // Abort: kill recorded, temp removed, further writes rejected.
  {
    const path = tempOut();
    const fake = controllableSpawn({});
    const encoder = await beginMp4Encode({
      ffmpegPath: "ffmpeg",
      args: buildFfmpegArgs({ width: 1080, height: 1080, fps: 24, outputPath: path }),
      outputPath: path,
      spawnFn: fake.spawnFn,
    });
    await encoder.writeFrame(pngBytes(1080, 1080));
    await assert.rejects(encoder.abort(), /mp4_encode_aborted/);
    assert.equal(fake.log.kills, 1);
    assert.equal(existsSync(path), false);
    await assert.rejects(encoder.writeFrame(pngBytes(1080, 1080)), /mp4_encode_aborted/);
    await assert.rejects(encoder.finish(), /mp4_encode_aborted/);
  }
  // Intermediate byte budget enforced deterministically.
  {
    const path = tempOut();
    const fake = controllableSpawn({});
    const encoder = await beginMp4Encode({
      ffmpegPath: "ffmpeg",
      args: buildFfmpegArgs({ width: 1080, height: 1080, fps: 24, outputPath: path }),
      outputPath: path, maxIntermediateBytes: 1024,
      spawnFn: fake.spawnFn,
    });
    await assert.rejects(encoder.writeFrame(Buffer.alloc(2048, 7)), /mp4_intermediate_budget/);
    assert.equal(existsSync(path), false);
  }
  // Cancel during encode via AbortSignal terminates the child.
  {
    const path = tempOut();
    const fake = controllableSpawn({});
    const controller = new AbortController();
    const encoder = await beginMp4Encode({
      ffmpegPath: "ffmpeg",
      args: buildFfmpegArgs({ width: 1080, height: 1080, fps: 24, outputPath: path }),
      outputPath: path, signal: controller.signal,
      spawnFn: fake.spawnFn,
    });
    await encoder.writeFrame(pngBytes(1080, 1080));
    controller.abort();
    for (let attempt = 0; attempt < 50 && existsSync(path); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(fake.log.kills, 1);
    assert.equal(existsSync(path), false);
    await assert.rejects(encoder.finish(), /mp4_encode_aborted/);
  }
});

function fakeEncoder({ mp4, onWrite, onFinish } = {}) {
  const log = { writes: 0, bytes: 0, finished: false, aborted: false };
  return {
    log,
    createEncoder: async (params) => {
      assert.ok(Object.isFrozen(params.args));
      assert.match(params.outputPath, /\.mp4$/);
      assert.ok(params.signal instanceof AbortSignal);
      return {
        writeFrame: async (frame) => {
          log.writes += 1;
          log.bytes += frame.length;
          await onWrite?.(frame, log);
        },
        finish: async () => {
          log.finished = true;
          await onFinish?.(log);
          return mp4;
        },
        abort: async () => {
          log.aborted = true;
        },
      };
    },
  };
}

test("motion worker executes a job to one MP4 version and completes", async () => {
  const db = stubDb({ input: motionInput() });
  const storage = memoryStorage();
  const mp4 = craftedMp4({ width: 1080, height: 1080, timescale: 1000, duration: 2000 });
  const captures = [];
  const fake = fakeEncoder({ mp4 });
  const result = await executeMotionRenderJob({
    db, storage,
    capture: async ({ html, width, height, pageIndex }) => {
      captures.push(pageIndex);
      assert.doesNotMatch(html, /https?:\/\//);
      return { bytes: pngBytes(width, height), attemptedExternal: 0, blockedExternal: 0 };
    },
    createEncoder: fake.createEncoder,
    jobId: JOB, worker: WORKER,
  });
  assert.equal(captures.length, 48);
  assert.equal(fake.log.writes, 48);
  assert.equal(fake.log.finished, true);
  assert.equal(fake.log.aborted, false);
  assert.deepEqual(db.log.marks, [[JOB, WORKER]]);
  assert.equal(db.log.registers.length, 1);
  const [jobId, worker, assetId, title, mime, width, height, durationMs, bytes, , objectKey, , provenance, , templateRef, method] = db.log.registers[0];
  assert.equal(mime, "video/mp4");
  assert.equal(durationMs, 2000);
  assert.match(objectKey, new RegExp(`^t/${ORG}/motion/${JOB}/v1\\.mp4$`));
  assert.equal(provenance.frames, 48);
  assert.equal(provenance.fps, 24);
  assert.equal(provenance.codec, "mp4v");
  assert.equal(provenance.design_version, 1);
  assert.equal(provenance.correlation_id, CORR);
  assert.match(provenance.font_sha256, /^[0-9a-f]{64}$/);
  assert.equal(templateRef, "Test Motion");
  assert.equal(method, "render");
  assert.deepEqual(db.log.completes, [[JOB, WORKER, "50000000-0000-4000-8000-000000000001", null]]);
  assert.equal(result.output.frames, 48);
  assert.equal(result.output.width, 1080);
  assert.equal(result.output.codec, "mp4v");
  assert.equal(result.attemptedExternalTotal, 0);
  assert.match(title, /24fps/);
});

test("900-frame render never accumulates frame buffers", async () => {
  const longDoc = {
    ...motionDoc(),
    fps: 30,
    scenes: [
      { id: "s1", page_id: "page-1", duration_ms: 10000 },
      { id: "s2", page_id: "page-1", duration_ms: 10000 },
      { id: "s3", page_id: "page-1", duration_ms: 10000 },
    ],
  };
  const mp4 = craftedMp4({ width: 1080, height: 1080, timescale: 1000, duration: 30000 });
  const db = stubDb({ input: motionInput(longDoc) });
  const live = new Set();
  let peak = 0;
  const fake = fakeEncoder({
    mp4,
    onWrite: (frame) => {
      live.delete(frame);
      peak = Math.max(peak, live.size);
    },
  });
  const result = await executeMotionRenderJob({
    db, storage: memoryStorage(),
    capture: async ({ width, height }) => {
      const frame = pngBytes(width, height);
      live.add(frame);
      peak = Math.max(peak, live.size);
      return { bytes: frame, attemptedExternal: 0, blockedExternal: 0 };
    },
    createEncoder: fake.createEncoder,
    jobId: JOB, worker: WORKER,
  });
  assert.equal(result.output.frames, 900);
  assert.equal(fake.log.writes, 900);
  assert.ok(peak <= 2, `peak live frames ${peak} exceeds bound`);
  assert.equal(live.size, 0);
});

test("motion worker honors cancellation, timeouts, and duplicate guards", async () => {
  const neverEncoder = () => {
    throw new Error("encoder must not start");
  };
  const dbCancel = stubDb({ input: motionInput(), state: { status: "running", cancel_requested: true } });
  await assert.rejects(
    executeMotionRenderJob({
      db: dbCancel, storage: memoryStorage(),
      capture: async () => { throw new Error("capture must not run"); },
      createEncoder: neverEncoder,
      jobId: JOB, worker: WORKER,
    }),
    /motion_cancel_requested/,
  );
  assert.equal(dbCancel.log.fails[0][2], "cancelled");

  const dbPreCancel = stubDb({ input: motionInput(), markStatus: "cancelled" });
  await assert.rejects(
    executeMotionRenderJob({
      db: dbPreCancel, storage: memoryStorage(),
      capture: async () => { throw new Error("capture must not run"); },
      createEncoder: neverEncoder,
      jobId: JOB, worker: WORKER,
    }),
    /motion_cancel_requested/,
  );
  assert.equal(dbPreCancel.log.fails[0][2], "cancelled");

  // Cancel lands mid-encode: finish rejects as cancelled, job cancelled.
  const mp4 = craftedMp4({ width: 1080, height: 1080, timescale: 1000, duration: 2000 });
  const dbMidEncode = stubDb({ input: motionInput() });
  const midFake = fakeEncoder({
    mp4,
    onFinish: async () => {
      const error = new Error("mp4_encode_aborted");
      error.errorClass = "cancelled";
      throw error;
    },
  });
  await assert.rejects(
    executeMotionRenderJob({
      db: dbMidEncode, storage: memoryStorage(),
      capture: async ({ width, height }) => ({ bytes: pngBytes(width, height), attemptedExternal: 0, blockedExternal: 0 }),
      createEncoder: midFake.createEncoder,
      jobId: JOB, worker: WORKER,
    }),
    /mp4_encode_aborted/,
  );
  assert.equal(dbMidEncode.log.fails[0][2], "cancelled");
  assert.equal(dbMidEncode.log.completes.length, 0);

  const dbTimeout = stubDb({ input: motionInput() });
  const timeoutFake = fakeEncoder({
    mp4,
    onFinish: async () => { throw new Error("motion_encode_timeout:deadline"); },
  });
  await assert.rejects(
    executeMotionRenderJob({
      db: dbTimeout, storage: memoryStorage(),
      capture: async ({ width, height }) => ({ bytes: pngBytes(width, height), attemptedExternal: 0, blockedExternal: 0 }),
      createEncoder: timeoutFake.createEncoder,
      jobId: JOB, worker: WORKER,
    }),
    /motion_encode_timeout/,
  );
  assert.equal(dbTimeout.log.fails[0][2], "transient");

  const dbDup = stubDb({ input: motionInput(), outputs: 1 });
  await assert.rejects(
    executeMotionRenderJob({
      db: dbDup, storage: memoryStorage(),
      capture: async () => { throw new Error("capture must not run"); },
      createEncoder: neverEncoder,
      jobId: JOB, worker: WORKER,
    }),
    /motion_duplicate_execution/,
  );

  const bad = motionInput({ ...motionDoc(), elements: [] });
  const dbBad = stubDb({ input: bad });
  await assert.rejects(
    executeMotionRenderJob({
      db: dbBad, storage: memoryStorage(),
      capture: async () => { throw new Error("capture must not run"); },
      createEncoder: neverEncoder,
      jobId: JOB, worker: WORKER,
    }),
    /motion_document_invalid/,
  );
  assert.equal(dbBad.log.fails[0][2], "deterministic");
});

test("worker polls cancellation while encoder.finish() is pending", async () => {
  const mp4 = craftedMp4({ width: 1080, height: 1080, timescale: 1000, duration: 2000 });
  void mp4;
  // Polls 1-6 (pre-spawn, frames, pre-mux) see running; watcher polls 7+
  // flip to cancelled only once finish is underway.
  const db = stubDb({
    input: motionInput(),
    stateFn: (n) => (n >= 8
      ? { status: "running", cancel_requested: true }
      : { status: "running", cancel_requested: false }),
  });
  let writes = 0;
  let finishEntered = false;
  let finishPendingObserved = false;
  let signalFired = false;
  let encoderTerminated = false;
  const fake = {
    createEncoder: async (params) => {
      assert.ok(params.signal instanceof AbortSignal);
      params.signal.addEventListener("abort", () => {
        signalFired = true;
        encoderTerminated = true;
      });
      return {
        writeFrame: async () => {
          writes += 1;
        },
        finish: async () => {
          // 1+2: every frame was written and finish stays pending here.
          assert.equal(writes, 48);
          finishEntered = true;
          await new Promise((resolve) => setImmediate(resolve));
          finishPendingObserved = true;
          await new Promise((_, reject) => {
            params.signal.addEventListener("abort", () => {
              const error = new Error("mp4_encode_aborted");
              error.errorClass = "cancelled";
              reject(error);
            });
          });
        },
        abort: async () => {},
      };
    },
  };
  await assert.rejects(
    executeMotionRenderJob({
      db, storage: memoryStorage(),
      capture: async ({ width, height }) => ({ bytes: pngBytes(width, height), attemptedExternal: 0, blockedExternal: 0 }),
      createEncoder: fake.createEncoder,
      jobId: JOB, worker: WORKER, finishPollMs: 20,
    }),
    /motion_encode_cancelled/,
  );
  // 3: early polls saw running.
  assert.equal(db.log.statesSeen[0].cancel_requested, false);
  // 4+5: watcher observed the flip and the AbortSignal fired.
  assert.ok(db.log.stateCalls >= 8);
  assert.equal(signalFired, true);
  // 6: encoder terminated via the signal path.
  assert.equal(encoderTerminated, true);
  assert.equal(finishEntered, true);
  assert.equal(finishPendingObserved, true);
  // 7+8: job recorded cancelled, never completed.
  assert.equal(db.log.fails[0][2], "cancelled");
  assert.equal(db.log.completes.length, 0);
  // 9: watcher stopped — no polls after terminal state.
  const pollsAfter = db.log.stateCalls;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(db.log.stateCalls, pollsAfter);
});

test("motion claim helper uses the filtered claim", async () => {
  const empty = { query: async () => ({ rows: [] }) };
  assert.equal(await claimMotionRenderJob(empty, { worker: WORKER }), null);
  const calls = [];
  const own = {
    query: async (text, params) => {
      calls.push([text, params]);
      assert.match(text, /claim_creative_motion_job/);
      return { rows: [{ job_id: JOB, capability: "motion" }] };
    },
  };
  const claimed = await claimMotionRenderJob(own, { worker: WORKER });
  assert.equal(claimed.jobId, JOB);
  assert.deepEqual(calls[0][1], [WORKER, 120]);
});
