import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');

// The Phase 1 host keeps AGENCY_WORKSPACE_ENABLED=true in an untracked .env and
// runs the worker from the "workspace" compose profile. Every script that
// quiesces the stack must bring the worker back, or the host silently loses its
// model worker while the flag still reads true.
test('upgrade and restore restart the workspace worker when the host enables it', async () => {
  const lib = await read('deployment/dashboard-demo/scripts/demo-lifecycle-lib.sh');
  assert.match(lib, /workspace_enabled\(\)/);
  assert.match(lib, /COMPOSE_ENV_FILE/);
  assert.match(lib, /sed -n 's\/\^AGENCY_WORKSPACE_ENABLED=\/\/p'/);
  assert.match(lib, /start_workspace_worker\(\)/);
  assert.match(lib, /compose --profile workspace up -d workspace-worker/);
  assert.match(lib, /WORKSPACE_WORKER_STARTED enabled/);
  assert.match(lib, /WORKSPACE_WORKER_SKIPPED disabled/);

  for (const script of ['demo-upgrade.sh', 'demo-restore.sh']) {
    const body = await read(`deployment/dashboard-demo/scripts/${script}`);
    const start = body.indexOf('start_workspace_worker');
    assert.ok(start > 0, `${script} must restart the workspace worker`);
    assert.ok(
      start > body.indexOf('wait_healthy dashboard'),
      `${script} must restart the worker only after the dashboard is healthy`,
    );
    assert.ok(
      start < body.indexOf('_COMPLETE'),
      `${script} must restart the worker before reporting completion`,
    );
  }
});

test('every host script loads the untracked compose .env when it exists', async () => {
  for (const script of ['deploy.sh', 'workspace-control.sh']) {
    const body = await read(`deployment/dashboard-demo/scripts/${script}`);
    assert.match(body, /\[ -f "\$[A-Za-z_]+[^"]*" \] && compose\+=\{?\}?\(?--env-file/, `${script} must pass --env-file`);
  }
  const lib = await read('deployment/dashboard-demo/scripts/demo-lifecycle-lib.sh');
  assert.match(lib, /\[ -f "\$COMPOSE_ENV_FILE" \] && args\+=\{?\}?\(?--env-file/);
});

test('compose reads every Postiz switch from the host .env contract', async () => {
  const compose = await read('deployment/dashboard-demo/compose.yml');
  for (const name of [
    'AGENCY_WORKSPACE_ENABLED',
    'INTEGRATION_CREDENTIAL_KEY',
    'INTEGRATION_CREDENTIAL_KEY_VERSION',
    'POSTIZ_ALLOWED_BASE_URLS',
    'POSTIZ_AUTOMATION_RUNTIME_READY',
    'POSTIZ_HANDOFF_ENABLED',
    'POSTIZ_PERFORMANCE_SYNC_ENABLED',
  ]) {
    assert.match(compose, new RegExp(`${name}: \\$\\{${name}:-`), `${name} must not be hardcoded`);
  }
});

test('the tracked env templates document the full host contract without secrets', async () => {
  const template = await read('deployment/dashboard-demo/.env.example');
  for (const name of [
    'AGENCY_WORKSPACE_ENABLED',
    'INTEGRATION_CREDENTIAL_KEY',
    'INTEGRATION_CREDENTIAL_KEY_VERSION',
    'POSTIZ_ALLOWED_BASE_URLS',
    'POSTIZ_AUTOMATION_RUNTIME_READY',
    'POSTIZ_HANDOFF_ENABLED',
    'POSTIZ_PERFORMANCE_SYNC_ENABLED',
  ]) {
    assert.match(template, new RegExp(`^${name}=`, 'm'), `${name} must be in .env.example`);
  }
  assert.match(template, /openssl rand -base64 32/);
  assert.match(template, /^INTEGRATION_CREDENTIAL_KEY=$/m, 'the credential key must ship empty');
  assert.match(template, /^POSTIZ_AUTOMATION_RUNTIME_READY=false$/m);

  const postiz = await read('deployment/postiz/postiz.env.example');
  assert.match(postiz, /^JWT_SECRET=$/m, 'the JWT secret must ship empty');
  assert.match(postiz, /openssl rand -hex 32/);
});

test('Postiz images are pinned by digest instead of floating tags', async () => {
  const compose = await read('deployment/postiz/compose.yml');
  for (const image of compose.matchAll(/^\s+image: (\S+)$/gm)) {
    assert.match(image[1], /@sha256:[0-9a-f]{64}$/, `${image[1]} must be pinned by digest`);
  }
  assert.doesNotMatch(compose, /:latest\b/);
});

test('the Postiz bootstrap is idempotent and keeps secrets off the command line', async () => {
  const script = await read('deployment/postiz/scripts/postiz-bootstrap.sh');
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /run_sql\(\) \{ docker exec -i/, 'SQL must arrive on stdin');
  assert.doesNotMatch(script, /psql[^\n]*-c[^\n]*\$(password|apiKey)/, 'no secret may sit in argv');
  assert.doesNotMatch(script, /echo[^\n]*\$(password|apiKey|JWT)\b/, 'no secret value may be echoed');
  assert.match(script, /POSTIZ_BOOTSTRAP_OK/);
  assert.match(script, /POSTIZ_BOOTSTRAP_REFUSED/);
  assert.match(script, /POSTIZ_ALLOW_KEY_ROTATION/);
  assert.match(script, /ON CONFLICT|org_present/);
  assert.match(script, /chmod 0600/);
  assert.match(script, /does not match the organization apiKey/);
});

test('the scheduled backup covers Postiz and prunes with bounded retention', async () => {
  const script = await read('deployment/dashboard-demo/scripts/scheduled-backup.sh');
  assert.match(script, /TANAGHOM_BACKUP_RETENTION/);
  assert.match(script, /demo-backup\.sh/);
  assert.match(script, /postiz-postgres|POSTIZ_DB_CONTAINER/);
  assert.match(script, /pg_restore -l/, 'the Postiz dump must be proven readable');
  assert.match(script, /retention.*-ge 2|must keep at least 2 snapshots/);
  assert.match(script, /\[ "\$dir" = "\$target" \] && continue/, 'never prune the latest snapshot');
  assert.match(script, /SCHEDULED_BACKUP_COMPLETE/);
});

test('the runbook documents the Phase 1 host instead of the retired one', async () => {
  const runbook = await read('deployment/dashboard-demo/RUNBOOK.md');
  assert.doesNotMatch(runbook, /Release blocked/);
  assert.doesNotMatch(runbook, /38\.247\.187\.232/);
  assert.doesNotMatch(runbook, /\/opt\/tanaghom-demo/);
  assert.match(runbook, /13\.60\.253\.82/);
  assert.match(runbook, /\/home\/ubuntu\/tanaghom-demo/);
  assert.match(runbook, /Host configuration contract/);
  assert.match(runbook, /Workspace worker lifecycle/);
  assert.doesNotMatch(runbook, /leave `AGENCY_WORKSPACE_ENABLED` unset\/false/);
  assert.doesNotMatch(runbook, /stop the optional worker/);
  assert.match(runbook, /scheduled-backup\.sh/);
  assert.match(runbook, /postiz-bootstrap\.sh/);
});
