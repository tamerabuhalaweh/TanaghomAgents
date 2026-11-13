import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('demo deploy upgrades existing data only after a verified backup', async () => {
  const script = await readFile('deployment/dashboard-demo/scripts/deploy.sh', 'utf8');
  assert.doesNotMatch(script, /EXISTING_DEMO_UPGRADE_BLOCKED/);
  assert.match(script, /existing_demo=true/);

  const backupRequired = script.indexOf('UPGRADE_BACKUP_REQUIRED');
  assert.ok(backupRequired > 0);
  // The snapshot is required before secret changes, image builds or downtime.
  assert.ok(backupRequired < script.indexOf('augment_workspace_secrets()'));
  assert.ok(backupRequired < script.indexOf('build dashboard'));
  assert.ok(backupRequired < script.indexOf('stop dashboard'));
  assert.match(script, /verify_backup "\$existing_backup"/);
  assert.match(script, /UPGRADE_BACKUP_VERIFIED/);
  assert.match(script, /verify_ledger_advanced/);
  assert.match(script, /verify_no_row_drift/);
  assert.match(script, /restore_verified_backup/);
  assert.match(script, /ROLLBACK_COMPLETE/);
  assert.match(script, /grep -Fxq 'tanaghom-dashboard-demo-pgdata'/);
  assert.match(script, /grep -Fxq 'tanaghom-dashboard-demo-rustfsdata'/);
});

test('the upgrade is not pinned to one migration pair and proves the chain', async () => {
  const script = await readFile('deployment/dashboard-demo/scripts/demo-upgrade.sh', 'utf8');
  assert.doesNotMatch(script, /0047_smartlabs_audio|0048_gemini_workspace_model|profile_present/);
  assert.match(script, /verify_ledger_advanced/);
  assert.match(script, /verify_no_row_drift/);
  assert.match(script, /migration_total/);
  assert.match(script, /restore_verified_backup/);
  assert.match(script, /ROLLBACK_RESTORED/);
});

test('compose validation accepts workspace-only and validates Caddy when enabled', async () => {
  const validator = await readFile('deployment/dashboard-demo/scripts/validate-compose.py', 'utf8');
  const validate = await readFile('deployment/dashboard-demo/scripts/validate.sh', 'utf8');
  assert.match(validator, /core = \{"postgres", "migrate", "auth", "storage", "storage-init", "dashboard", "workspace-worker"\}/);
  assert.match(validator, /core \| \{"caddy"\}/);
  assert.match(validator, /if "caddy" in services:/);
  assert.match(validator, /env\["APP_BASE_URL"\] == f"https:\/\/\{public_domain\}"/);
  assert.match(validator, /env\["APP_BASE_URL"\] == "http:\/\/127\.0\.0\.1:3210"/);
  // validate.sh only enables the workspace profile; the https profile is
  // optional until a public domain exists, so the core set must pass alone.
  assert.match(validate, /--profile workspace config --format json/);
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
  assert.match(sql, /automation_platform_controls WHERE provider='postiz'\)/);
  assert.match(sql, /agent_jobs WHERE status IN \('queued','running','waiting_approval'\)/);
  assert.match(sql, /postiz_draft_mode='automatic'/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('workspace-claim',0\)\)/);
  assert.match(sql, /demo_workspace_control_audit/);
  assert.match(sql, /change_id text NOT NULL UNIQUE/);
  assert.match(sql, /INSERT INTO tanaghom\.demo_workspace_control_audit/);
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
});
