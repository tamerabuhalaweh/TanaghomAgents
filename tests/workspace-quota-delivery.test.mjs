import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("campaign quota counts queued/running/review work and failed work with a delivered step", () => {
  const quota = read("apps/dashboard/lib/server/workspace-quotas.ts");
  assert.match(quota, /workspace\.status IN \('queued', 'running', 'in_progress', 'waiting_review', 'approved'\)/);
  assert.match(quota, /OR \(workspace\.status = 'failed' AND EXISTS \(/);
  assert.match(quota, /JOIN tanaghom\.agency_pilot_tasks task ON task\.id = step\.task_id/);
  assert.match(quota, /WHERE step\.workspace_id = workspace\.id AND task\.status = 'succeeded'/);
  assert.doesNotMatch(quota, /workspace\.status <> 'draft'/);
});

test("failed tasks with no result contribute no tokens", () => {
  const quota = read("apps/dashboard/lib/server/workspace-quotas.ts");
  assert.match(quota, /task\.result->'usage' IS NOT NULL/);
  assert.match(quota, /GREATEST\(0, \(task\.result->'usage'->>'total_tokens'\)::bigint\)/);
});

test("the retried workspace is excluded before the monthly and delivery filters", () => {
  const quota = read("apps/dashboard/lib/server/workspace-quotas.ts");
  assert.match(quota, /workspace\.id <> \$2::uuid\s+AND \(NOT \$3::boolean OR workspace\.started_at >= date_trunc\('month', now\(\)\)\)\s+AND \(/);
});
