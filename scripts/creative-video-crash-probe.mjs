// Crash probe for the video reconciliation anchor (P4 E2E only). Claims a
// video job, begins a provider attempt, creates a provider task, attaches
// the task_id, then DIES without polling — simulating a worker crash after
// create. The parent harness resumes the same job and must reconcile the
// SAME task_id without a second create.
//
// Usage: node scripts/creative-video-crash-probe.mjs <jobId> <worker> <fault>
// Requires DATABASE_URL + CREATIVE_VIDEO_PROVIDER_ORIGIN env.
import pg from "pg";

import { claimVideoJob, beginProviderCall, attachProviderRequest } from "../packages/creative-runtime/repository.mjs";
import { createHttpVideoAdapter } from "../packages/creative-runtime/adapters/http-video.mjs";

const [jobId, worker, fault] = process.argv.slice(2);
const providerOrigin = process.env.CREATIVE_VIDEO_PROVIDER_ORIGIN;
if (!jobId || !worker || !providerOrigin) throw new Error("jobId, worker, and CREATIVE_VIDEO_PROVIDER_ORIGIN are required");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const client = await pool.connect();
try {
  await client.query("SET ROLE tanaghom_creative_worker");  const claimed = await claimVideoJob(client, { worker, leaseSeconds: 120 });
  if (!claimed || (claimed.job_id ?? claimed.id) !== jobId) {
    throw new Error("crash probe could not claim the target job");
  }
  const callId = await beginProviderCall(client, {
    jobId, worker, provider: "stub-minimax", model: "MiniMax-H3", modelVersion: null,
    operation: "text_to_video", units: { seconds: 5, resolution: "768P" },
    estimatedCostUsd: 0.4, adapterConfig: "creative.video-providers.v1",
  });
  const adapter = createHttpVideoAdapter({
    name: "stub-minimax", endpoint: `${providerOrigin}/v2/video_generation/${fault}`,
    queryEndpoint: `${providerOrigin}/v2/query/video_generation`, apiKey: "stub-key",
    model: "MiniMax-H3", testLoopback: true,
  });
  const created = await adapter.createTask({
    operation: "text_to_video", prompt: "Crash probe clip", duration: 5,
    resolution: "768P", ratio: "16:9", imageUrl: null,
  });
  await attachProviderRequest(client, { callId, worker, requestId: created.taskId });
  console.log(JSON.stringify({ result: "anchored", job_id: jobId, task_id: created.taskId, call_id: callId }));
} finally {
  // Release the checked-out session before draining: pool.end() waits
  // for checked-out clients, which would hang the crash simulation.
  try {
    client.release();
  } catch {}
  await pool.end();
}
// Death without polling, finishing, or completing: the anchor must
// carry recovery on the next pass.
process.exit(1);
