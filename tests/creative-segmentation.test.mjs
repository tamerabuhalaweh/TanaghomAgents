import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import sharp from "sharp";

import {
  SEGMENT_ENGINES,
  assertPngImage,
  normalizeSegmentRequest,
  probeSource,
  runBirefnetBridge,
  segmentLocalDeterministic,
} from "../packages/creative-runtime/adapters/segmentation.mjs";
import {
  buildSegmentKey,
  claimSegmentRenderJob,
  executeSegmentJob,
} from "../packages/creative-runtime/render/segment-worker.mjs";
import { createTestStorage } from "../packages/creative-runtime/storage/test-adapter.mjs";

const ORG = "10000000-0000-4000-8000-000000000001";
const JOB = "20000000-0000-4000-8000-000000000001";
const SOURCE_VERSION = "70000000-0000-4000-8000-000000000001";
const CORR = "40000000-0000-4000-8000-000000000001";
const WORKER = "worker-segment-test";

async function productFixture(size = 256) {
  const background = await sharp({
    create: { width: size, height: size, channels: 3, background: { r: 240, g: 240, b: 235 } },
  }).png().toBuffer();
  const boxSize = Math.floor(size / 3);
  const offset = Math.floor((size - boxSize) / 2);
  const overlay = Buffer.from(
    `<svg width="${size}" height="${size}"><rect x="${offset}" y="${offset}" width="${boxSize}" height="${boxSize}" rx="18" fill="rgb(30,60,120)"/></svg>`,
  );
  return sharp(background).composite([{ input: overlay }]).png().toBuffer();
}

function segmentInput(params = {}) {
  return {
    job_id: JOB, organization_id: ORG, capability: "product_shoot", lane: "cpu",
    correlation_id: CORR, attempt: 1, max_attempts: 3,
    params: {
      operation: "segment", source_asset_version_id: SOURCE_VERSION,
      engine: "local-deterministic", refine: {},
      ...params,
    },
  };
}

