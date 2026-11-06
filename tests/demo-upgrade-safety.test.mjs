import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('demo bootstrap refuses existing data before modifying secrets or services', async () => {
  const script = await readFile('deployment/dashboard-demo/scripts/deploy.sh', 'utf8');
  const guard = script.indexOf('EXISTING_DEMO_UPGRADE_BLOCKED');
  assert.ok(guard > 0);
  assert.ok(guard < script.indexOf('augment_workspace_secrets()'));
  assert.ok(guard < script.indexOf('"${compose[@]}" up -d'));
  assert.ok(script.indexOf('DOCKER_UNAVAILABLE') < guard);
  assert.match(script, /docker volume ls --format/);
  assert.match(script, /DEMO_VOLUME_DISCOVERY_FAILED/);
  assert.match(script, /grep -Fxq 'tanaghom-dashboard-demo-pgdata'/);
  assert.match(script, /grep -Fxq 'tanaghom-dashboard-demo-rustfsdata'/);
});

test('unreviewed demo rollback cannot remove containers or volumes', async () => {
  const script = await readFile('deployment/dashboard-demo/scripts/rollback.sh', 'utf8');
  assert.match(script, /ROLLBACK_BLOCKED/);
  assert.doesNotMatch(script, /\$\{compose\[@\]\}"\s+down/);
});

test('demo-only control transaction has explicit authorization, stops and audit', async () => {
  const sql = await readFile('deployment/dashboard-demo/sql/workspace-control.sql', 'utf8');
  assert.match(sql, /current_database\(\) <> 'tanaghom_demo'/);
  assert.match(sql, /APPROVED-ISOLATED-DEMO-CONTROL/);
  assert.match(sql, /agency_pilot_controls WHERE emergency_stop AND NOT model_execution_enabled/);
  assert.match(sql, /provider='postiz' AND emergency_stop/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('workspace-claim',0\)\)/);
  assert.match(sql, /demo_workspace_control_audit/);
  assert.match(sql, /change_id text NOT NULL UNIQUE/);
  assert.match(sql, /INSERT INTO tanaghom\.demo_workspace_control_audit/);
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
});
