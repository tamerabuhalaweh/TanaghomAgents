// Read-only release preflight for the "Fresh deployed baseline and security" gate.
// It never writes to the database, changes containers, activates workflows or calls a provider.
import { execFile } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import tls from 'node:tls';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const sha = /^[0-9a-f]{40}$/;

export const stopQueries = {
  automation_platform: 'SELECT coalesce(bool_and(emergency_stop),false) AS stopped FROM tanaghom.automation_platform_controls',
  agent_runtime: 'SELECT coalesce(bool_and(emergency_stop),false) AS stopped FROM tanaghom.agent_runtime_controls',
  agency_pilot: 'SELECT coalesce(bool_and(emergency_stop AND NOT model_execution_enabled),false) AS stopped FROM tanaghom.agency_pilot_controls',
  agency_workspace: 'SELECT coalesce(bool_and(emergency_stop OR NOT enabled),false) AS stopped FROM tanaghom.agency_workspace_control',
  notification_delivery: 'SELECT coalesce(bool_and(emergency_stop OR NOT runtime_ready),false) AS stopped FROM tanaghom.notification_delivery_controls',
};

export function readConfig(env) {
  const config = {
    release: env.RELEASE_COMMIT,
    sourceDir: env.SOURCE_DIR,
    dashboardUrl: (env.DASHBOARD_URL || '').replace(/\/+$/, ''),
    databaseUrl: env.DATABASE_URL,
    privateUrls: (env.PRIVATE_PROBE_URLS || '').split(',').map((url) => url.trim()).filter(Boolean),
    expectStops: env.EXPECT_STOPS_ACTIVE !== 'false',
    restoreDrill: env.RESTORE_DRILL === 'true',
    host: env.EVIDENCE_HOST,
    owner: env.EVIDENCE_OWNER,
  };
  const missing = [];
  if (!sha.test(config.release || '')) missing.push('RELEASE_COMMIT (40-char sha)');
  if (!config.sourceDir) missing.push('SOURCE_DIR');
  if (!/^https:\/\//.test(config.dashboardUrl)) missing.push('DASHBOARD_URL (https)');
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.privateUrls.length) missing.push('PRIVATE_PROBE_URLS (n8n editor/webhook URLs that must not be public)');
  if (!config.host || !config.owner) missing.push('EVIDENCE_HOST and EVIDENCE_OWNER');
  return { config, missing };
}

const result = (name, passed, detail) => ({ name, passed: Boolean(passed), detail });

async function status(fetcher, url, init = {}) {
  try {
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), ...init });
    return { status: response.status, text: await response.text().catch(() => '') };
  } catch (error) { return { status: 0, error: error.cause?.code || error.name }; }
}

export async function checkSource(config, deps) {
  const head = (await deps.exec('git', ['-C', config.sourceDir, 'rev-parse', 'HEAD'])).trim();
  const dirty = (await deps.exec('git', ['-C', config.sourceDir, 'status', '--porcelain', '--untracked-files=no'])).trim();
  const files = (await deps.readdir(join(config.sourceDir, 'packages/database/migrations'))).filter((f) => f.endsWith('.up.sql')).sort();
  return {
    expectedMigration: files.at(-1)?.replace(/\.up\.sql$/, ''),
    expectedMigrationCount: files.length,
    checks: [
      result('running_commit_matches_release', head === config.release, `HEAD ${head}`),
      result('tracked_source_unmodified', dirty === '', dirty ? `${dirty.split('\n').length} modified tracked files` : 'clean'),
    ],
  };
}

export async function checkDatabase(config, source, deps) {
  const rows = await deps.readOnly([
    "SELECT max(version) AS latest, count(*)::int AS total FROM public.schema_migrations",
    `SELECT coalesce(bool_or(rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls),true) AS unsafe
       FROM pg_roles WHERE rolname='tanaghom_api'`,
    ...Object.values(stopQueries),
  ]);
  const [migrations, role, ...stops] = rows;
  const stopNames = Object.keys(stopQueries);
  const active = stopNames.filter((_, i) => stops[i].stopped);
  return [
    result('migration_level_matches_release', migrations.latest === source.expectedMigration
      && migrations.total === source.expectedMigrationCount,
      `database ${migrations.latest} (${migrations.total}); release ${source.expectedMigration} (${source.expectedMigrationCount})`),
    result('api_role_least_privilege', role.unsafe === false, role.unsafe ? 'tanaghom_api is privileged or missing' : 'no superuser/createdb/createrole/bypassrls'),
    result('provider_and_model_stops', !config.expectStops || active.length === stopNames.length,
      `stopped: ${active.join(', ') || 'none'}; not stopped: ${stopNames.filter((n) => !active.includes(n)).join(', ') || 'none'}`),
  ];
}

