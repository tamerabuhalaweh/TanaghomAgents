import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('demo bootstrap refuses existing data before modifying secrets or services', async () => {
  const script = await readFile('deployment/dashboard-demo/scripts/deploy.sh', 'utf8');
  const guard = script.indexOf('EXISTING_DEMO_UPGRADE_BLOCKED');
  assert.ok(guard > 0);
  assert.ok(guard < script.indexOf('augment_workspace_secrets()'));
  assert.ok(guard < script.indexOf('"${compose[@]}" up -d'));
  assert.match(script, /docker volume inspect tanaghom-dashboard-demo-pgdata/);
  assert.match(script, /docker volume inspect tanaghom-dashboard-demo-rustfsdata/);
});

test('unreviewed demo rollback cannot remove containers or volumes', async () => {
  const script = await readFile('deployment/dashboard-demo/scripts/rollback.sh', 'utf8');
  assert.match(script, /ROLLBACK_BLOCKED/);
  assert.doesNotMatch(script, /\$\{compose\[@\]\}"\s+down/);
});
