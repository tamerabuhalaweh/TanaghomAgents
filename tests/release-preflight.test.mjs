import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { readConfig, runPreflight, renderEvidence, stopQueries } from '../deployment/release-preflight/preflight.mjs';

const release = 'a'.repeat(40);
const migrations = ['0001_shared_foundation.up.sql', '0001_shared_foundation.down.sql', '0002_next.up.sql'];

async function fakeDashboard(overrides = {}) {
  const server = createServer((request, response) => {
    const code = overrides[request.url] ?? (request.url === '/api/health' ? 200 : request.url === '/login' ? 200 : 401);
    response.writeHead(code, { 'content-type': 'application/json' });
    response.end(request.url === '/api/health' ? JSON.stringify({ ok: code === 200, components: { api: 'ready', database: code === 200 ? 'connected' : 'unavailable' } }) : '{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

function deps(server, changes = {}) {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const statements = [];
  return {
    statements,
    exec: async (command, args) => {
      if (command === 'git' && args.includes('rev-parse')) return `${changes.head ?? release}\n`;
      if (command === 'git') return changes.dirty ?? '';
      if (command === 'npm') return JSON.stringify({ metadata: { vulnerabilities: { critical: 0, high: changes.high ?? 0, moderate: 1 } } });
      if (command === 'sh') return 'PASS: PostgreSQL 17.6 encrypted archive was decrypted, actually restored, and content-verified.';
      throw new Error(`unexpected ${command}`);
    },
    readdir: async () => migrations,
    fetch: (url, init) => {
      const target = new URL(url);
      if (target.hostname === 'private.invalid') {
        return changes.n8nPublic ? Promise.resolve(new Response('<title>n8n.io - Workflow Automation</title>', { status: 200 }))
          : Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
      }
      return fetch(`${origin}${target.pathname}`, init);
    },
    readOnly: async (sql) => {
      statements.push(...sql);
      return [{ latest: changes.migration ?? '0002_next', total: 2 }, { unsafe: changes.unsafeRole ?? false },
        ...Object.keys(stopQueries).map((name) => ({ stopped: name !== changes.openStop }))];
    },
    certificateExpiry: async () => Date.now() + (changes.certDays ?? 60) * 86_400_000,
  };
}

const config = { release, sourceDir: '/srv/source', dashboardUrl: 'https://tanaghom.example', databaseUrl: 'postgresql://ro@localhost/x',
  privateUrls: ['https://private.invalid:5678/', 'https://private.invalid/webhook/x'], expectStops: true, restoreDrill: true, host: 'certified', owner: 'ops' };

test('preflight config refuses to run without an exact release, https dashboard, private probes and owner', () => {
  const { missing } = readConfig({});
  assert.equal(missing.length, 6);
  assert.equal(readConfig({ RELEASE_COMMIT: release, SOURCE_DIR: '/s', DASHBOARD_URL: 'https://x', DATABASE_URL: 'p',
    PRIVATE_PROBE_URLS: 'https://x:5678', EVIDENCE_HOST: 'h', EVIDENCE_OWNER: 'o' }).missing.length, 0);
});

test('a healthy, exact, private and stopped release passes every check', async () => {
  const server = await fakeDashboard();
  try {
    const d = deps(server);
    const outcome = await runPreflight(config, d);
    assert.deepEqual(outcome.checks.filter((c) => !c.passed), []);
    assert.equal(outcome.checks.length, 12);
    assert.ok(d.statements.every((sql) => /^\s*SELECT/i.test(sql)));
    const report = renderEvidence(config, outcome, new Date('2026-09-07T00:00:00Z'));
    assert.match(report, /PASS — gate evidence candidate/);
    assert.match(report, new RegExp(release));
    assert.doesNotMatch(report, /postgresql:\/\//);
  } finally { server.close(); }
});

test('each unsafe or stale condition fails exactly its named check', async () => {
  const cases = [
    [{ head: 'b'.repeat(40) }, 'running_commit_matches_release'],
    [{ dirty: ' M apps/dashboard/proxy.ts' }, 'tracked_source_unmodified'],
    [{ migration: '0001_shared_foundation' }, 'migration_level_matches_release'],
    [{ unsafeRole: true }, 'api_role_least_privilege'],
    [{ openStop: 'agent_runtime' }, 'provider_and_model_stops'],
    [{ n8nPublic: true }, 'n8n_and_webhooks_not_public'],
    [{ certDays: 3 }, 'tls_certificate_valid_14_days'],
    [{ high: 2 }, 'production_dependency_audit'],
  ];
  const server = await fakeDashboard();
  try {
    for (const [change, name] of cases) {
      const outcome = await runPreflight(config, deps(server, change));
      assert.equal(outcome.passed, false, name);
      assert.deepEqual(outcome.checks.filter((c) => !c.passed).map((c) => c.name), [name]);
    }
  } finally { server.close(); }
});

test('unhealthy dashboard, open protected route and a skipped restore drill earn no credit', async () => {
  const server = await fakeDashboard({ '/api/health': 503, '/api/workspace': 200 });
  try {
    const outcome = await runPreflight({ ...config, restoreDrill: false }, deps(server));
    assert.deepEqual(outcome.checks.filter((c) => !c.passed).map((c) => c.name),
      ['dashboard_health', 'protected_routes_require_authentication', 'backup_restore_drill']);
  } finally { server.close(); }
});

test('preflight source stays read-only and the runbook is explicit about authority', () => {
  const source = readFileSync('deployment/release-preflight/preflight.mjs', 'utf8');
  assert.match(source, /BEGIN TRANSACTION READ ONLY/);
  assert.doesNotMatch(source, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|GRANT|TRUNCATE)\b/);
  assert.doesNotMatch(source, /method:\s*['"](POST|PUT|PATCH|DELETE)/);
  const runbook = readFileSync('deployment/release-preflight/RUNBOOK.md', 'utf8');
  for (const rule of [/certified production host/i, /read-only/i, /no scorecard credit/i, /test VPS does not count/i]) assert.match(runbook, rule);
});
