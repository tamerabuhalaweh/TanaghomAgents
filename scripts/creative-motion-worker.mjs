// Bounded CPU motion render runner (P3). Claims at most one queued
// capability=motion job per invocation and executes it through the
// Creative Runtime motion worker — pinned motion+design input, offline
// Chromium frames with active network blocking, fixed-argv FFmpeg MP4
// encode, pure-JS MP4 validation, private local-filesystem storage, and
// controlled job completion.
//
// Operable, not a daemon: no loops, no retries inside this process.
// Requires DATABASE_URL, CREATIVE_UPLOAD_DIR, and a deployment-provided
// ffmpeg (FFMPEG_PATH or PATH). Exit codes: 0 executed,
// 2 no motion job available, 1 failure.
import pg from "pg";

import { capturePng } from "../packages/creative-runtime/render/chromium.mjs";
import { claimMotionRenderJob, executeMotionRenderJob } from "../packages/creative-runtime/render/motion-worker.mjs";
import { beginMp4Encode } from "../packages/creative-runtime/render/mp4.mjs";
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
const worker = args.get("worker") ?? `motion-worker-${process.pid}`;
const uploadDir = process.env.CREATIVE_UPLOAD_DIR;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!uploadDir) throw new Error("CREATIVE_UPLOAD_DIR is required");

const { chromium } = await import("@playwright/test");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  const claimed = await claimMotionRenderJob(pool, { worker });
  if (!claimed) {
    console.log(JSON.stringify({ result: "idle", reason: "no_motion_job", worker }));
    process.exit(2);
  }
  const storage = createLocalFsStorage({ dir: uploadDir });
  const network = { attempted: 0, blocked: 0 };
  const result = await executeMotionRenderJob({
    db: pool,
    storage,
    capture: async ({ html, width, height, pageIndex, timeoutMs }) => {
      const shot = await capturePng({ chromium, html, width, height, timeoutMs });
      network.attempted += shot.attemptedExternal;
      network.blocked += shot.blockedExternal;
      return { ...shot, pageIndex };
    },
    createEncoder: async (params) => beginMp4Encode(params),
    jobId: claimed.jobId,
    worker,
  });
  console.log(JSON.stringify({
    result: "executed",
    worker,
    job_id: result.jobId,
    capability: result.capability,
    correlation_id: result.correlationId,
    version_id: result.versionId,
    output: result.output,
    network,
  }));
} finally {
  await pool.end();
}
