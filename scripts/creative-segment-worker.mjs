// Bounded CPU segmentation runner (P2a follow-up). Claims at most one
// queued product_shoot/cpu/segment job per invocation and executes it
// through the Creative Runtime segment worker — pinned input,
// tenant-checked source, local or BiRefNet engine, validated mask +
// cutout, private storage, versioned lineage, controlled completion.
//
// Operable, not a daemon: no loops, no retries inside this process.
// Requires DATABASE_URL and CREATIVE_UPLOAD_DIR. BiRefNet needs
// ML_SEGMENTATION_BIREFNET_* env (deployment-provisioned). Exit codes:
// 0 executed, 2 no segment job available, 1 failure.
import pg from "pg";
import { fileURLToPath } from "node:url";

import { claimSegmentRenderJob, executeSegmentJob } from "../packages/creative-runtime/render/segment-worker.mjs";
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
const worker = args.get("worker") ?? `segment-worker-${process.pid}`;
const uploadDir = process.env.CREATIVE_UPLOAD_DIR;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!uploadDir) throw new Error("CREATIVE_UPLOAD_DIR is required");

const birefnet = process.env.ML_SEGMENTATION_BIREFNET_WEIGHTS
  ? {
    pythonBin: process.env.ML_SEGMENTATION_PYTHON ?? "python",
    bridgeScript: fileURLToPath(new URL("../packages/creative-runtime/adapters/birefnet_bridge.py", import.meta.url)),
    codeDir: process.env.ML_SEGMENTATION_BIREFNET_CODE_DIR ?? "",
    weightsPath: process.env.ML_SEGMENTATION_BIREFNET_WEIGHTS,
    size: 1024,
    device: process.env.ML_SEGMENTATION_DEVICE ?? "cpu",
    timeoutMs: 600000,
    model: "BiRefNet",
    weightsRef: process.env.ML_SEGMENTATION_BIREFNET_REVISION ?? null,
  }
  : null;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  const claimed = await claimSegmentRenderJob(pool, { worker });
  if (!claimed) {
    console.log(JSON.stringify({ result: "idle", reason: "no_segment_job", worker }));
    process.exit(2);
  }
  const storage = createLocalFsStorage({ dir: uploadDir });
  const result = await executeSegmentJob({
    db: pool, storage, jobId: claimed.jobId, worker, birefnet,
  });
  console.log(JSON.stringify({
    result: "executed",
    worker,
    job_id: result.jobId,
    asset_id: result.assetId,
    mask_version_id: result.maskVersionId,
    cutout_version_id: result.cutoutVersionId,
    output: result.output,
  }));
} finally {
  await pool.end();
}
