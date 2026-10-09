// Bounded CPU design/carousel render runner (P2b). Claims at most one
// queued design|carousel job per invocation and executes it through the
// Creative Runtime worker — pinned render input, offline Chromium capture
// with active network blocking, PNG validation, private local-filesystem
// storage, versioned asset persistence, and controlled job completion.
//
// Operable, not a daemon: no loops, no retries inside this process.
// Requires DATABASE_URL and CREATIVE_UPLOAD_DIR. Exit codes: 0 executed,
// 2 no design|carousel job available, 1 failure.
import pg from "pg";

import { capturePng } from "../packages/creative-runtime/render/chromium.mjs";
import { claimDesignRenderJob, executeDesignRenderJob } from "../packages/creative-runtime/render/worker.mjs";
import { createLocalFsStorage } from "../packages/creative-runtime/storage/local-fs.mjs";

const argv = process.argv.slice(2);
const args = new Map();
for (let index = 0; index < argv.length; index += 1) {
  const match = /^--([^=]+)(?:=(.*))?$/.exec(argv[index]);
  if (!match) continue;
  if (match[2] !== undefined) {
    args.set(match[1], match[2]);
  } else if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
    args.set(match[1], argv[index + 1]);
    index += 1;
  } else {
    args.set(match[1], "true");
  }
}
const worker = args.get("worker") ?? `design-worker-${process.pid}`;
const uploadDir = process.env.CREATIVE_UPLOAD_DIR;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!uploadDir) throw new Error("CREATIVE_UPLOAD_DIR is required");

const { chromium } = await import("@playwright/test");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  const claimed = await claimDesignRenderJob(pool, { worker });
  if (!claimed) {
    console.log(JSON.stringify({ result: "idle", reason: "no_design_job", worker }));
    process.exit(2);
  }
  const storage = createLocalFsStorage({ dir: uploadDir });
  const network = { attempted: 0, blocked: 0 };
  const result = await executeDesignRenderJob({
    db: pool,
    storage,
    capture: async ({ html, width, height, pageId, pageIndex }) => {
      const shot = await capturePng({ chromium, html, width, height });
      network.attempted += shot.attemptedExternal;
      network.blocked += shot.blockedExternal;
      return { ...shot, pageId, pageIndex };
    },
    jobId: claimed.jobId,
    worker,
  });
  console.log(JSON.stringify({
    result: "executed",
    worker,
    job_id: result.jobId,
    capability: result.capability,
    correlation_id: result.correlationId,
    asset_id: result.assetId,
    slides: result.slides.map((slide) => ({
      page_id: slide.pageId, page_index: slide.pageIndex, version_id: slide.versionId,
      object_key: slide.objectKey, sha256: slide.sha256, bytes: slide.bytes,
    })),
    network,
  }));
} finally {
  await pool.end();
}