export async function checkHttp(config, deps) {
  const base = config.dashboardUrl;
  const health = await status(deps.fetch, `${base}/api/health`);
  let body = {};
  try { body = JSON.parse(health.text); } catch { /* reported below */ }
  const login = await status(deps.fetch, `${base}/login`);
  const protectedRoutes = await Promise.all(['/api/operations', '/api/admin/agents', '/api/workspace', '/api/admin/notifications']
    .map(async (path) => [path, (await status(deps.fetch, `${base}${path}`)).status]));
  const privateProbes = await Promise.all(config.privateUrls.map(async (url) => [url, await status(deps.fetch, url)]));
  const exposed = privateProbes.filter(([, probe]) => probe.status >= 200 && probe.status < 400
    || /n8n/i.test(probe.text || ''));
  return [
    result('dashboard_health', health.status === 200 && body.ok === true && body.components?.database === 'connected',
      `HTTP ${health.status} ${JSON.stringify(body.components || {})}`),
    result('login_page_available', login.status === 200, `HTTP ${login.status}`),
    result('protected_routes_require_authentication', protectedRoutes.every(([, code]) => code === 401),
      protectedRoutes.map(([path, code]) => `${path} ${code}`).join(', ')),
    result('n8n_and_webhooks_not_public', exposed.length === 0,
      privateProbes.map(([url, probe]) => `${url} ${probe.status || probe.error}`).join(', ')),
  ];
}

export async function checkTls(config, deps) {
  const expiry = await deps.certificateExpiry(new URL(config.dashboardUrl).hostname);
  const days = expiry ? Math.floor((expiry - Date.now()) / 86_400_000) : -1;
  return [result('tls_certificate_valid_14_days', days >= 14, expiry ? `expires in ${days} days` : 'certificate unavailable')];
}

export async function checkDependencies(config, deps) {
  let report;
  try { report = JSON.parse(await deps.exec('npm', ['audit', '--omit=dev', '--json'], { cwd: config.sourceDir })); }
  catch (error) { try { report = JSON.parse(error.stdout); } catch { report = null; } }
  const counts = report?.metadata?.vulnerabilities;
  const serious = counts ? (counts.high || 0) + (counts.critical || 0) : null;
  return [result('production_dependency_audit', serious === 0,
    counts ? `critical ${counts.critical || 0}, high ${counts.high || 0}, moderate ${counts.moderate || 0}` : 'audit unavailable')];
}

export async function checkRestoreDrill(config, source, deps) {
  if (!config.restoreDrill) return [result('backup_restore_drill', false, 'not run (set RESTORE_DRILL=true); gate requires it')];
  try {
    const output = await deps.exec('sh', [join(config.sourceDir, 'deployment/production-database-backup/test-disposable-backup.sh'),
      config.databaseUrl, source.expectedMigration], { cwd: config.sourceDir });
    return [result('backup_restore_drill', /PASS:/.test(output), 'encrypted dump restored into a network-isolated disposable PostgreSQL')];
  } catch (error) { return [result('backup_restore_drill', false, `drill failed: ${String(error.message).slice(0, 200)}`)]; }
}

export async function runPreflight(config, deps) {
  const source = await checkSource(config, deps);
  const checks = [
    ...source.checks,
    ...await checkDatabase(config, source, deps),
    ...await checkHttp(config, deps),
    ...await checkTls(config, deps),
    ...await checkDependencies(config, deps),
    ...await checkRestoreDrill(config, source, deps),
  ];
  return { passed: checks.every((check) => check.passed), checks, migration: source.expectedMigration };
}

export function renderEvidence(config, outcome, now = new Date()) {
  return `# Release preflight evidence: fresh deployed baseline and security

- Date (UTC): ${now.toISOString()}
- Host: ${config.host}
- Release commit: \`${config.release}\`
- Expected migration: \`${outcome.migration}\`
- Owner: ${config.owner}
- Result: **${outcome.passed ? 'PASS — gate evidence candidate' : 'FAIL — no scorecard credit'}**

| Check | Result | Detail |
| --- | --- | --- |
${outcome.checks.map((c) => `| ${c.name} | ${c.passed ? 'pass' : 'FAIL'} | ${String(c.detail).replaceAll('|', '/')} |`).join('\n')}

Collected by \`deployment/release-preflight/preflight.mjs\`: database reads in one
READ ONLY transaction, HTTP GET probes only, no workflow/stop/provider change.
Secrets and connection strings are intentionally omitted.
`;
}

async function readOnlyQueries(databaseUrl, statements) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const rows = [];
    for (const statement of statements) rows.push((await client.query(statement)).rows[0]);
    await client.query('ROLLBACK');
    return rows;
  } finally { await client.end(); }
}

function certificateExpiry(host) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      resolve(socket.authorized && certificate.valid_to ? Date.parse(certificate.valid_to) : null);
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
  });
}

export const liveDeps = (config) => ({
  exec: async (command, args, options = {}) => (await run(command, args, { maxBuffer: 16 * 1024 * 1024, ...options })).stdout,
  readdir,
  fetch: globalThis.fetch,
  readOnly: (statements) => readOnlyQueries(config.databaseUrl, statements),
  certificateExpiry,
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { config, missing } = readConfig(process.env);
  if (missing.length) { console.error(`Missing: ${missing.join('; ')}`); process.exit(2); }
  const outcome = await runPreflight(config, liveDeps(config));
  const report = renderEvidence(config, outcome);
  const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
  if (out) await writeFile(out, report); else console.log(report);
  process.exit(outcome.passed ? 0 : 1);
}
