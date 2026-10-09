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

function craftedMp4({ width = 1080, height = 1080, timescale = 1000, duration = 2000, brand = "isom" } = {}) {
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
  const moov = box("moov", mvhd, box("trak", tkhd));
  return Buffer.concat([ftyp, moov]);
}

function stubDb({ input, outputs = 0, state = { status: "running", cancel_requested: false }, markStatus = "running", calls = null }) {
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
        return { rows: [{ state }] };
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

test("pure-JS MP4 validator enforces container, dims, and duration", () => {
  const mp4 = craftedMp4({ width: 1080, height: 1080, timescale: 1000, duration: 2000 });
  const info = validateMp4(mp4, { width: 1080, height: 1080, fps: 24, frames: 48 });
  assert.equal(info.brand, "isom");
  assert.equal(info.durationSec, 2);
  assert.throws(() => validateMp4(mp4, { width: 1080, height: 1350, fps: 24, frames: 48 }), /mp4_dimensions/);
  assert.throws(() => validateMp4(mp4, { width: 1080, height: 1080, fps: 24, frames: 12 }), /mp4_duration/);
  assert.throws(() => validateMp4(Buffer.from("garbage bytes that are not an mp4 container...."), { width: 1080, height: 1080, fps: 24, frames: 48 }), /mp4_missing_ftyp/);
  assert.throws(() => validateMp4(craftedMp4({ brand: "xxxx" }), { width: 1080, height: 1080, fps: 24, frames: 48 }), /mp4_brand/);
});

test("encode fails closed on timeout and spawn errors without shell", async () => {
  const out = "C:/tmp/tmg-never.mp4";
  const args = buildFfmpegArgs({ width: 1080, height: 1080, fps: 24, outputPath: out });
  const frames = [pngBytes(1080, 1080)];
  await assert.rejects(
    encodeMp4({ ffmpegPath: "ffmpeg", args, frames, outputPath: out, timeoutMs: 20, spawnFn: () => ({ on: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} }, stdin: { write: () => true, end: () => {}, on: () => {} }, kill: () => {} }) }),
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

test("motion worker executes a job to one MP4 version and completes", async () => {
  const db = stubDb({ input: motionInput() });
  const storage = memoryStorage();
  const mp4 = craftedMp4({ width: 1080, height: 1080, timescale: 1000, duration: 2000 });
  const captures = [];
  const result = await executeMotionRenderJob({
    db, storage,
    capture: async ({ html, width, height, pageIndex }) => {
      captures.push(pageIndex);
      assert.doesNotMatch(html, /https?:\/\//);
      return { bytes: pngBytes(width, height), attemptedExternal: 0, blockedExternal: 0 };
    },
    encode: async ({ args, frames, outputPath }) => {
      assert.ok(Object.isFrozen(args));
      assert.equal(frames.length, 48);
      assert.match(outputPath, /\.mp4$/);
      return mp4;
    },
    jobId: JOB, worker: WORKER,
  });
  assert.equal(captures.length, 48);
  assert.deepEqual(db.log.marks, [[JOB, WORKER]]);
  assert.equal(db.log.registers.length, 1);
  const [jobId, worker, assetId, title, mime, width, height, durationMs, bytes, , objectKey, , provenance, , templateRef, method] = db.log.registers[0];
  assert.equal(mime, "video/mp4");
  assert.equal(durationMs, 2000);
  assert.match(objectKey, new RegExp(`^t/${ORG}/motion/${JOB}/v1\\.mp4$`));
  assert.equal(provenance.frames, 48);
  assert.equal(provenance.fps, 24);
  assert.equal(provenance.codec, "mpeg4");
  assert.equal(provenance.design_version, 1);
  assert.equal(provenance.correlation_id, CORR);
  assert.match(provenance.font_sha256, /^[0-9a-f]{64}$/);
  assert.equal(templateRef, "Test Motion");
  assert.equal(method, "render");
  assert.deepEqual(db.log.completes, [[JOB, WORKER, "50000000-0000-4000-8000-000000000001", null]]);
  assert.equal(result.output.frames, 48);
  assert.equal(result.output.width, 1080);
  assert.equal(result.attemptedExternalTotal, 0);
  assert.match(title, /24fps/);
});

test("motion worker honors cancellation, timeouts, and duplicate guards", async () => {
  const dbCancel = stubDb({ input: motionInput(), state: { status: "running", cancel_requested: true } });
  await assert.rejects(
    executeMotionRenderJob({
      db: dbCancel, storage: memoryStorage(),
      capture: async () => { throw new Error("capture must not run"); },
      encode: async () => { throw new Error("encode must not run"); },
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
      encode: async () => { throw new Error("encode must not run"); },
      jobId: JOB, worker: WORKER,
    }),
    /motion_cancel_requested/,
  );
  assert.equal(dbPreCancel.log.fails[0][2], "cancelled");

  const dbTimeout = stubDb({ input: motionInput() });
  await assert.rejects(
    executeMotionRenderJob({
      db: dbTimeout, storage: memoryStorage(),
      capture: async ({ width, height }) => ({ bytes: pngBytes(width, height), attemptedExternal: 0, blockedExternal: 0 }),
      encode: async () => { throw new Error("motion_encode_timeout:deadline"); },
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
      encode: async () => { throw new Error("encode must not run"); },
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
      encode: async () => { throw new Error("encode must not run"); },
      jobId: JOB, worker: WORKER,
    }),
    /motion_document_invalid/,
  );
  assert.equal(dbBad.log.fails[0][2], "deterministic");
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
