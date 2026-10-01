import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRunBudget, connectionManifest, probeModelConnection, killSwitchActive } from '../packages/agent-runtime/model-connection.mjs';
import { readJourneyConfig, runJourney, reviewSheet } from '../scripts/agency-model-journey.mjs';

const model = connectionManifest.model;
async function stubModel({ models = [{ id: model, max_model_len: 32768 }], probeStatus = 200, finish = 'stop' } = {}) {
  const calls = [];
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== 'Bearer stub-key') return response.writeHead(401).end('{}');
    if (request.method === 'GET' && request.url === '/v1/models') {
      return response.writeHead(probeStatus, { 'content-type': 'application/json' }).end(JSON.stringify({ data: models }));
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    calls.push(body);
    const data = JSON.parse(body.messages[1].content);
    const arabic = /[\u0600-\u06ff]/u.test(data.brief);
    const content = `${arabic ? 'مسودة اختبار من نموذج وهمي' : 'STUB MODEL DRAFT'} for ${data.title}. Facts used: ${data.source_facts.slice(0, 40)}. Prior deliverables: ${data.previous_deliverables.length}.`;
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: body.model,
      choices: [{ finish_reason: finish, message: { content } }], usage: { prompt_tokens: 600, completion_tokens: 200, total_tokens: 800 } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { server, calls, url: `http://127.0.0.1:${server.address().port}/v1/chat/completions` };
}
const env = { AGENCY_MODEL_JOURNEY_AUTHORIZED: 'true', AGENCY_MODEL_KILL_SWITCH: 'false', AGENCY_MODEL_API_KEY: 'stub-key',
  AGENCY_MODEL_PRICE_PER_1K_TOKENS_USD: '0.01', RELEASE_COMMIT: 'c'.repeat(40), EVIDENCE_OWNER: 'Test reviewer', APP_ENV: 'test' };

test('successor manifest is proposed, bounded, zero-action and leaves frozen packages untouched', () => {
  assert.equal(connectionManifest.status, 'proposed_successor_not_authorized');
  assert.equal(connectionManifest.external_actions, 0);
  assert.ok(connectionManifest.limits.max_calls_per_run <= 4 && connectionManifest.limits.max_spend_usd_per_run <= 1);
  const workspace = readFileSync('packages/agent-runtime/workspace.mjs', 'utf8');
  assert.match(workspace, /export const modelEndpoint = 'https:\/\/api\.thesmartlabs\.net\/gemma4\/v1\/chat\/completions'/);
});

test('probe distinguishes verified, missing key, rejected key, unserved model and unreachable host', async () => {
  const stub = await stubModel();
  const models = stub.url.replace('/chat/completions', '/models');
  try {
    assert.equal((await probeModelConnection({ url: models, apiKey: 'stub-key', model })).state, 'verified');
    assert.equal((await probeModelConnection({ url: models, apiKey: '', model })).code, 'model_key_missing');
    assert.equal((await probeModelConnection({ url: models, apiKey: 'wrong', model })).code, 'model_key_rejected');
    assert.equal((await probeModelConnection({ url: models, apiKey: 'stub-key', model: 'other-model' })).code, 'model_not_served');
  } finally { stub.server.close(); }
  assert.equal((await probeModelConnection({ url: models, apiKey: 'stub-key', model })).code, 'model_unreachable');
});

