import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Packet G step retry replaces failed steps without mutating terminal tasks", async () => {
  const configure = await read("deployment/dashboard-demo/sql/configure-api-role.sql");
  const sql = await read("packages/database/migrations/0053_workspace_step_retry.up.sql");
  const down = await read("packages/database/migrations/0053_workspace_step_retry.down.sql");

  // Fresh installs must not overwrite the immutable 0053 contract.
  assert.doesNotMatch(configure, /CREATE OR REPLACE FUNCTION tanaghom\.complete_agency_workspace_task/);
  // The claim function is repeated only to widen the lease to 300 seconds; it
  // must carry the same 0053 claim body otherwise.
  assert.match(configure, /CREATE OR REPLACE FUNCTION tanaghom\.claim_agency_workspace_task_for_models/);
  assert.match(configure, /lease_expires_at=now\(\)\+interval '300 seconds'/);
  assert.match(configure, /a\.status='queued' AND a\.attempt=0 AND x\.status IN \('queued','running'\)/);
  assert.doesNotMatch(configure, /CREATE OR REPLACE FUNCTION tanaghom\.claim_agency_workspace_task\(\)/);
  assert.doesNotMatch(configure, /CREATE OR REPLACE FUNCTION tanaghom\.decide_agency_workspace/);
  assert.match(configure, /CREATE OR REPLACE FUNCTION tanaghom\.set_agency_workspace_circuit_breaker/);
  assert.match(configure, /GRANT EXECUTE ON FUNCTION tanaghom\.set_agency_workspace_circuit_breaker\(boolean,boolean,text\) TO tanaghom_api/);

  assert.match(sql, /<> 49/);
  assert.match(sql, /0052_security_hardening/);
  assert.match(sql, /CREATE FUNCTION tanaghom\.guard_agency_workspace_step/);
  assert.match(sql, /current_setting\('tanaghom\.allowing_workspace_step_retry',true\) IS DISTINCT FROM 'on'/);
  assert.match(sql, /id=OLD\.task_id AND status='failed'/);
  assert.match(sql, /NEW\.task_id IS NOT DISTINCT FROM OLD\.task_id/);
  assert.match(sql, /status='queued' AND correlation_id=OLD\.workspace_id/);
  assert.match(sql, /'workspace:'\|\|w\.id::text\|\|':'\|\|v_step\.sequence\|\|':retry:'\|\|v_step\.old_id::text/);
  assert.match(sql, /set_config\('tanaghom\.allowing_workspace_step_retry','on',true\)/);
  assert.match(sql, /set_config\('tanaghom\.allowing_workspace_step_retry','',true\)/);
  assert.match(sql, /'retried_tasks',v_retried/);
  assert.match(sql, /v_retry_count>=3/);
  assert.match(sql, /x\.started_at>now\(\)-interval '24 hours'/);
  assert.match(sql, /event_type='resumed' AND e\.occurred_at>now\(\)-interval '24 hours'/);
  assert.doesNotMatch(sql, /UPDATE tanaghom\.agency_pilot_tasks SET status='queued'/);
  assert.doesNotMatch(sql, /emergency_stop\s*=\s*true/);
  assert.match(down, /CREATE TRIGGER workspace_steps_immutable BEFORE UPDATE OR DELETE/);
  assert.match(down, /prevent_audit_mutation/);
  assert.match(down, /DELETE FROM public\.schema_migrations WHERE version='0053_workspace_step_retry'/);
});

