import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { capturePng } from "../packages/creative-runtime/render/chromium.mjs";
import {
  DESIGN_RENDER_MIME,
  assertPngBytes,
  claimDesignRenderJob,
  executeDesignRenderJob,
} from "../packages/creative-runtime/render/worker.mjs";
import { createLocalFsStorage } from "../packages/creative-runtime/storage/local-fs.mjs";
import { createTestStorage } from "../packages/creative-runtime/storage/test-adapter.mjs";

const ORG = "10000000-0000-4000-8000-000000000001";
const JOB = "20000000-0000-4000-8000-000000000001";
const TPL = "30000000-0000-4000-8000-000000000001";
const CORR = "40000000-0000-4000-8000-000000000001";
const WORKER = "worker-design-test";

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

function adDoc() {
  return {
    kind: "ad", locale: "ar", direction: "rtl",
    canvas: { width: 1080, height: 1080 }, background: { color: "#ffffff" },
    nodes: [{ id: "h1", type: "text", role: "headline", x: 90, y: 120, width: 900, height: 220, text: "عنوان", font_size: 96, font_weight: 800, align: "start", color: "#111111" }],
  };
}

function carouselDoc() {
  return {
    kind: "carousel", locale: "ar", direction: "rtl",
    canvas: { width: 1080, height: 1080 }, background: { color: "#ffffff" },
    pages: ["cover", "body", "end"].map((kind, index) => ({
      id: `slide-${index + 1}`, kind,
      nodes: [{ id: `slide-${index + 1}-h`, type: "text", role: "headline", x: 90, y: 120, width: 900, height: 200, text: `شريحة ${index + 1}`, font_size: 72, font_weight: 700, align: "start", color: "#111111" }],
    })),
  };
}

function inputFor(doc, capability) {
  return {
    job_id: JOB, organization_id: ORG, capability, lane: "cpu",
    correlation_id: CORR, attempt: 1, max_attempts: 3,
    params: { format: "1:1", design_template_id: TPL, design_version: 1 },
    template: { id: TPL, kind: capability, name: "Test Design", version: 1, is_active: true, spec: doc },
    brand_kit_version: null,
  };
}

