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
  assert.match(template, /INTEGRATION_CREDENTIAL_KEY=\r?\n/);
  assert.match(template, /INTEGRATION_WORKER_TOKEN=\r?\n/);
  assert.doesNotMatch(template, /POSTIZ_API_KEY|GHL_API_KEY/);
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
  const ids = ['phase3StrategistV1', 'phase3ContentProducerV1'];
  for (const [index, file] of files.entries()) {
    const workflow = JSON.parse(await readFile(new URL(`../n8n/workflows/phase3/${file}`, import.meta.url), 'utf8'));
    assert.equal(workflow.id, ids[index]);
    assert.equal(workflow.active, false);
    assert.ok(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.manualTrigger'));
    assert.ok(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.scheduleTrigger'));
    assert.ok(workflow.nodes.every((node) => !['n8n-nodes-base.webhook', 'n8n-nodes-base.executeCommand', 'n8n-nodes-base.readWriteFile', 'n8n-nodes-base.ssh'].includes(node.type)));
    const http = workflow.nodes.find((node) => node.name === 'Call Gemma');
    assert.equal(http.parameters.url, 'https://api.thesmartlabs.net/gemma4/v1/chat/completions');
    const requestNode = workflow.nodes.find((node) => node.name === 'Build Gemma Request');
    assert.match(requestNode.parameters.jsCode, /model: 'gemma4-26b-a4b-canary'/);
    assert.match(requestNode.parameters.jsCode, /"type":"json_schema"/);
    const postgres = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.postgres');
    assert.ok(postgres.every((node) => /^SELECT (?:\* FROM )?tanaghom\.(claim_agent_job|persist_strategy_result|persist_content_result|record_agent_job_failure)/.test(node.parameters.query)));
    assert.ok(postgres.every((node) => node.credentials.postgres.id === '62000000-0000-4000-8000-000000000001'));
    assert.equal(http.credentials.httpHeaderAuth.id, '62000000-0000-4000-8000-000000000002');
  }
});

test('Phase 4 Postiz handoff is draft-only, inactive, and approval guarded', async () => {
  const migration = await readFile(new URL('../packages/database/migrations/0007_postiz_draft_handoff.up.sql', import.meta.url), 'utf8');
  const integrationMigration = await readFile(new URL('../packages/database/migrations/0008_customer_integrations.up.sql', import.meta.url), 'utf8');
  const automationMigration = await readFile(new URL('../packages/database/migrations/0009_postiz_automation_controls.up.sql', import.meta.url), 'utf8');
  const automationUi = await readFile(new URL('../apps/dashboard/components/integrations-settings.tsx', import.meta.url), 'utf8');
  const gateway = await readFile(new URL('../apps/dashboard/app/api/internal/integrations/postiz/draft/route.ts', import.meta.url), 'utf8');
  const workflow = JSON.parse(await readFile(new URL('../n8n/workflows/phase4/postiz-draft-publisher.v1.json', import.meta.url), 'utf8'));
  assert.match(migration, /CREATE FUNCTION tanaghom\.queue_postiz_draft/);
  assert.match(migration, /CREATE FUNCTION tanaghom\.prepare_postiz_draft/);
  assert.match(migration, /active human approval evidence required/);
  assert.match(migration, /'type', 'draft'/);
  assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE|DELETE).+tanaghom_n8n_worker/);
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.find((node) => node.name === 'Polling Disabled Pending Approval').disabled, true);
  assert.ok(workflow.nodes.every((node) => !['n8n-nodes-base.webhook', 'n8n-nodes-base.executeCommand', 'n8n-nodes-base.readWriteFile', 'n8n-nodes-base.ssh'].includes(node.type)));
  const http = workflow.nodes.find((node) => node.name === 'Create Postiz Draft');
  assert.match(http.parameters.url, /TANAGHOM_INTEGRATION_GATEWAY_URL/);
  assert.doesNotMatch(JSON.stringify(workflow), /api\.postiz\.com|Tanaghom Postiz Staging API/);
  assert.equal(http.credentials.httpHeaderAuth.id, '62000000-0000-4000-8000-000000000004');
  assert.match(integrationMigration, /credential_ciphertext bytea/);
  assert.match(integrationMigration, /organization_id = v_organization_id/);
  assert.match(automationMigration, /postiz_draft_mode IN \('manual', 'automatic', 'paused'\)/);
  assert.match(automationMigration, /emergency_stop boolean NOT NULL DEFAULT true/);
  assert.match(automationMigration, /CREATE FUNCTION tanaghom\.claim_postiz_draft_job/);
  assert.match(automationMigration, /postiz\.automation_mode_changed/);
  assert.match(automationMigration, /approved content with active human approval required/);
  assert.match(automationUi, /Automatic drafts/);
  assert.match(automationUi, /never publish/i);
  assert.match(gateway, /operation\.response_summary IS NULL/);
  assert.match(gateway, /gateway_dispatched_at/);
  const postgres = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.postgres');
  assert.ok(postgres.every((node) => /^SELECT (?:\* FROM )?tanaghom\.(claim_postiz_draft_job|prepare_postiz_draft|complete_postiz_draft|record_postiz_draft_failure)/.test(node.parameters.query)));
  assert.ok(postgres.every((node) => node.credentials.postgres.id === '62000000-0000-4000-8000-000000000001'));
});