function stubDb({ input = segmentInput(), source = null, outputs = [], calls = null, state = { status: "running", cancel_requested: false } } = {}) {
  const log = calls ?? { marks: [], registers: [], completes: [], fails: [] };
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
      if (text.includes("get_creative_segment_input")) {
        return { rows: [{ input }] };
      }
      if (text.includes("get_creative_segment_source")) {
        return { rows: source ? [{ source }] : [] };
      }
      if (text.includes("get_creative_segment_outputs")) {
        return { rows: [{ outputs }] };
      }
      if (text.includes("get_creative_segment_state")) {
        return { rows: [{ state }] };
      }
      if (text.includes("create_creative_asset_version")) {
        log.registers.push(params);
        return { rows: [{ asset_version_id: `50000000-0000-4000-8000-${String(log.registers.length).padStart(12, "0")}` }] };
      }
      if (text.includes("get_creative_render_version_asset")) {
        return { rows: [{ asset_id: "60000000-0000-4000-8000-000000000001" }] };
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
  const log = { puts: [] };
  return {
    log,
    put: (key, bytes, mime) => {
      log.puts.push(key);
      return mem.put({ key, bytes, mime });
    },
    get: (key) => {
      try {
        return mem.get(key);
      } catch {
        return null;
      }
    },
  };
}

test("segmentation worker module stays EXECUTE-only: no direct table reads", async () => {
  const source = await readFile(new URL("../packages/creative-runtime/render/segment-worker.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /FROM tanaghom\./);
  assert.doesNotMatch(source, /db\.query/);
  for (const name of ["getSegmentInput", "getSegmentSource", "getSegmentOutputs", "getSegmentState", "claimSegmentJob", "markRunning", "registerVersion", "getRenderVersionAsset", "completeJob", "failJob", "verifyBirefnetDeployment"]) {
    assert.match(source, new RegExp(`\\b${name}\\b`));
  }
});

test("segmentation migration is additive, guarded, and reversible", async () => {
  const root = new URL("../", import.meta.url);
  const up = await readFile(new URL("packages/database/migrations/0045_creative_segmentation.up.sql", root), "utf8");
  const down = await readFile(new URL("packages/database/migrations/0045_creative_segmentation.down.sql", root), "utf8");
  assert.match(up, /0045 requires exact 0044 baseline/);
  assert.match(up, /CREATE FUNCTION tanaghom\.get_creative_segment_input\(/);
  assert.match(up, /CREATE FUNCTION tanaghom\.get_creative_segment_source\(/);
  assert.match(up, /CREATE FUNCTION tanaghom\.claim_creative_segment_job\(/);
  assert.match(up, /CREATE FUNCTION tanaghom\.get_creative_segment_state\(/);
  assert.match(up, /params->>'operation'\)='segment'/);
  assert.match(up, /GRANT EXECUTE ON FUNCTION tanaghom\.claim_creative_segment_job\(text,int\) TO tanaghom_creative_worker;/);
  assert.match(up, /INSERT INTO public\.schema_migrations\(version\) VALUES \('0045_creative_segmentation'\)/);
  assert.doesNotMatch(up, /CREATE TABLE/);
  assert.doesNotMatch(up, /GRANT SELECT/);
  assert.match(down, /DROP FUNCTION tanaghom\.claim_creative_segment_job\(text,int\);/);
  assert.match(down, /DELETE FROM public.schema_migrations WHERE version='0045_creative_segmentation'/);
});

test("segment request normalization enforces engines, mimes, dims, and refine bounds", () => {
  const ok = normalizeSegmentRequest({ engine: "local-deterministic", mime: "image/png", width: 256, height: 256, bytesLength: 1000, refine: { feather_px: 2 } });
  assert.equal(ok.refine.threshold, 48);
  assert.throws(() => normalizeSegmentRequest({ engine: "rmbg", mime: "image/png", width: 64, height: 64, bytesLength: 10, refine: {} }), /segment_engine_allowlist/);
  assert.throws(() => normalizeSegmentRequest({ engine: "birefnet", mime: "image/gif", width: 64, height: 64, bytesLength: 10, refine: {} }), /segment_mime_allowlist/);
  assert.throws(() => normalizeSegmentRequest({ engine: "birefnet", mime: "image/png", width: 4096, height: 64, bytesLength: 10, refine: {} }), /too_large/);
  assert.throws(() => normalizeSegmentRequest({ engine: "birefnet", mime: "image/png", width: 64, height: 64, bytesLength: 10, refine: { feather_px: 99 } }), /feather/);
  assert.throws(() => normalizeSegmentRequest({ engine: "birefnet", mime: "image/png", width: 64, height: 64, bytesLength: 10, refine: { invert: true } }), /unknown/);
  assert.ok(SEGMENT_ENGINES.includes("birefnet"));
  assert.ok(!SEGMENT_ENGINES.includes("upload"));
});

test("local deterministic engine segments fixtures without touching the source", async () => {
  const source = await productFixture();
  const before = Buffer.from(source);
  const result = await segmentLocalDeterministic({ bytes: source, refine: {} });
  assert.deepEqual(source, before);
  assert.equal(result.width, 256);
  assert.equal(result.height, 256);
  assert.ok(result.coverage > 0.05 && result.coverage < 0.5);
  assertPngImage(result.maskPng, { width: 256, height: 256 });
  assertPngImage(result.cutoutPng, { width: 256, height: 256 });
  // RGB channels pass through untouched: only alpha changes.
  const sourceRaw = await sharp(source).ensureAlpha().raw().toBuffer();
  const cutoutRaw = await sharp(result.cutoutPng).raw().toBuffer();
  assert.equal(sourceRaw.length, cutoutRaw.length);
  for (let i = 0; i < sourceRaw.length; i += 4) {
    assert.equal(cutoutRaw[i], sourceRaw[i]);
    assert.equal(cutoutRaw[i + 1], sourceRaw[i + 1]);
    assert.equal(cutoutRaw[i + 2], sourceRaw[i + 2]);
  }
  // Some background is actually transparent, some product opaque.
  let transparent = 0;
  let opaque = 0;
  for (let i = 3; i < cutoutRaw.length; i += 4) {
    if (cutoutRaw[i] === 0) transparent += 1;
    if (cutoutRaw[i] === 255) opaque += 1;
  }
  assert.ok(transparent > 1000);
  assert.ok(opaque > 1000);
  // Refinement only reshapes alpha: erode shrinks coverage.
  const eroded = await segmentLocalDeterministic({ bytes: source, refine: { erode_px: 2 } });
  assert.ok(eroded.coverage < result.coverage);
  const probed = await probeSource(source);
  assert.equal(probed.width, 256);
  assert.equal(probed.mime, "image/png");
  await assert.rejects(probeSource(Buffer.from("not an image at all, just text......")), /segment_source_mime/);
});

test("bridge runner uses fixed argv, no shell, with timeout and report validation", async () => {
  const seen = {};
  const maskPng = await sharp(Buffer.alloc(64 * 64, 255), { raw: { width: 64, height: 64, channels: 1 } }).png().toBuffer();
  const fakeSpawn = (bin, argv, opts) => {
    seen.bin = bin;
    seen.argv = argv;
    seen.opts = opts;
    const handlers = {};
    return {
      on: (event, handler) => { handlers[event] = handler; seen.handlers = handlers; },
      stdout: { on: (event, handler) => { handlers[`stdout:${event}`] = handler; }, emitData: (text) => handlers["stdout:data"]?.(Buffer.from(text)) },
      stderr: { on: () => {} },
      stdin: { on: () => {} },
      kill: () => { seen.killed = true; handlers.close?.(1); },
    };
  };
  const pending = runBirefnetBridge({
    pythonBin: "/usr/bin/python3", bridgeScript: "/srv/birefnet_bridge.py",
    codeDir: "/srv/birefnet", weightsPath: "/srv/model.safetensors",
    inputPath: "/tmp/in.png", outputMaskPath: "/tmp/mask.png",
    size: 1024, device: "cpu", timeoutMs: 60000, spawnFn: fakeSpawn,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen.argv, [
    "/srv/birefnet_bridge.py",
    "--code-dir", "/srv/birefnet",
    "--weights", "/srv/model.safetensors",
    "--input", "/tmp/in.png",
    "--output-mask", "/tmp/mask.png",
    "--size", "1024",
    "--device", "cpu",
  ]);
  assert.equal(seen.opts.shell, undefined);
  seen.handlers["stdout:data"](JSON.stringify({ mask_sha256: "a".repeat(64), width: 256, height: 256, infer_ms: 72000, device: "cpu" }) + "\n");
  seen.handlers.close(0);
  const report = await pending;
  assert.equal(report.inferMs, 72000);
  assert.equal(report.device, "cpu");
  void maskPng;
  await assert.rejects(runBirefnetBridge({
    pythonBin: "/usr/bin/python3", bridgeScript: "/srv/b.py", codeDir: "/srv/c", weightsPath: "/srv/w",
    inputPath: "/tmp/i.png", outputMaskPath: "/tmp/o.png", size: 2048, device: "cpu", spawnFn: fakeSpawn,
  }), /size_allowlist/);
  await assert.rejects(runBirefnetBridge({
    pythonBin: "/usr/bin/python3", bridgeScript: "/srv/b.py", codeDir: "/srv/c", weightsPath: "/srv/w",
    inputPath: "/tmp/i.png", outputMaskPath: "/tmp/o.png", size: 1024, device: "tpu", spawnFn: fakeSpawn,
  }), /device_allowlist/);
});

test("segment worker persists mask v1 + cutout v2 of one lineage", async () => {
  const source = await productFixture();
  const db = stubDb({
    source: { version_id: SOURCE_VERSION, object_key: `t/${ORG}/image/${JOB}/v1.png`, mime: "image/png" },
  });
  const storage = memoryStorage();
  await storage.put(`t/${ORG}/image/${JOB}/v1.png`, source, "image/png");
  const result = await executeSegmentJob({ db, storage, jobId: JOB, worker: WORKER });
  assert.deepEqual(db.log.marks, [[JOB, WORKER]]);
  assert.equal(db.log.registers.length, 2);
  const [maskJob, , maskAsset, maskTitle, maskMime] = db.log.registers[0];
  assert.equal(maskJob, JOB);
  assert.equal(maskAsset, null);
  assert.equal(maskTitle, "Segmentation mask");
  assert.equal(maskMime, "image/png");
  assert.equal(db.log.registers[0][12].kind, "mask");
  assert.equal(db.log.registers[0][12].engine, "local-deterministic");
  assert.equal(db.log.registers[0][12].source_asset_version_id, SOURCE_VERSION);
  const cutoutParams = db.log.registers[1];
  assert.equal(cutoutParams[2], "60000000-0000-4000-8000-000000000001");
  assert.equal(cutoutParams[12].kind, "cutout");
  assert.equal(cutoutParams[12].mask_version_id, "50000000-0000-4000-8000-000000000001");
  assert.deepEqual(db.log.completes, [[JOB, WORKER, "50000000-0000-4000-8000-000000000002", null]]);
  assert.equal(result.assetId, "60000000-0000-4000-8000-000000000001");
  assert.equal(result.maskVersionId, "50000000-0000-4000-8000-000000000001");
  assert.equal(result.cutoutVersionId, "50000000-0000-4000-8000-000000000002");
  assert.match(result.output.maskKey, new RegExp(`^t/${ORG}/product_shoot/${JOB}/v1\\.png$`));
  assert.match(result.output.cutoutKey, new RegExp(`^t/${ORG}/product_shoot/${JOB}/v2\\.png$`));
  // Source asset untouched on disk.
  assert.deepEqual((await storage.get(`t/${ORG}/image/${JOB}/v1.png`)).bytes, source);
});

test("segment worker fails closed on bad engine, unknown source, and cancel", async () => {
  const source = await productFixture();
  const withSource = () => {
    const storage = memoryStorage();
    return storage.put(`t/${ORG}/image/${JOB}/v1.png`, source, "image/png").then(() => storage);
  };
  const dbBadEngine = stubDb({
    input: segmentInput({ engine: "rmbg" }),
    source: { version_id: SOURCE_VERSION, object_key: `t/${ORG}/image/${JOB}/v1.png`, mime: "image/png" },
  });
  const badEngineStorage = memoryStorage();
  badEngineStorage.put(`t/${ORG}/image/${JOB}/v1.png`, source, "image/png");
  await assert.rejects(
    executeSegmentJob({ db: dbBadEngine, storage: badEngineStorage, jobId: JOB, worker: WORKER }),
    /segment_engine_allowlist/,
  );
  assert.equal(dbBadEngine.log.fails[0][2], "deterministic");

  const dbNoSource = stubDb({});
  await assert.rejects(
    executeSegmentJob({ db: dbNoSource, storage: memoryStorage(), jobId: JOB, worker: WORKER }),
    /segment_source_not_found/,
  );

  const dbCancel = stubDb({
    source: { version_id: SOURCE_VERSION, object_key: `t/${ORG}/image/${JOB}/v1.png`, mime: "image/png" },
    state: { status: "running", cancel_requested: true },
  });
  const cancelStorage = memoryStorage();
  cancelStorage.put(`t/${ORG}/image/${JOB}/v1.png`, source, "image/png");
  await assert.rejects(
    executeSegmentJob({ db: dbCancel, storage: cancelStorage, jobId: JOB, worker: WORKER }),
    /segment_cancel_requested/,
  );
  assert.equal(dbCancel.log.fails[0][2], "cancelled");
  assert.equal(dbCancel.log.completes.length, 0);
});

test("deployment verification pins weights and code before inference", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { writeFileSync, appendFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const { verifyBirefnetDeployment } = await import("../packages/creative-runtime/adapters/segmentation.mjs");
  const dir = mkdtempSync(join(tmpdir(), "seg-deploy-"));
  const codeFile = join(dir, "models", "birefnet.py");
  await import("node:fs/promises").then((fs) => fs.mkdir(join(dir, "models"), { recursive: true }));
  writeFileSync(codeFile, Buffer.from("# pinned bridge code"));
  const weightsFile = join(dir, "model.safetensors");
  writeFileSync(weightsFile, Buffer.from("model-bytes-0123456789"));
  const manifest = {
    code_revision: "rev-1",
    files: { "models/birefnet.py": createHash("sha256").update("# pinned bridge code").digest("hex") },
    weights_sha256: createHash("sha256").update("model-bytes-0123456789").digest("hex"),
    weights_bytes: 22,
  };
  const verified = await verifyBirefnetDeployment({ codeDir: dir, weightsPath: weightsFile, manifest });
  assert.equal(verified.codeRevision, "rev-1");
  assert.equal(verified.weightsBytes, 22);
  appendFileSync(weightsFile, Buffer.from("tamper"));
  await assert.rejects(
    verifyBirefnetDeployment({ codeDir: dir, weightsPath: weightsFile, manifest }),
    /weights_size|weights_mismatch/,
  );
  await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
});

test("restart recovery reuses verified outputs without duplicates", async () => {
  const source = await productFixture();
  const firstStorage = memoryStorage();
  firstStorage.put(`t/${ORG}/image/${JOB}/v1.png`, source, "image/png");
  const db = stubDb({
    source: { version_id: SOURCE_VERSION, object_key: `t/${ORG}/image/${JOB}/v1.png`, mime: "image/png" },
  });
  // First pass: cutout object write fails transiently after the mask
  // object landed.
  const failingStorage = {
    ...firstStorage,
    put: (key, bytes, mime) => {
      if (key.endsWith("/v2.png")) throw new Error("simulated cutout write failure");
      return firstStorage.put(key, bytes, mime);
    },
  };
  await assert.rejects(
    executeSegmentJob({ db, storage: failingStorage, jobId: JOB, worker: WORKER }),
    /segment_storage_failed:cutout/,
  );
  // Mask object exists, no rows: retry adopts the orphan and continues.
  const retryStorage = memoryStorage();
  const maskBytes = firstStorage.get(`t/${ORG}/product_shoot/${JOB}/v1.png`).bytes;
  retryStorage.put(`t/${ORG}/image/${JOB}/v1.png`, source, "image/png");
  retryStorage.put(`t/${ORG}/product_shoot/${JOB}/v1.png`, Buffer.from(maskBytes), "image/png");
  const dbRetry = stubDb({
    source: { version_id: SOURCE_VERSION, object_key: `t/${ORG}/image/${JOB}/v1.png`, mime: "image/png" },
  });
  const retryResult = await executeSegmentJob({ db: dbRetry, storage: retryStorage, jobId: JOB, worker: WORKER });
  assert.equal(dbRetry.log.registers.length, 2);
  assert.deepEqual(dbRetry.log.completes, [[JOB, WORKER, "50000000-0000-4000-8000-000000000002", null]]);
  // Exactly one mask version + one cutout version, same lineage.
  const versions = dbRetry.log.registers.map((params) => params[12].kind);
  assert.deepEqual(versions, ["mask", "cutout"]);
  assert.equal(retryResult.maskVersionId, "50000000-0000-4000-8000-000000000001");
  assert.equal(retryResult.cutoutVersionId, "50000000-0000-4000-8000-000000000002");

  // Second scenario: mask row exists, cutout missing everywhere.
  const maskRow = {
    version_id: "50000000-0000-4000-8000-000000000001", asset_id: "60000000-0000-4000-8000-000000000001",
    version: 1, object_key: `t/${ORG}/product_shoot/${JOB}/v1.png`, sha256: retryStorage.get(`t/${ORG}/product_shoot/${JOB}/v1.png`).sha256,
    mime: "image/png", kind: "mask",
  };
  // NOTE: test-adapter get returns sha; reuse it for the row fixture.
  const dbResume = stubDb({
    source: { version_id: SOURCE_VERSION, object_key: `t/${ORG}/image/${JOB}/v1.png`, mime: "image/png" },
    outputs: [maskRow],
  });
  const resumeStorage = memoryStorage();
  resumeStorage.put(`t/${ORG}/image/${JOB}/v1.png`, source, "image/png");
  resumeStorage.put(`t/${ORG}/product_shoot/${JOB}/v1.png`, Buffer.from(maskBytes), "image/png");
  const resumeResult = await executeSegmentJob({ db: dbResume, storage: resumeStorage, jobId: JOB, worker: WORKER });
  assert.equal(dbResume.log.registers.length, 1);
  assert.equal(dbResume.log.registers[0][12].kind, "cutout");
  assert.equal(resumeResult.cutoutVersionId, "50000000-0000-4000-8000-000000000001");
  assert.equal(resumeResult.maskVersionId, maskRow.version_id);

  // Mismatched pre-existing checksum fails closed without overwrite.
  const dbBad = stubDb({
    source: { version_id: SOURCE_VERSION, object_key: `t/${ORG}/image/${JOB}/v1.png`, mime: "image/png" },
    outputs: [{ ...maskRow, sha256: "0".repeat(64) }],
  });
  const badStorage = memoryStorage();
  badStorage.put(`t/${ORG}/image/${JOB}/v1.png`, source, "image/png");
  badStorage.put(`t/${ORG}/product_shoot/${JOB}/v1.png`, Buffer.from(maskBytes), "image/png");
  await assert.rejects(
    executeSegmentJob({ db: dbBad, storage: badStorage, jobId: JOB, worker: WORKER }),
    /segment_mask_checksum_mismatch/,
  );
  assert.equal(dbBad.log.registers.length, 0);
  assert.equal(dbBad.log.completes.length, 0);
});

test("forged bridge reports fail mask integrity", async () => {
  const source = await productFixture();
  const storage = memoryStorage();
  storage.put(`t/${ORG}/image/${JOB}/v1.png`, source, "image/png");
  const db = stubDb({
    input: segmentInput({ engine: "birefnet" }),
    source: { version_id: SOURCE_VERSION, object_key: `t/${ORG}/image/${JOB}/v1.png`, mime: "image/png" },
  });
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { writeFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const deployDir = mkdtempSync(join(tmpdir(), "seg-forge-"));
  writeFileSync(join(deployDir, "w.bin"), Buffer.from("weights-bytes"));
  writeFileSync(join(deployDir, "m.py"), Buffer.from("# code"));
  const manifest = {
    code_revision: "rev-1",
    files: { "m.py": createHash("sha256").update("# code").digest("hex") },
    weights_sha256: createHash("sha256").update("weights-bytes").digest("hex"),
    weights_bytes: 13,
  };
  const forgedBridge = async ({ outputMaskPath }) => {
    const { maskPng } = await segmentLocalDeterministic({ bytes: source, refine: {} });
    writeFileSync(outputMaskPath, maskPng);
    return { maskSha256: "f".repeat(64), width: 256, height: 256, inferMs: 1, device: "cpu" };
  };
  await assert.rejects(
    executeSegmentJob({
      db, storage, jobId: JOB, worker: WORKER,
      birefnet: {
        pythonBin: "python", bridgeScript: "b.py", codeDir: deployDir, weightsPath: join(deployDir, "w.bin"),
        manifest, size: 512, device: "cpu",
      },
      runBridge: forgedBridge,
    }),
    /segment_mask_integrity/,
  );
  assert.equal(db.log.fails[0][2], "deterministic");
  assert.equal(db.log.completes.length, 0);
  await import("node:fs/promises").then((fs) => fs.rm(deployDir, { recursive: true, force: true }));
});

test("segment claim helper uses the filtered claim", async () => {
  const empty = { query: async () => ({ rows: [] }) };
  assert.equal(await claimSegmentRenderJob(empty, { worker: WORKER }), null);
  const calls = [];
  const own = {
    query: async (text, params) => {
      calls.push([text, params]);
      assert.match(text, /claim_creative_segment_job/);
      return { rows: [{ job_id: JOB, capability: "product_shoot" }] };
    },
  };
  const claimed = await claimSegmentRenderJob(own, { worker: WORKER });
  assert.equal(claimed.jobId, JOB);
  assert.deepEqual(calls[0][1], [WORKER, 120]);
  assert.equal(buildSegmentKey({ organizationId: ORG, jobId: JOB, version: 1 }), `t/${ORG}/product_shoot/${JOB}/v1.png`);
  assert.throws(() => buildSegmentKey({ organizationId: ORG, jobId: JOB, version: 0 }), /segment_key_shape/);
});