test("Packet D1 enforces sandbox and paid monthly quotas under one advisory lock", async () => {
  const quota = await read("apps/dashboard/lib/server/workspace-quotas.ts");
  const workspace = await read("apps/dashboard/lib/server/agency-workspace.ts");
  const ui = await read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(quota, /starter: 15/);
  assert.match(quota, /growth: 50/);
  assert.match(quota, /scale: 200/);
  assert.match(quota, /SANDBOX_CAMPAIGN_LIMIT = 1/);
  assert.match(quota, /SANDBOX_RUN_LIMIT = 3/);
  assert.match(quota, /workspace\.status IN \('queued', 'running', 'in_progress', 'waiting_review', 'approved'\)/);
  assert.match(quota, /workspace\.status = 'failed' AND EXISTS/);
  assert.match(quota, /event_type IN \('started', 'resumed'\)/);
  assert.match(quota, /started_at >= date_trunc\('month', now\(\)\)/);
  assert.match(quota, /subscription_required_for_more_campaigns/);
  assert.match(quota, /plan_monthly_campaign_limit_reached/);
  assert.match(quota, /WorkspaceQuotaError\("subscription_required_for_more_campaigns", 402\)/);
  assert.match(quota, /WorkspaceQuotaError\("plan_monthly_campaign_limit_reached", 409\)/);
  assert.match(workspace, /pg_advisory_xact_lock\(hashtextextended\(\$1,0\)\)/);
  assert.match(workspace, /workspace-install:\$\{actor\.organizationId\}/);
  assert.match(workspace, /requireWorkspaceQuota\(client,actor\.organizationId,id\)/);
  assert.match(workspace, /body\.action==="retry"/);
  assert.match(workspace, /decide_agency_workspace\(\$1,\$2,\$3,\$4,\$5\).*"retry"/);
  assert.match(workspace, /workspace\.inference_succeeded/);
  assert.match(workspace, /workspace\.inference_failed/);
  assert.match(workspace, /actor\.id AS actor_user_id/);
  assert.match(workspace, /JOIN tanaghom\.app_users actor/);
  assert.match(ui, /Free Sandbox:.*campaign.*AI runs used/);
  assert.match(ui, /monthly campaigns used/);
  assert.match(ui, /Retry failed step/);
  assert.match(ui, /إعادة محاولة الخطوة المتوقفة/);
  assert.match(ui, /upgrade_url/);
  assert.match(ui, /Upgrade plan/);
});

test("Packet D1 paywalls live social channels for every non-active tenant", async () => {
  const list = await read("apps/dashboard/app/api/settings/channels/route.ts");
  const connect = await read("apps/dashboard/app/api/settings/channels/connect/route.ts");
  const ui = await read("apps/dashboard/components/channels-settings.tsx");
  assert.match(list, /subscription_status/);
  assert.match(list, /can_connect_live_channels/);
  assert.match(list, /subscriptionStatus === "active"/);
  assert.match(connect, /SELECT status FROM tanaghom\.organizations WHERE id = \$1::uuid/);
  assert.match(connect, /subscription_required_for_channels/);
  assert.match(connect, /upgrade_url: "\/settings\/billing"/);
  assert.match(connect, /status: 402/);
  assert.match(ui, /can_connect_live_channels/);
  assert.match(ui, /Free Sandbox: 1 full AI Campaign Work Pack/);
  assert.match(ui, /Connecting live social accounts is unlocked on any paid plan/);
  assert.match(ui, /href="\/settings\/billing"/);
  assert.match(ui, /channel-paywall/);
});

test("Packet D1 surfaces approved AI work packs in campaigns and content", async () => {
  const operations = await read("apps/dashboard/app/api/operations/route.ts");
  const content = await read("apps/dashboard/app/api/content/route.ts");
  const campaignUi = await read("apps/dashboard/components/campaigns-view.tsx");
  const contentUi = await read("apps/dashboard/components/content-library.tsx");
  assert.match(operations, /workspace\.status='approved'/);
  assert.match(operations, /source: "ai_workspace"/);
  assert.match(operations, /campaigns: campaignRows/);
  assert.match(content, /workspace\.status='approved'/);
  assert.match(content, /'work_pack'::text AS content_type/);
  assert.match(content, /items,/);
  assert.match(campaignUi, /campaign\.source === "ai_workspace"/);
  assert.match(campaignUi, /Open work pack/);
  assert.match(contentUi, /item\.content_type !== "work_pack"/);
});