function stubDb({ input, priorVersions = 0, sourceRows = [], calls = null }) {
  const log = calls ?? { marks: [], registers: [], completes: [], fails: [] };
  return {
    log,
    async query(text, params) {
      if (text.includes("mark_creative_job_running")) {
        log.marks.push(params);
        return { rows: [{ status: "running" }] };
      }
      if (text.includes("creative_asset_versions WHERE job_id")) {
        return { rows: [{ n: priorVersions }] };
      }
      if (text.includes("get_creative_render_input")) {
        return { rows: [{ input }] };
      }
      if (text.includes("FROM tanaghom.creative_asset_versions version")) {
        return { rows: sourceRows };
      }
      if (text.includes("create_creative_asset_version")) {
        log.registers.push(params);
        return { rows: [{ asset_version_id: `50000000-0000-4000-8000-00000000000${log.registers.length}` }] };
      }
      if (text.includes("FROM tanaghom.creative_asset_versions WHERE id")) {
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

function fakeChromium({ screenshotBytes, seen = {} }) {
  return {
    seen,
    launch: async () => {
      const handlers = [];
      const context = {
        route: async (pattern, handler) => {
          handlers.push(handler);
          seen.routePattern = pattern;
        },
        newPage: async () => ({
          setContent: async (html) => {
            seen.html = html;
            const urls = [...html.matchAll(/https?:\/\/[^\s"'<>]+/g)];
            for (const _url of urls) {
              seen.externalAttempts = (seen.externalAttempts ?? 0) + 1;
              await handlers[0]({ abort: async () => { seen.blocked = (seen.blocked ?? 0) + 1; } });
            }
          },
          screenshot: async () => screenshotBytes,
        }),
        close: async () => {},
      };
      return {
        newContext: async (opts) => {
          seen.contextOpts = opts;
          return context;
        },
        close: async () => { seen.browserClosed = true; },
      };
    },
  };
}

test("PNG output validator enforces magic and canvas dimensions", () => {
  const good = assertPngBytes(pngBytes(1080, 1080), { width: 1080, height: 1080 });
  assert.equal(good.width, 1080);
  assert.match(good.sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => assertPngBytes(Buffer.from("not-a-png-at-all-padded-to-33bytes!!"), { width: 1080, height: 1080 }), /render_output_not_png/);
  assert.throws(() => assertPngBytes(pngBytes(1080, 1350), { width: 1080, height: 1080 }), /render_output_dimensions:1080x1350/);
  assert.throws(() => assertPngBytes(Buffer.alloc(10), { width: 1080, height: 1080 }), /render_output_empty/);
});

test("offline capture disables scripts, sizes viewport, and aborts routable requests", async () => {
  const seen = {};
  const fake = fakeChromium({ screenshotBytes: pngBytes(1080, 1080), seen });
  const clean = await capturePng({ chromium: fake, html: "<html><body>clean</body></html>", width: 1080, height: 1080 });
  assert.equal(clean.attemptedExternal, 0);
  assert.equal(clean.blockedExternal, 0);
  assert.equal(seen.routePattern, "**/*");
  assert.equal(seen.contextOpts.javaScriptEnabled, false);
  assert.deepEqual(seen.contextOpts.viewport, { width: 1080, height: 1080 });
  assert.equal(seen.browserClosed, true);

  const seenEvil = {};
  const fakeEvil = fakeChromium({ screenshotBytes: pngBytes(1080, 1080), seen: seenEvil });
  const evil = await capturePng({
    chromium: fakeEvil,
    html: '<html><body><img src="https://evil.example.test/pixel.png" /></body></html>',
    width: 1080, height: 1080,
  });
  assert.equal(evil.attemptedExternal, 1);
  assert.equal(evil.blockedExternal, 1);
  assert.ok(evil.bytes.length > 0);
});

test("worker executes an ad job to one persisted version and completes", async () => {
  const db = stubDb({ input: inputFor(adDoc(), "design") });
  const storage = memoryStorage();
  const captures = [];
  const result = await executeDesignRenderJob({
    db, storage,
    capture: async ({ html, width, height, pageId, pageIndex }) => {
      captures.push({ html, width, height, pageId, pageIndex });
      assert.doesNotMatch(html, /https?:\/\//);
      return { bytes: pngBytes(1080, 1080), attemptedExternal: 0, blockedExternal: 0 };
    },
    jobId: JOB, worker: WORKER,
  });
  assert.deepEqual(db.log.marks, [[JOB, WORKER]]);
  assert.equal(db.log.registers.length, 1);
  const [jobId, worker, assetId, title, mime, width, height, , bytes, sha256, objectKey, , provenance, , templateRef, method] = db.log.registers[0];
  assert.equal(jobId, JOB);
  assert.equal(assetId, null);
  assert.equal(mime, DESIGN_RENDER_MIME);
  assert.equal(width, 1080);
  assert.equal(height, 1080);
  assert.match(objectKey, new RegExp(`^t/${ORG}/design/${JOB}/v1\\.png$`));
  assert.equal(provenance.page_index, 0);
  assert.equal(provenance.page_count, 1);
  assert.equal(provenance.design_version, 1);
  assert.equal(provenance.correlation_id, CORR);
  assert.match(provenance.font_sha256, /^[0-9a-f]{64}$/);
  assert.equal(templateRef, "Test Design");
  assert.equal(method, "render");
  assert.deepEqual(db.log.completes, [[JOB, WORKER, "50000000-0000-4000-8000-000000000001", null]]);
  assert.equal(result.slides.length, 1);
  assert.equal(result.versionIds.length, 1);
  assert.equal(storage.get(objectKey).bytes.length, bytes);
  assert.equal(sha256, result.slides[0].sha256);
  assert.match(title, /slide 1\/1/);
});

test("worker persists carousel slides as ordered versions of one lineage", async () => {
  const db = stubDb({ input: inputFor(carouselDoc(), "carousel") });
  const storage = memoryStorage();
  const result = await executeDesignRenderJob({
    db, storage,
    capture: async () => ({ bytes: pngBytes(1080, 1080), attemptedExternal: 0, blockedExternal: 0 }),
    jobId: JOB, worker: WORKER,
  });
  assert.equal(db.log.registers.length, 3);
  assert.equal(db.log.registers[0][2], null);
  assert.equal(db.log.registers[1][2], "60000000-0000-4000-8000-000000000001");
  assert.equal(db.log.registers[2][2], "60000000-0000-4000-8000-000000000001");
  const indexes = db.log.registers.map((params) => params[12].page_index);
  assert.deepEqual(indexes, [0, 1, 2]);
  for (const params of db.log.registers) {
    assert.equal(params[12].correlation_id, CORR);
    assert.equal(params[12].job_id, JOB);
    assert.equal(params[12].page_count, 3);
  }
  assert.deepEqual(db.log.completes, [[JOB, WORKER, "50000000-0000-4000-8000-000000000003", null]]);
  assert.equal(result.slides.length, 3);
  assert.deepEqual(result.slides.map((slide) => slide.pageId), ["slide-1", "slide-2", "slide-3"]);
});

test("worker fails closed on bad documents, foreign capabilities, and network attempts", async () => {
  const badDoc = { ...adDoc(), nodes: [] };
  const dbBad = stubDb({ input: inputFor(badDoc, "design") });
  await assert.rejects(
    executeDesignRenderJob({
      db: dbBad, storage: memoryStorage(),
      capture: async () => { throw new Error("capture must not run"); },
      jobId: JOB, worker: WORKER,
    }),
    /render_document_invalid/,
  );
  assert.equal(dbBad.log.fails[0][2], "deterministic");

  const dbForeign = stubDb({ input: inputFor(adDoc(), "image") });
  await assert.rejects(
    executeDesignRenderJob({
      db: dbForeign, storage: memoryStorage(),
      capture: async () => ({ bytes: pngBytes(1080, 1080), attemptedExternal: 0, blockedExternal: 0 }),
      jobId: JOB, worker: WORKER,
    }),
    /render_capability_unsupported/,
  );

  const dbNet = stubDb({ input: inputFor(adDoc(), "design") });
  await assert.rejects(
    executeDesignRenderJob({
      db: dbNet, storage: memoryStorage(),
      capture: async () => ({ bytes: pngBytes(1080, 1080), attemptedExternal: 2, blockedExternal: 2 }),
      jobId: JOB, worker: WORKER,
    }),
    /render_external_network_attempted/,
  );
  assert.equal(dbNet.log.fails[0][2], "deterministic");

  const dbDup = stubDb({ input: inputFor(adDoc(), "design"), priorVersions: 1 });
  await assert.rejects(
    executeDesignRenderJob({
      db: dbDup, storage: memoryStorage(),
      capture: async () => { throw new Error("capture must not run"); },
      jobId: JOB, worker: WORKER,
    }),
    /render_duplicate_execution/,
  );
});

test("claim helper passes through empty queues and skips foreign capabilities", async () => {
  const empty = { query: async () => ({ rows: [] }) };
  assert.equal(await claimDesignRenderJob(empty, { worker: WORKER }), null);
  const foreign = { query: async () => ({ rows: [{ job_id: JOB, capability: "image" }] }) };
  const skipped = await claimDesignRenderJob(foreign, { worker: WORKER });
  assert.equal(skipped.skipped, true);
  const own = { query: async () => ({ rows: [{ job_id: JOB, capability: "carousel" }] }) };
  const claimed = await claimDesignRenderJob(own, { worker: WORKER });
  assert.equal(claimed.skipped, false);
  assert.equal(claimed.jobId, JOB);
});

test("local filesystem storage round-trips with exclusive create", async () => {
  const dir = mkdtempSync(join(tmpdir(), "design-storage-test-"));
  try {
    const storage = createLocalFsStorage({ dir });
    const key = `t/${ORG}/design/${JOB}/v1.png`;
    const bytes = pngBytes(1080, 1080);
    const written = await storage.put(key, bytes, "image/png");
    assert.equal(written.sha256, assertPngBytes(bytes, { width: 1080, height: 1080 }).sha256);
    assert.deepEqual((await storage.get(key)).bytes, bytes);
    await assert.rejects(storage.put(key, bytes, "image/png"), /object_key_exists/);
    await assert.rejects(storage.put("../escape.png", bytes, "image/png"), /object_key_shape_violation/);
    await assert.rejects(storage.put(key.replace(".png", ".jpg"), bytes, "image/png"), /mime_extension_mismatch/);
    assert.equal(await storage.get(key.replace("v1.png", "v9.png")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