test('Phase 4H performance monitoring is historical, inactive, and attribution-safe', async () => {
  const migration = await readFile(new URL('../packages/database/migrations/0010_postiz_performance_monitoring.up.sql', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../packages/database/migrations/0010_postiz_performance_monitoring.down.sql', import.meta.url), 'utf8');
  const gateway = await readFile(new URL('../apps/dashboard/app/api/internal/integrations/postiz/analytics/route.ts', import.meta.url), 'utf8');
  const provider = await readFile(new URL('../apps/dashboard/lib/server/integration-providers.ts', import.meta.url), 'utf8');
  const reports = await readFile(new URL('../apps/dashboard/components/reports-view.tsx', import.meta.url), 'utf8');
  const schemaRoot = new URL('../packages/contracts/schemas/phase4/', import.meta.url);
  for (const name of ['postiz-performance-job.v1.schema.json', 'postiz-performance-result.v1.schema.json', 'lead-attribution-record.v1.schema.json']) {
    const schema = JSON.parse(await readFile(new URL(name, schemaRoot), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$id, /phase4\/.+\.v1\.schema\.json$/);
  }
  for (const name of ['queue_postiz_performance_sync', 'claim_postiz_performance_job', 'prepare_postiz_performance_sync', 'complete_postiz_performance_sync', 'record_postiz_performance_failure']) {
    assert.match(migration, new RegExp(`CREATE FUNCTION tanaghom\\.${name}`));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION tanaghom\\.${name}`));
    assert.match(rollback, new RegExp(`DROP FUNCTION tanaghom\\.${name}`));
  }
  assert.match(migration, /UNIQUE \(organization_id, post_id, provider, metric_key, observed_on\)/);
  assert.match(migration, /status IN \('attributed', 'quarantined'\)/);
  assert.match(migration, /attribution evidence crosses an organization or campaign boundary/);
  assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE|DELETE).+tanaghom_n8n_worker/);
  assert.match(gateway, /POSTIZ_PERFORMANCE_SYNC_ENABLED/);
  assert.match(gateway, /operation\.operation_type = 'read_analytics'/);
  assert.match(provider, /analytics\/post\/\$\{encodeURIComponent\(providerPostId\)\}/);
  assert.match(reports, /Attribution review/);
  assert.match(reports, /No leads awaiting attribution/);

  const workflow = JSON.parse(await readFile(new URL('../n8n/workflows/phase4/postiz-performance-monitor.v1.json', import.meta.url), 'utf8'));
  assert.equal(workflow.id, 'phase4PostizPerformanceV1');
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.find((node) => node.name === 'Performance Polling Disabled').disabled, true);
  assert.ok(workflow.nodes.every((node) => !['n8n-nodes-base.webhook', 'n8n-nodes-base.executeCommand', 'n8n-nodes-base.readWriteFile', 'n8n-nodes-base.ssh'].includes(node.type)));
  const http = workflow.nodes.find((node) => node.name === 'Fetch Postiz Analytics');
  assert.match(http.parameters.url, /TANAGHOM_INTEGRATION_GATEWAY_URL/);
  assert.doesNotMatch(JSON.stringify(workflow), /api\.postiz\.com|Authorization:|Bearer /);
  const normalizer = workflow.nodes.find((node) => node.name === 'Normalize Analytics Response');
  assert.match(normalizer.parameters.jsCode, /\\d\{4\}-\\d\{2\}-\\d\{2\}/,
    'generated n8n code must retain date-regex backslashes');
  const postgres = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.postgres');
  assert.ok(postgres.every((node) => /^SELECT (?:\* FROM )?tanaghom\.(claim_postiz_performance_job|prepare_postiz_performance_sync|complete_postiz_performance_sync|record_postiz_performance_failure)/.test(node.parameters.query)));
  assert.ok(postgres.every((node) => node.credentials.postgres.id === '62000000-0000-4000-8000-000000000001'));
});

test('Phase 4F gateway activation package is private, transactional, and reversible', async () => {
  const root = new URL('../deployment/phase4-postiz-activation/', import.meta.url);
  const n8n = await readFile(new URL('docker-compose.n8n-gateway.yml', root), 'utf8');
  const squid = await readFile(new URL('egress/squid.conf', root), 'utf8');
  const validate = await readFile(new URL('scripts/validate-gateway-boundary.sh', root), 'utf8');
  const credential = await readFile(new URL('scripts/import-gateway-credential.sh', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  assert.match(n8n, /https:\/\/tanaghom\.38-247-187-232\.sslip\.io/);
  assert.doesNotMatch(n8n, /NO_PROXY:.*tanaghom/);
  assert.match(squid, /acl tanaghom_gateway dstdomain tanaghom\.38-247-187-232\.sslip\.io/);
  assert.match(squid, /http_access allow tanaghom_gateway CONNECT/);
  assert.match(squid, /http_access deny all/);
  assert.match(validate, /dashboard must remain outside every n8n network/i);
  assert.match(validate, /unauthorized !== 401/);
  assert.match(validate, /authorized !== 400/);
  assert.match(validate, /socketConnect\('38\.247\.187\.232', 443\)/);
  assert.match(credential, /n8n import:credentials/);
  assert.match(credential, /Tanaghom Integration Gateway/);
  assert.match(credential, /read -r token \|\| true/);
  assert.match(runbook, /dashboard never joins an n8n network/i);
  assert.doesNotMatch(`${n8n}\n${squid}\n${validate}\n${credential}`, /Bearer\s+[A-Za-z0-9_-]{20,}/);
});
