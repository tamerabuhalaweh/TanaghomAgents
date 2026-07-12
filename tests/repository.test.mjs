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