test('kill switch is on unless explicitly cleared, and budgets refuse calls, tokens and spend beyond limits', () => {
  assert.equal(killSwitchActive({}), true);
  assert.throws(() => createRunBudget({ pricePer1kTokensUsd: 0.01, env: {} }).authorize(100, 100), /kill_switch_active/);
  const open = { AGENCY_MODEL_KILL_SWITCH: 'false' };
  assert.throws(() => createRunBudget({ pricePer1kTokensUsd: NaN, env: open }), /model_price_required/);
  const calls = createRunBudget({ pricePer1kTokensUsd: 0, env: open });
  for (let i = 0; i < connectionManifest.limits.max_calls_per_run; i++) calls.authorize(100, 100);
  assert.throws(() => calls.authorize(100, 100), /budget_calls_exceeded/);
  assert.throws(() => createRunBudget({ pricePer1kTokensUsd: 0, env: open }).authorize(1401, 10), /budget_output_tokens_exceeded/);
  assert.throws(() => createRunBudget({ pricePer1kTokensUsd: 0, env: open }).authorize(1400, 30000), /budget_tokens_exceeded/);
  assert.throws(() => createRunBudget({ pricePer1kTokensUsd: 100, env: open }).authorize(1400, 1000), /budget_spend_exceeded/);
});

test('journey refuses without authorization, cleared kill switch, price, release, owner or https', () => {
  assert.deepEqual(readJourneyConfig(env).errors, []);
  assert.deepEqual(readJourneyConfig({}).errors.sort(), ['evidence_owner_required', 'journey_not_authorized', 'kill_switch_active',
    'model_key_missing', 'model_price_required', 'release_commit_required'].sort());
  assert.ok(readJourneyConfig({ ...env, APP_ENV: 'production', AGENCY_MODEL_URL: 'http://127.0.0.1:1/v1/chat/completions' }).errors.includes('model_url_https_required'));
});

test('stub-model journey runs strategy then content in English and Arabic and writes a human review sheet', async () => {
  const stub = await stubModel();
  try {
    const { config } = readJourneyConfig({ ...env, AGENCY_MODEL_URL: stub.url });
    const { passed, evidence } = await runJourney({ config, env });
    assert.equal(passed, true, JSON.stringify(evidence.error));
    assert.deepEqual(evidence.steps.map((s) => `${s.language}:${s.profile}:${s.status}`), ['en:social_media_strategist:succeeded',
      'en:content_creator:succeeded', 'ar:social_media_strategist:succeeded', 'ar:content_creator:succeeded']);
    assert.equal(stub.calls.length, 4);
    assert.equal(JSON.parse(stub.calls[1].messages[1].content).previous_deliverables.length, 1);
    assert.ok(stub.calls.every((call) => call.max_tokens <= 1400 && call.model === model));
    assert.deepEqual(evidence.budget, { calls: 4, tokens: 3200, spend_usd: 0.032 });
    assert.doesNotMatch(JSON.stringify(evidence), /stub-key/);
    const sheet = reviewSheet(evidence);
    assert.match(sheet, /Decision \(one per language\)/);
    assert.match(sheet, /dir="rtl"/);
    assert.match(sheet, /synthetic fixture \(not approved customer knowledge\)/);
  } finally { stub.server.close(); }
});

test('journey stops at the first rejected output and never presents it as a result', async () => {
  const stub = await stubModel({ finish: 'length' });
  try {
    const { config } = readJourneyConfig({ ...env, AGENCY_MODEL_URL: stub.url });
    const { passed, evidence } = await runJourney({ config, env });
    assert.equal(passed, false);
    assert.equal(evidence.steps.length, 1);
    assert.equal(evidence.steps[0].document, null);
    assert.equal(evidence.error, 'workspace_output_rejected');
  } finally { stub.server.close(); }
});

test('dashboard replaces the static label with a cached real probe and keeps test origins out of production', () => {
  const server = readFileSync('apps/dashboard/lib/server/agency-workspace.ts', 'utf8');
  assert.match(server, /probeModelConnection\(/);
  assert.match(server, /\["test","integration"\]\.includes\(process\.env\.APP_ENV\|\|""\)\?process\.env\.AGENCY_MODEL_PROBE_URL/);
  assert.match(server, /ready:configured\(\)&&verified&&/);
  const ui = readFileSync('apps/dashboard/components/agency-workspace.tsx', 'utf8');
  for (const label of ['Model connection verified', 'Model connection failed', 'Model connection pending']) assert.match(ui, new RegExp(label));
  assert.doesNotMatch(ui, /Model worker configured/);
});
