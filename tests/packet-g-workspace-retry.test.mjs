import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("0053 replaces failed step bindings without mutating terminal pilot tasks", async () => {
  const up = await read("packages/database/migrations/0053_workspace_step_retry.up.sql");
  const down = await read("packages/database/migrations/0053_workspace_step_retry.down.sql");

  assert.match(up, /count\(\*\) FROM public\.schema_migrations\) <> 49/);
  assert.match(up, /0052_security_hardening/);
  assert.match(up, /CREATE FUNCTION tanaghom\.guard_agency_workspace_step/);
  assert.match(up, /SET search_path=pg_catalog,pg_temp/);
  assert.match(up, /current_setting\('tanaghom\.allowing_workspace_step_retry',true\) IS DISTINCT FROM 'on'/);
  assert.match(up, /status='failed'.*status='queued'/s);
  assert.match(up, /correlation_id=OLD\.workspace_id/);
  assert.match(up, /INSERT INTO tanaghom\.agency_pilot_tasks/);
  assert.match(up, /'workspace:'\|\|w\.id::text/);
  assert.match(up, /':retry:'\|\|v_step\.old_id/);
  assert.match(up, /'retried_from_task',v_step\.old_id/);
  assert.match(up, /set_config\('tanaghom\.allowing_workspace_step_retry','on',true\)/);
  assert.match(up, /set_config\('tanaghom\.allowing_workspace_step_retry','',true\)/);
  assert.match(up, /UPDATE tanaghom\.agency_workspace_steps SET task_id=v_new/);
  assert.match(up, /v_retry_count>=3/);
  assert.match(up, /event_type='resumed' AND e\.occurred_at>now\(\)-interval '24 hours'/);
  assert.match(up, /'retried_tasks',v_retried/);
  assert.doesNotMatch(up, /UPDATE tanaghom\.agency_pilot_tasks SET status='queued'/);
  assert.doesNotMatch(up, /emergency_stop\s*=\s*true/);

  assert.match(down, /0053 down refuses retained step-retry evidence/);
  assert.match(down, /CREATE TRIGGER workspace_steps_immutable BEFORE UPDATE OR DELETE/);
  assert.match(down, /prevent_audit_mutation/);
  assert.match(down, /DELETE FROM public\.schema_migrations WHERE version='0053_workspace_step_retry'/);
});

test("fresh-install role configuration delegates workspace functions to 0053", async () => {
  const configure = await read("deployment/dashboard-demo/sql/configure-api-role.sql");
  for (const name of [
    "complete_agency_workspace_task",
    "claim_agency_workspace_task_for_models",
    "claim_agency_workspace_task",
    "decide_agency_workspace",
  ]) {
    assert.doesNotMatch(configure, new RegExp(`CREATE OR REPLACE FUNCTION tanaghom\\.${name}`));
  }
  assert.match(configure, /<> 50/);
  assert.match(configure, /0053_workspace_step_retry/);
  assert.match(configure, /set_agency_workspace_circuit_breaker/);
});

test("Gemini workspace calls use the 130s deadline and map stopped retries to 409", async () => {
  const server = await read("apps/dashboard/lib/server/agency-workspace.ts");
  const manifest = JSON.parse(await read("config/agency-workspace.v1.json"));
  const { mapWorkspaceStateError } = await import("../apps/dashboard/lib/server/workspace-state-error.ts");

  assert.equal(manifest.timeout_ms, 90_000);
  assert.match(server, /createGeminiWorkspaceClient\(\{apiKey,timeoutMs:130_000\}\)/);
  assert.doesNotMatch(server, /createGeminiWorkspaceClient\(\{apiKey,timeoutMs:workspaceManifest\.timeout_ms\}\)/);
  assert.match(server, /mapWorkspaceStateError\(error\)/);
  assert.match(server, /throw workspaceStateError\(error\)\?\?error/g);

  assert.deepEqual(mapWorkspaceStateError(new Error("workspace runtime stopped")), {
    code: "workspace_runtime_stopped",
    status: 409,
  });
  assert.deepEqual(mapWorkspaceStateError(new Error("workspace not failed")), {
    code: "workspace_not_retryable",
    status: 409,
  });
  assert.deepEqual(mapWorkspaceStateError(new Error("workspace has no failed steps")), {
    code: "workspace_not_retryable",
    status: 409,
  });
  assert.deepEqual(mapWorkspaceStateError(new Error("workspace not paused")), {
    code: "workspace_action_invalid",
    status: 409,
  });
  assert.equal(mapWorkspaceStateError(new Error("connection reset")), null);
});

test("workspace retry errors have natural English and White-Arabic copy", async () => {
  const ui = await read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(ui, /workspace_runtime_stopped: "AI generation is paused by the platform\./);
  assert.match(ui, /workspace_runtime_stopped: "توليد المحتوى متوقف مؤقتًا من المنصة\./);
  assert.match(ui, /Your completed work is preserved; retry when generation resumes\./);
  assert.match(ui, /عملك المكتمل محفوظ؛ يمكنك إعادة المحاولة بعد استئناف التوليد\./);
});
