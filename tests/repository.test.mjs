import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('environment template contains placeholders, not integration credentials', async () => {
  const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(template, /DATABASE_URL=postgresql:\/\/tanaghom:tanaghom@localhost/);
  assert.match(template, /GEMMA_API_BASE_URL=\n/);
  assert.match(template, /POSTIZ_API_BASE_URL=\n/);
  assert.match(template, /GHL_API_BASE_URL=\n/);
});

test('roadmap preserves the human publishing approval gate', async () => {
  const roadmap = await readFile(new URL('../docs/ROADMAP.md', import.meta.url), 'utf8');
  assert.match(roadmap, /human decision/i);
  assert.match(roadmap, /no\s+content can self-approve or publish/i);
});
