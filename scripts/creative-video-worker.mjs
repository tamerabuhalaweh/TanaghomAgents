// Bounded GPU-video provider runner (P4). Claims at most one queued
// capability=video job per invocation and executes it through the
// Creative Runtime video worker — pinned input, provider task, bounded
// reconciliation, SSRF-safe download, MP4 validation, private storage,
// and controlled job completion.
//
// Operable, not a daemon: no loops, no retries inside this process.
// Requires DATABASE_URL, CREATIVE_UPLOAD_DIR, and (for live runs) a
// provider key via MINIMAX_API_KEY. Exit codes: 0 executed,
// 2 no video job available, 1 failure.
import pg from "pg";

import { createHttpVideoAdapter } from "../packages/creative-runtime/adapters/http-video.mjs";
import { downloadArtifact } from "../packages/creative-runtime/adapters/http-image.mjs";
import { claimVideoRenderJob, executeVideoJob } from "../packages/creative-runtime/render/video-worker.mjs";
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
const worker = args.get("worker") ?? `video-worker-${process.pid}`;
const uploadDir = process.env.CREATIVE_UPLOAD_DIR;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!uploadDir) throw new Error("CREATIVE_UPLOAD_DIR is required");
const apiKey = process.env.MINIMAX_API_KEY ?? null;
const endpoint = process.env.MINIMAX_VIDEO_ENDPOINT ?? "https://api.minimax.io/v2/video_generation";
const queryEndpoint = process.env.MINIMAX_VIDEO_QUERY_ENDPOINT ?? "https://api.minimax.io/v2/query/video_generation";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  if (!apiKey) {
    console.log(JSON.stringify({ result: "idle", reason: "no_provider_key", worker }));
    process.exit(2);
  }
  const claimed = await claimVideoRenderJob(pool, { worker });
  if (!claimed) {
    console.log(JSON.stringify({ result: "idle", reason: "no_video_job", worker }));
    process.exit(2);
  }
  const storage = createLocalFsStorage({ dir: uploadDir });
  const provider = createHttpVideoAdapter({
    name: "minimax-h3", endpoint, queryEndpoint, apiKey,
    model: "MiniMax-H3", adapterConfig: "creative.video-providers.v1",
  });
  const result = await executeVideoJob({
    db: pool,
    storage,
    provider: {
      ...provider,
      adapterConfig: "creative.video-providers.v1",
      maxBytes: 104857600,
      artifactOrigins: ["cdn.hailuoai.com", "video-product.cdn.minimax.io"],
    },
    download: (input) => downloadArtifact(input),
    jobId: claimed.jobId,
    worker,
  });
  console.log(JSON.stringify({
    result: "executed",
    worker,
    job_id: result.jobId,
    version_id: result.versionId,
    output: result.output,
    provider: result.provider,
  }));
} finally {
  await pool.end();
}
