import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('environment template contains placeholders, not integration credentials', async () => {
  const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(template, /DATABASE_URL=postgresql:\/\/tanaghom:tanaghom@localhost/);
  assert.match(template, /SUPABASE_URL=\r?\n/);
  assert.match(template, /SUPABASE_SECRET_KEY=\r?\n/);
  assert.match(template, /INTERNAL_WEBHOOK_SECRET=\r?\n/);
  assert.match(template, /GEMMA_API_BASE_URL=\r?\n/);
  assert.match(template, /POSTIZ_API_BASE_URL=\r?\n/);
  assert.match(template, /GHL_API_BASE_URL=\r?\n/);
});

test('legacy recovery snapshot is explicitly non-deployable and secret-free by shape', async () => {
  const warning = await readFile(new URL('../archive/legacy-v0/README.md', import.meta.url), 'utf8');
  assert.match(warning, /not deployable/i);
  assert.match(warning, /neither may be run as a migration/i);
});

test('roadmap preserves the human publishing approval gate', async () => {
  const roadmap = await readFile(new URL('../docs/ROADMAP.md', import.meta.url), 'utf8');
  assert.match(roadmap, /human decision/i);
  assert.match(roadmap, /no\s+content can self-approve or publish/i);
});

test('migration runner accepts PostgreSQL boolean output variants', async () => {
  const runner = await readFile(new URL('../scripts/database.mjs', import.meta.url), 'utf8');
  assert.match(runner, /\['t', 'true', '1'\]\.includes/);
  assert.match(runner, /\.split\(\/\\r\?\\n\/\)/);
  assert.match(runner, /\.map\(\(version\) => version\.trim\(\)\)/);
});

test('dashboard runtime loads the ignored root environment explicitly', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const launcher = await readFile(new URL('../scripts/dashboard.mjs', import.meta.url), 'utf8');
  assert.match(manifest.scripts['dev:dashboard'], /scripts\/dashboard\.mjs dev/);
  assert.match(manifest.scripts['build:dashboard'], /scripts\/dashboard\.mjs build/);
  assert.match(manifest.scripts['start:dashboard'], /scripts\/dashboard\.mjs start/);
  assert.match(launcher, /process\.loadEnvFile/);
});

test('database roles keep n8n outside the human approval boundary', async () => {
  const migration = await readFile(new URL('../packages/database/migrations/0004_least_privilege_roles.up.sql', import.meta.url), 'utf8');
  const assertions = await readFile(new URL('../packages/database/tests/least_privilege_roles.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE ROLE tanaghom_n8n_worker NOLOGIN/);
  assert.match(migration, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tanaghom FROM PUBLIC/);
  assert.match(migration, /GRANT SELECT ON[\s\S]+TO tanaghom_n8n_worker/);
  const n8nGrants = migration.split(';').filter((statement) => /TO tanaghom_n8n_worker/.test(statement));
  assert.ok(n8nGrants.every((statement) => !/GRANT (INSERT|UPDATE|DELETE)/.test(statement)));
  assert.match(assertions, /n8n approval insert unexpectedly succeeded/);
  assert.match(assertions, /n8n content update unexpectedly succeeded/);
  assert.match(assertions, /readonly insert unexpectedly succeeded/);
});

test('Phase 3 Gemma contracts and prompts are versioned and non-operational', async () => {
  const root = new URL('../packages/contracts/schemas/phase3/', import.meta.url);
  const names = [
    'strategist-job.v1.schema.json',
    'strategist-output.v1.schema.json',
    'content-producer-job.v1.schema.json',
    'content-producer-output.v1.schema.json',
  ];
  const schemas = await Promise.all(names.map(async (name) => JSON.parse(await readFile(new URL(name, root), 'utf8'))));
  for (const schema of schemas) {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$id, /\.v1\.schema\.json$/);
  }
  const strategist = await readFile(new URL('../prompts/campaign-strategist/v1.md', import.meta.url), 'utf8');
  const producer = await readFile(new URL('../prompts/content-producer/v1.md', import.meta.url), 'utf8');
  assert.match(strategist, /Never publish/);
  assert.match(strategist, /blocked_missing_info/);
  assert.match(producer, /Never approve, schedule, publish/);
  assert.match(producer, /authenticated human/);
});

test('Phase 3 worker mutations use explicit controlled functions', async () => {
  const migration = await readFile(new URL('../packages/database/migrations/0005_controlled_worker_functions.up.sql', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../packages/database/migrations/0005_controlled_worker_functions.down.sql', import.meta.url), 'utf8');
  const assertions = await readFile(new URL('../packages/database/tests/controlled_worker_functions.sql', import.meta.url), 'utf8');
  for (const name of ['claim_agent_job', 'persist_strategy_result', 'persist_content_result', 'record_agent_job_failure', 'complete_content_job']) {
    assert.match(migration, new RegExp(`CREATE FUNCTION tanaghom\\.${name}`));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION tanaghom\\.${name}`));
    assert.match(rollback, new RegExp(`DROP FUNCTION tanaghom\\.${name}`));
  }
  assert.equal((migration.match(/SECURITY DEFINER/g) || []).length, 5);
  assert.equal((migration.match(/SET search_path = pg_catalog, pg_temp/g) || []).length, 5);
  assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE|DELETE).+tanaghom_n8n_worker/);
  assert.match(assertions, /content job completed without a human decision/);
  assert.match(assertions, /worker function forged a human approval/);
});

test('Phase 3 n8n exports are inactive and constrained to controlled boundaries', async () => {
  const files = ['campaign-strategist.v1.json', 'content-producer.v1.json'];
  for (const file of files) {
    const workflow = JSON.parse(await readFile(new URL(`../n8n/workflows/phase3/${file}`, import.meta.url), 'utf8'));
    assert.equal(workflow.active, false);
    assert.ok(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.manualTrigger'));
    assert.ok(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.scheduleTrigger'));
    assert.ok(workflow.nodes.every((node) => !['n8n-nodes-base.webhook', 'n8n-nodes-base.executeCommand', 'n8n-nodes-base.readWriteFile', 'n8n-nodes-base.ssh'].includes(node.type)));
    const http = workflow.nodes.find((node) => node.name === 'Call Gemma');
    assert.equal(http.parameters.url, 'https://api.thesmartlabs.net/v1/chat/completions');
    const postgres = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.postgres');
    assert.ok(postgres.every((node) => /^SELECT (?:\* FROM )?tanaghom\.(claim_agent_job|persist_strategy_result|persist_content_result|record_agent_job_failure)/.test(node.parameters.query)));
    assert.ok(postgres.every((node) => node.credentials.postgres.id === '62000000-0000-4000-8000-000000000001'));
    assert.equal(http.credentials.httpHeaderAuth.id, '62000000-0000-4000-8000-000000000002');
  }
});
