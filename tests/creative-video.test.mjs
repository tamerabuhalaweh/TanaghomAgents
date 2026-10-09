import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("video lane migration is additive, guarded, and reversible", async () => {
  const root = new URL("../", import.meta.url);
  const up = await readFile(new URL("packages/database/migrations/0044_creative_video_lane.up.sql", root), "utf8");
  const down = await readFile(new URL("packages/database/migrations/0044_creative_video_lane.down.sql", root), "utf8");
  assert.match(up, /0044 requires exact 0040 baseline/);
  assert.match(up, /CREATE FUNCTION tanaghom\.get_creative_video_input\(/);
  assert.match(up, /CREATE FUNCTION tanaghom\.get_creative_video_source\(/);
  assert.match(up, /CREATE FUNCTION tanaghom\.claim_creative_video_job\(/);
  assert.match(up, /CREATE FUNCTION tanaghom\.attach_creative_provider_request\(/);
  assert.match(up, /CREATE FUNCTION tanaghom\.get_creative_provider_call\(/);
  assert.match(up, /capability='video' AND lane='gpu_video'|capability IN \('video'\)|job\.capability='video'/);
  assert.match(up, /GRANT EXECUTE ON FUNCTION tanaghom\.claim_creative_video_job\(text,int\) TO tanaghom_creative_worker;/);
  assert.match(up, /text_to_video','image_to_video/);
  assert.match(up, /INSERT INTO public\.schema_migrations\(version\) VALUES \('0044_creative_video_lane'\)/);
  assert.doesNotMatch(up, /CREATE TABLE/);
  assert.doesNotMatch(up, /GRANT SELECT/);
  assert.match(down, /DROP FUNCTION tanaghom\.attach_creative_provider_request\(uuid,text,text\);/);
  assert.match(down, /DROP FUNCTION tanaghom\.get_creative_provider_call\(uuid,text,text\);/);
  assert.match(down, /DROP FUNCTION tanaghom\.claim_creative_video_job\(text,int\);/);
  assert.match(down, /DELETE FROM public.schema_migrations WHERE version='0044_creative_video_lane'/);
});

import {
  ProviderAdapterError,
  createHttpVideoAdapter,
  createVideoTask,
  estimateVideoCostUsd,
  normalizeVideoRequest,
  queryVideoTask,
} from "../packages/creative-runtime/adapters/http-video.mjs";
import { validateMp4 } from "../packages/creative-runtime/render/mp4.mjs";
import {
  PROVIDER_VIDEO_CODECS,
  claimVideoRenderJob,
  executeVideoJob,
} from "../packages/creative-runtime/render/video-worker.mjs";
import { createTestStorage } from "../packages/creative-runtime/storage/test-adapter.mjs";

const ORG = "10000000-0000-4000-8000-000000000001";
const JOB = "20000000-0000-4000-8000-000000000001";
const CORR = "40000000-0000-4000-8000-000000000001";
const WORKER = "worker-video-test";
const SOURCE_VERSION = "70000000-0000-4000-8000-000000000001";
const ENDPOINT = "http://127.0.0.1:9/v2/video_generation";
const QUERY_ENDPOINT = "http://127.0.0.1:9/v2/query/video_generation";

function box(type, ...payloads) {
  const body = Buffer.concat(payloads);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, body]);
}

function craftedMp4({ width = 640, height = 640, timescale = 1000, duration = 5000, fourcc = "avc1" } = {}) {
  const u32 = (value) => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(value, 0);
    return buffer;
  };
  const matrix = Buffer.concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);
  const ftyp = box("ftyp", Buffer.from("isom....isom", "ascii"));
  const mvhd = box("mvhd", Buffer.concat([u32(0), u32(0), u32(0), u32(timescale), u32(duration), u32(0x00010000), Buffer.alloc(10), matrix, Buffer.alloc(24), u32(2)]));
  const tkhd = box("tkhd", Buffer.concat([u32(0), u32(0), u32(0), u32(1), u32(0), u32(duration), Buffer.alloc(8), Buffer.alloc(8), matrix,
    (() => {
      const dims = Buffer.alloc(8);
      dims.writeUInt32BE(width * 65536, 0);
      dims.writeUInt32BE(height * 65536, 4);
      return dims;
    })()]));
  const hdlr = box("hdlr", Buffer.concat([u32(0), u32(0), Buffer.from("vide", "ascii"), Buffer.alloc(12)]));
  const entryHeader = Buffer.alloc(8);
  entryHeader.writeUInt32BE(86, 0);
  entryHeader.write(fourcc, 4, "ascii");
  const stsd = box("stsd", Buffer.concat([u32(0), u32(1), entryHeader, Buffer.alloc(78)]));
  const mdia = box("mdia", box("mdhd", Buffer.concat([u32(0), u32(0), u32(0), u32(timescale), u32(duration), Buffer.alloc(8)])), hdlr, box("minf", box("stbl", stsd)));
  return Buffer.concat([ftyp, box("moov", mvhd, box("trak", tkhd, mdia))]);
}

function videoInput(operation = "text_to_video") {
  return {
    job_id: JOB, organization_id: ORG, capability: "video", lane: "gpu_video",
    correlation_id: CORR, attempt: 1, max_attempts: 3,
    params: {
      operation, prompt: "A falcon over dunes at dawn", duration: 5,
      resolution: "768P", ratio: "16:9",
      ...(operation === "image_to_video" ? { source_asset_version_id: SOURCE_VERSION } : {}),
      provider: "minimax", model: "MiniMax-H3", unit_price_usd: 0.08,
    },
  };
}

function stubDb({ input = videoInput(), prior = null, source = null, calls = null, state = { status: "running", cancel_requested: false }, stateFn = null } = {}) {
  const log = calls ?? { marks: [], begins: [], attaches: [], finishes: [], reconciles: [], registers: [], completes: [], fails: [] };
  return {
    log,
    async query(text, params) {
      if (text.includes("mark_creative_job_running")) {
        log.marks.push(params);
        return { rows: [{ status: "running" }] };
      }
      if (text.includes("count_creative_render_outputs")) {
        return { rows: [{ outputs: 0 }] };
      }
      if (text.includes("get_creative_video_input")) {
        return { rows: [{ input }] };
      }
      if (text.includes("get_creative_provider_call")) {
        return { rows: prior ? [{ call: prior }] : [] };
      }
      if (text.includes("attach_creative_provider_request")) {
        log.attaches.push(params);
        return { rows: [{ request_id: params[2] }] };
      }
      if (text.includes("get_creative_video_source")) {
        return { rows: source ? [{ source }] : [] };
      }
      if (text.includes("begin_creative_provider_call")) {
        log.begins.push(params);
        return { rows: [{ call_id: "90000000-0000-4000-8000-000000000001" }] };
      }
      if (text.includes("finish_creative_provider_call")) {
        log.finishes.push(params);
        return { rows: [{ status: params[4] }] };
      }
      if (text.includes("reconcile_creative_provider_call")) {
        log.reconciles.push(params);
        return { rows: [{ status: params[3] }] };
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
      if (text.includes("get_creative_motion_state")) {
        log.stateCalls = (log.stateCalls ?? 0) + 1;
        return { rows: [{ state: stateFn ? stateFn(log.stateCalls) : state }] };
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

function stubProvider({ onCreate, onQuery, mp4 } = {}) {
  const log = { creates: 0, queries: 0, downloaded: [] };
  return {
    log,
    provider: {
      name: "stub-minimax", model: "MiniMax-H3", modelVersion: null,
      adapterConfig: "creative.video-providers.v1", maxBytes: 104857600,
      artifactOrigins: ["cdn.hailuoai.com"], testLoopback: true,
      createTask: async (input) => {
        log.creates += 1;
        if (onCreate) return onCreate(input, log);
        return { taskId: "424010985738629", latencyMs: 5 };
      },
      queryTask: async (taskId) => {
        log.queries += 1;
        if (onQuery) return onQuery(taskId, log);
        return { status: "succeeded", url: "https://cdn.hailuoai.com/output.mp4", duration: 5, resolution: "768P", ratio: "16:9", usage: { output_seconds: 5 } };
      },
    },
    download: async ({ url, allowedOrigins }) => {
      assert.ok((allowedOrigins ?? []).length > 0);
      log.downloaded.push(url);
      return { bytes: mp4 ?? craftedMp4({}), contentType: "video/mp4" };
    },
  };
}

test("video worker module stays EXECUTE-only: no direct table reads", async () => {  const source = await readFile(new URL("../packages/creative-runtime/render/video-worker.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /FROM tanaghom\./);
  assert.doesNotMatch(source, /db\.query/);
  for (const name of ["getVideoInput", "getVideoSource", "claimVideoJob", "beginProviderCall", "finishProviderCall", "getProviderCall", "attachProviderRequest", "reconcileProviderCall", "markRunning", "registerVersion", "completeJob", "failJob"]) {
    assert.match(source, new RegExp(`\\b${name}\\b`));
  }
});

test("video request normalization and cost estimates", () => {
  const t2v = normalizeVideoRequest({ operation: "text_to_video", prompt: "  dunes  ", duration: 5, resolution: "768P", ratio: "16:9" });
  assert.equal(t2v.prompt, "dunes");
  assert.equal(estimateVideoCostUsd({ duration: 5 }), 0.4);
  assert.equal(estimateVideoCostUsd({ duration: 8 }), 0.64);
  assert.throws(() => normalizeVideoRequest({ operation: "talking_head", prompt: "x", duration: 5, resolution: "768P", ratio: "16:9" }), /operation/);
  assert.throws(() => normalizeVideoRequest({ operation: "text_to_video", prompt: "", duration: 5, resolution: "768P", ratio: "16:9" }), /prompt/);
  assert.throws(() => normalizeVideoRequest({ operation: "text_to_video", prompt: "x", duration: 30, resolution: "768P", ratio: "16:9" }), /duration/);
  assert.throws(() => normalizeVideoRequest({ operation: "text_to_video", prompt: "x", duration: 5, resolution: "768P", ratio: "adaptive" }), /ratio/);
  assert.throws(() => normalizeVideoRequest({ operation: "image_to_video", prompt: "x", duration: 5, resolution: "768P", ratio: "adaptive" }), /source image/);
  assert.throws(() => normalizeVideoRequest({ operation: "image_to_video", prompt: "x", duration: 5, resolution: "768P", ratio: "adaptive", imageUrl: "version:abc" }), /https URL or image data URI/);
  assert.throws(() => normalizeVideoRequest({ operation: "text_to_video", prompt: "x", duration: 5, resolution: "768P", ratio: "16:9", imageUrl: "https://x/y.png" }), /no image reference/);
  const i2v = normalizeVideoRequest({ operation: "image_to_video", prompt: "animate", duration: 5, resolution: "768P", ratio: "adaptive", imageUrl: "data:image/png;base64,iVBORw0KGgo=" });
  assert.match(i2v.imageUrl, /^data:image\/png;base64,/);
});

test("video adapter construction enforces https outside test loopback", () => {
  assert.throws(() => createHttpVideoAdapter({ name: "x", endpoint: ENDPOINT, queryEndpoint: QUERY_ENDPOINT, apiKey: "k", model: "MiniMax-H3" }), /must_be_https/);
  const adapter = createHttpVideoAdapter({ name: "x", endpoint: ENDPOINT, queryEndpoint: QUERY_ENDPOINT, apiKey: "k", model: "MiniMax-H3", testLoopback: true });
  assert.deepEqual(adapter.capabilities, ["video"]);
});

test("MiniMax task lifecycle maps to worker vocabulary", async () => {
  function jsonResponse(payload, status = 200, headers = {}) {
    return {
      ok: status >= 200 && status < 300, status,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      text: async () => JSON.stringify(payload),
    };
  }
  const created = await createVideoTask({
    endpoint: ENDPOINT, apiKey: "k",
    request: { model: "MiniMax-H3", operation: "text_to_video", prompt: "dunes", duration: 5, resolution: "768P", ratio: "16:9", imageUrl: null },
    fetchImpl: async () => jsonResponse({ task_id: "424010985738629" }),
  });
  assert.equal(created.taskId, "424010985738629");
  const done = await queryVideoTask({
    queryEndpoint: QUERY_ENDPOINT, apiKey: "k", taskId: "424010985738629",
    fetchImpl: async () => jsonResponse({ task: { id: "424010985738629", status: "succeeded", content: { url: "https://cdn.hailuoai.com/o.mp4" }, duration: 5, resolution: "768P", ratio: "16:9", usage: { output_seconds: 5 } } }),
  });
  assert.equal(done.status, "succeeded");
  assert.equal(done.url, "https://cdn.hailuoai.com/o.mp4");
  const running = await queryVideoTask({
    queryEndpoint: QUERY_ENDPOINT, apiKey: "k", taskId: "t",
    fetchImpl: async () => jsonResponse({ task: { id: "t", status: "running" } }),
  });
  assert.equal(running.status, "running");
  await assert.rejects(
    queryVideoTask({
      queryEndpoint: QUERY_ENDPOINT, apiKey: "k", taskId: "t",
      fetchImpl: async () => jsonResponse({ task: { id: "t", status: "failed", error: { code: "1026", message: "video description contains sensitive content" } } }),
    }),
    /sensitive content/,
  );
  await assert.rejects(
    queryVideoTask({
      queryEndpoint: QUERY_ENDPOINT, apiKey: "k", taskId: "t",
      fetchImpl: async () => jsonResponse({ task: { id: "t", status: "weird" } }),
    }),
    /unknown task status/,
  );
  for (const [status, check] of [
    [429, (error) => error.errorClass === "capacity"],
    [402, (error) => error.errorClass === "deterministic"],
    [422, (error) => error.errorClass === "deterministic"],
    [500, (error) => error.errorClass === "transient"],
  ]) {
    await assert.rejects(
      createVideoTask({
        endpoint: ENDPOINT, apiKey: "k",
        request: { model: "MiniMax-H3", operation: "text_to_video", prompt: "x", duration: 5, resolution: "768P", ratio: "16:9", imageUrl: null },
        fetchImpl: async () => jsonResponse({ type: "error", error: { message: "nope" } }, status),
      }),
      check,
    );
  }
  await assert.rejects(
    createVideoTask({
      endpoint: ENDPOINT, apiKey: "k",
      request: { model: "MiniMax-H3", operation: "text_to_video", prompt: "x", duration: 5, resolution: "768P", ratio: "16:9", imageUrl: null },
      fetchImpl: async () => { throw new Error("socket hangup"); },
    }),
    (error) => error.errorClass === "indeterminate",
  );
});

test("provider MP4s validate against the vendor codec allowlist, never MIME", () => {
  const avc = craftedMp4({ fourcc: "avc1" });
  const info = validateMp4(avc, { expectedDurationSec: 5, allowedCodecs: [...PROVIDER_VIDEO_CODECS] });
  assert.equal(info.codec, "avc1");
  assert.equal(info.width, 640);
  assert.throws(() => validateMp4(avc, { expectedDurationSec: 5 }), /mp4_codec:avc1/);
  assert.throws(() => validateMp4(craftedMp4({ fourcc: "hvc1" }), { expectedDurationSec: 5, allowedCodecs: [...PROVIDER_VIDEO_CODECS] }), /mp4_codec:hvc1/);
  assert.throws(() => validateMp4(avc, { expectedDurationSec: 60, allowedCodecs: [...PROVIDER_VIDEO_CODECS] }), /mp4_duration/);
});

test("video worker executes text-to-video to a persisted version", async () => {
  const db = stubDb({});
  const storage = memoryStorage();
  const fake = stubProvider({});
  const result = await executeVideoJob({
    db, storage, provider: fake.provider, download: fake.download,
    jobId: JOB, worker: WORKER, pollIntervalMs: 5, pollTimeoutMs: 1000,
  });
  assert.equal(fake.log.creates, 1);
  assert.ok(fake.log.queries >= 1);
  assert.deepEqual(fake.log.downloaded, ["https://cdn.hailuoai.com/output.mp4"]);
  assert.equal(db.log.begins.length, 1);
  assert.equal(db.log.begins[0][2], "stub-minimax");
  assert.equal(db.log.begins[0][5], "text_to_video");
  assert.deepEqual(db.log.attaches, [["90000000-0000-4000-8000-000000000001", WORKER, "424010985738629"]]);
  assert.equal(db.log.finishes.length, 1);
  assert.deepEqual(db.log.finishes[0].slice(3, 6), [0.4, "succeeded", null]);
  assert.equal(db.log.registers.length, 1);
  const params = db.log.registers[0];
  assert.equal(params[4], "video/mp4");
  assert.equal(params[5], 640);
  assert.equal(params[6], 640);
  const provenance = params[12];
  assert.equal(provenance.provider, "stub-minimax");
  assert.equal(provenance.model, "MiniMax-H3");
  assert.equal(provenance.provider_task_id, "424010985738629");
  assert.equal(provenance.operation, "text_to_video");
  assert.equal(provenance.estimated_cost_usd, 0.4);
  assert.equal(provenance.actual_cost_usd, 0.4);
  assert.equal(provenance.video.codec, "avc1");
  assert.equal(provenance.correlation_id, CORR);
  assert.equal(params[14], null);
  assert.equal(params[15], "render");
  assert.deepEqual(db.log.completes, [[JOB, WORKER, "50000000-0000-4000-8000-000000000001", null]]);
  assert.equal(result.output.codec, "avc1");
  assert.equal(result.output.actualCostUsd, 0.4);
  assert.match(result.output.objectKey, new RegExp(`^t/${ORG}/video/${JOB}/v1\\.mp4$`));
});

test("video worker resolves private sources for image-to-video", async () => {
  const sourceBytes = craftedMp4({});
  const db = stubDb({
    input: videoInput("image_to_video"),
    source: { version_id: SOURCE_VERSION, object_key: `t/${ORG}/image/${JOB}/v1.png`, mime: "image/png" },
  });
  const storage = memoryStorage();
  await storage.put(`t/${ORG}/image/${JOB}/v1.png`, sourceBytes, "image/png");
  const seen = {};
  const fake = stubProvider({
    onCreate: (input) => {
      seen.imageUrl = input.imageUrl;
      return { taskId: "t2", latencyMs: 1 };
    },
  });
  const result = await executeVideoJob({
    db, storage, provider: fake.provider, download: fake.download,
    jobId: JOB, worker: WORKER, pollIntervalMs: 5, pollTimeoutMs: 1000,
  });
  assert.match(seen.imageUrl, /^data:image\/png;base64,/);
  assert.equal(result.provider.taskId, "t2");
  assert.equal(db.log.registers[0][12].source_asset_version_id, SOURCE_VERSION);
});

test("indeterminate attempts are never blindly retried", async () => {
  const dbFirst = stubDb({});
  const fakeFirst = stubProvider({
    onCreate: () => {
      const error = new Error("socket hangup at create");
      error.errorClass = "indeterminate";
      throw error;
    },
  });
  await assert.rejects(
    executeVideoJob({
      db: dbFirst, storage: memoryStorage(), provider: fakeFirst.provider, download: fakeFirst.download,
      jobId: JOB, worker: WORKER, pollIntervalMs: 5, pollTimeoutMs: 1000,
    }),
    /video_provider_uncertain/,
  );
  assert.equal(dbFirst.log.fails[0][2], "transient");
  assert.deepEqual(dbFirst.log.finishes[0].slice(4, 6), ["indeterminate", "indeterminate"]);

  // Second pass sees the unresolved attempt WITHOUT a task anchor and
  // refuses a blind retry.
  const dbSecond = stubDb({
    prior: { call_id: "90000000-0000-4000-8000-000000000001", status: "indeterminate", error_class: "indeterminate", provider_request_id: null, attempt_no: 1 },
  });
  const fakeSecond = stubProvider({});
  await assert.rejects(
    executeVideoJob({
      db: dbSecond, storage: memoryStorage(), provider: fakeSecond.provider, download: fakeSecond.download,
      jobId: JOB, worker: WORKER, pollIntervalMs: 5, pollTimeoutMs: 1000,
    }),
    /video_blind_retry_refused/,
  );
  assert.equal(fakeSecond.log.creates, 0);
  assert.equal(dbSecond.log.fails[0][2], "deterministic");
});

test("restart resumes the SAME anchored task without a new create", async () => {
  const prior = {
    call_id: "90000000-0000-4000-8000-000000000001", status: "started", error_class: null,
    provider_request_id: "task-anchored-1", attempt_no: 1,
  };
  const db = stubDb({ prior });
  const queried = [];
  const fake = stubProvider({
    onCreate: () => { throw new Error("createTask must not run on resume"); },
    onQuery: (taskId) => {
      queried.push(taskId);
      return { status: "succeeded", url: "https://cdn.hailuoai.com/output.mp4", duration: 5, resolution: "768P", ratio: "16:9", usage: { output_seconds: 5 } };
    },
  });
  const result = await executeVideoJob({
    db, storage: memoryStorage(), provider: fake.provider, download: fake.download,
    jobId: JOB, worker: WORKER, pollIntervalMs: 5, pollTimeoutMs: 1000,
  });
  assert.equal(fake.log.creates, 0);
  assert.deepEqual(queried, ["task-anchored-1"]);
  assert.equal(result.provider.taskId, "task-anchored-1");
  assert.equal(db.log.registers.length, 1);
  assert.deepEqual(db.log.completes, [[JOB, WORKER, "50000000-0000-4000-8000-000000000001", null]]);
  assert.equal(db.log.registers[0][12].reconciliation_resumed, true);
});

test("resume of a terminal-succeeded attempt re-downloads without recreate", async () => {
  const prior = {
    call_id: "90000000-0000-4000-8000-000000000001", status: "succeeded", error_class: null,
    provider_request_id: "task-anchored-2", attempt_no: 1,
  };
  const db = stubDb({ prior });
  const queried = [];
  const fake = stubProvider({
    onCreate: () => { throw new Error("createTask must not run on resume"); },
    onQuery: (taskId) => {
      queried.push(taskId);
      return { status: "succeeded", url: "https://cdn.hailuoai.com/output.mp4", duration: 5, resolution: "768P", ratio: "16:9", usage: { output_seconds: 5 } };
    },
  });
  const result = await executeVideoJob({
    db, storage: memoryStorage(), provider: fake.provider, download: fake.download,
    jobId: JOB, worker: WORKER, pollIntervalMs: 5, pollTimeoutMs: 1000,
  });
  assert.equal(fake.log.creates, 0);
  assert.deepEqual(queried, ["task-anchored-2"]);
  // Success settle routed through reconcile (same-state, idempotent).
  assert.equal(db.log.reconciles.length, 1);
  assert.equal(db.log.reconciles[0][3], "succeeded");
  assert.equal(db.log.finishes.length, 0);
  assert.equal(result.output.codec, "avc1");
  assert.deepEqual(db.log.completes, [[JOB, WORKER, "50000000-0000-4000-8000-000000000001", null]]);
});

test("provider success survives downstream artifact failure", async () => {
  const db = stubDb({});
  const fake = stubProvider({});
  const badDownload = async () => {
    const error = new Error("artifact download failed (404)");
    error.errorClass = "deterministic";
    throw error;
  };
  await assert.rejects(
    executeVideoJob({
      db, storage: memoryStorage(), provider: fake.provider, download: badDownload,
      jobId: JOB, worker: WORKER, pollIntervalMs: 5, pollTimeoutMs: 1000,
    }),
    /video_artifact_rejected/,
  );
  // Provider ledger recorded succeeded+actual BEFORE the download; the
  // conflicting rewrite back to failed was attempted and refused, so the
  // success finish stands exactly once.
  assert.deepEqual(db.log.finishes[0].slice(3, 6), [0.4, "succeeded", null]);
  assert.equal(db.log.finishes.length, 1);
  assert.equal(db.log.fails[0][2], "deterministic");
  assert.equal(db.log.registers.length, 0);
  assert.equal(db.log.completes.length, 0);
});

test("capacity rejection without a task allows exactly one new attempt", async () => {
  const prior = {
    call_id: "90000000-0000-4000-8000-000000000001", status: "failed", error_class: "capacity",
    provider_request_id: null, attempt_no: 1,
  };
  const db = stubDb({ prior });
  const fake = stubProvider({});
  const result = await executeVideoJob({
    db, storage: memoryStorage(), provider: fake.provider, download: fake.download,
    jobId: JOB, worker: WORKER, pollIntervalMs: 5, pollTimeoutMs: 1000,
  });
  assert.equal(fake.log.creates, 1);
  assert.equal(result.output.codec, "avc1");
});

test("transient poll errors keep reconciling the same task", async () => {
  const db = stubDb({});
  let polls = 0;
  const fake = stubProvider({
    onQuery: () => {
      polls += 1;
      if (polls <= 2) {
        const error = new Error("gateway timeout during poll");
        error.errorClass = "transient";
        throw error;
      }
      return { status: "succeeded", url: "https://cdn.hailuoai.com/output.mp4", duration: 5, resolution: "768P", ratio: "16:9", usage: { output_seconds: 5 } };
    },
  });
  const result = await executeVideoJob({
    db, storage: memoryStorage(), provider: fake.provider, download: fake.download,
    jobId: JOB, worker: WORKER, pollIntervalMs: 5, pollTimeoutMs: 5000,
  });
  assert.equal(fake.log.creates, 1);
  assert.ok(polls >= 3);
  assert.equal(result.output.codec, "avc1");
  // No terminal finish was recorded for the transient blips: exactly one
  // finish (the final success) exists.
  assert.equal(db.log.finishes.length, 1);
  assert.equal(db.log.finishes[0][4], "succeeded");
  assert.equal(db.log.completes.length, 1);
});

test("moderated provider failures are deterministic and terminal", async () => {
  const db = stubDb({});
  const fake = stubProvider({
    onQuery: () => ({ status: "failed" }),
  });
  // Query-level failure without structured error still terminalizes.
  await assert.rejects(
    executeVideoJob({
      db, storage: memoryStorage(), provider: fake.provider, download: fake.download,
      jobId: JOB, worker: WORKER, pollIntervalMs: 5, pollTimeoutMs: 1000,
    }),
    /video_provider_task_failed/,
  );
  assert.equal(db.log.fails[0][2], "deterministic");
  assert.equal(db.log.completes.length, 0);
});

test("provider-reported cancelled is the only path recording provider-cancelled", async () => {
  const db = stubDb({});
  const fake = stubProvider({
    onQuery: () => ({ status: "cancelled" }),
  });
  await assert.rejects(
    executeVideoJob({
      db, storage: memoryStorage(), provider: fake.provider, download: fake.download,
      jobId: JOB, worker: WORKER, pollIntervalMs: 5, pollTimeoutMs: 1000,
    }),
    /video_provider_task_cancelled/,
  );
  assert.deepEqual(db.log.finishes[0].slice(4, 6), ["cancelled", "cancelled"]);
  assert.equal(db.log.fails[0][2], "cancelled");
  assert.equal(db.log.completes.length, 0);
  assert.equal(db.log.registers.length, 0);
});

test("local cancel stops polling without a provider cancel call", async () => {
  // Cancel lands before execution: no provider contact at all.
  const dbPre = stubDb({});
  const origQuery = dbPre.query.bind(dbPre);
  dbPre.query = async (text, params) => {
    if (text.includes("mark_creative_job_running")) return { rows: [{ status: "cancelled" }] };
    return origQuery(text, params);
  };
  const fakePre = stubProvider({});
  await assert.rejects(
    executeVideoJob({
      db: dbPre, storage: memoryStorage(), provider: fakePre.provider, download: fakePre.download,
      jobId: JOB, worker: WORKER, pollIntervalMs: 5, pollTimeoutMs: 1000,
    }),
    /video_cancel_requested/,
  );
  assert.equal(fakePre.log.creates, 0);
  assert.equal(fakePre.log.queries, 0);
  assert.equal(dbPre.log.fails[0][2], "cancelled");
});

test("cancel during provider polling reconciles truthfully, then records cancel", async () => {
  const db = stubDb({
    stateFn: (n) => (n >= 3
      ? { status: "running", cancel_requested: true }
      : { status: "running", cancel_requested: false }),
  });
  const fake = stubProvider({
    onQuery: () => ({ status: "succeeded", url: "https://cdn.hailuoai.com/output.mp4", duration: 5, resolution: "768P", ratio: "16:9", usage: { output_seconds: 5 } }),
  });
  await assert.rejects(
    executeVideoJob({
      db, storage: memoryStorage(), provider: fake.provider, download: fake.download,
      jobId: JOB, worker: WORKER, pollIntervalMs: 5, pollTimeoutMs: 5000,
    }),
    /video_cancel_requested/,
  );
  // The charged artifact still persisted as draft output...
  assert.equal(db.log.registers.length, 1);
  assert.equal(db.log.registers[0][12].local_cancel_requested, true);
  assert.equal(db.log.registers[0][12].remote_outcome, "succeeded");
  // ...while the job honors the user's cancel intent and never completes.
  // No provider cancel endpoint exists or is called: only queryTask ran.
  assert.ok(fake.log.queries >= 1);
  assert.equal(db.log.fails[0][2], "cancelled");
  assert.equal(db.log.completes.length, 0);
});

test("video claim helper uses the filtered claim", async () => {
  const empty = { query: async () => ({ rows: [] }) };
  assert.equal(await claimVideoRenderJob(empty, { worker: WORKER }), null);
  const calls = [];
  const own = {
    query: async (text, params) => {
      calls.push([text, params]);
      assert.match(text, /claim_creative_video_job/);
      return { rows: [{ job_id: JOB, capability: "video" }] };
    },
  };
  const claimed = await claimVideoRenderJob(own, { worker: WORKER });
  assert.equal(claimed.jobId, JOB);
  assert.deepEqual(calls[0][1], [WORKER, 120]);
});
