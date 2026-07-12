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
