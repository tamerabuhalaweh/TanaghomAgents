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

test('Phase 5A GHL synchronization is contact-only, inactive, and least privileged', async () => {
  const migration = await readFile(new URL('../packages/database/migrations/0011_ghl_contact_sync.up.sql', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../packages/database/migrations/0011_ghl_contact_sync.down.sql', import.meta.url), 'utf8');
  const gateway = await readFile(new URL('../apps/dashboard/app/api/internal/integrations/ghl/contact/route.ts', import.meta.url), 'utf8');
  const provider = await readFile(new URL('../apps/dashboard/lib/server/integration-providers.ts', import.meta.url), 'utf8');
  const workflow = JSON.parse(await readFile(new URL('../n8n/workflows/phase5/ghl-contact-sync.v1.json', import.meta.url), 'utf8'));
  for (const name of ['queue_ghl_contact_upsert', 'claim_ghl_contact_job', 'prepare_ghl_contact_upsert', 'complete_ghl_contact_upsert', 'record_ghl_contact_failure']) {
    assert.match(migration, new RegExp(`CREATE FUNCTION tanaghom\\.${name}`));
    assert.match(rollback, new RegExp(`DROP FUNCTION tanaghom\\.${name}`));
  }
  assert.match(migration, /createNewIfDuplicateAllowed', false/);
  assert.match(migration, /contact_sync_mode IN \('manual', 'paused'\)/);
  assert.match(migration, /control\.provider = 'ghl' AND NOT control\.emergency_stop/);
  assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE|DELETE).+tanaghom_n8n_worker/);
  assert.match(gateway, /GHL_CONTACT_SYNC_ENABLED/);
  assert.match(gateway, /operation\.operation_type = 'upsert_contact'/);
  assert.match(provider, /contacts\/upsert/);
  assert.match(provider, /Version: "v3"/);
  assert.equal(workflow.id, 'phase5GhlContactUpsertV1');
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.saveDataErrorExecution, 'none');
  assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
  assert.equal(workflow.nodes.find((node) => node.type === 'n8n-nodes-base.scheduleTrigger').disabled, true);
  assert.ok(workflow.nodes.every((node) => !['n8n-nodes-base.webhook', 'n8n-nodes-base.executeCommand', 'n8n-nodes-base.readWriteFile', 'n8n-nodes-base.ssh'].includes(node.type)));
  assert.doesNotMatch(JSON.stringify(workflow), /services\.leadconnectorhq\.com|Authorization:|Bearer |\/messages|\/sms|\/emails\/send/i);
  const postgres = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.postgres');
  assert.ok(postgres.every((node) => /^SELECT (?:\* FROM )?tanaghom\.(claim_ghl_contact_job|prepare_ghl_contact_upsert|complete_ghl_contact_upsert|record_ghl_contact_failure)/.test(node.parameters.query)));
});

test('Phase 5B GHL ingress verifies raw Ed25519 bodies and durably queues zero-action work', async () => {
  const migration = await readFile(new URL('../packages/database/migrations/0012_ghl_inbound_event_inbox.up.sql', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../packages/database/migrations/0012_ghl_inbound_event_inbox.down.sql', import.meta.url), 'utf8');
  const route = await readFile(new URL('../apps/dashboard/app/api/webhooks/ghl/route.ts', import.meta.url), 'utf8');
  const verifier = await readFile(new URL('../apps/dashboard/lib/server/ghl-inbound-webhook.ts', import.meta.url), 'utf8');
  const runbook = await readFile(new URL('../deployment/phase5b-ghl-inbound/RUNBOOK.md', import.meta.url), 'utf8');
  const nginx = await readFile(new URL('../deployment/phase5b-ghl-inbound/nginx/ghl-webhook.conf', import.meta.url), 'utf8');

  for (const name of [
    'record_ghl_webhook_rejection', 'accept_ghl_inbound_event',
    'claim_ghl_inbound_event_job', 'complete_ghl_inbound_event',
    'record_ghl_inbound_event_failure', 'recover_stale_ghl_inbound_event_jobs',
    'replay_ghl_inbound_event',
  ]) {
    assert.match(migration, new RegExp(`CREATE FUNCTION tanaghom\\.${name}`));
    assert.match(rollback, new RegExp(`DROP FUNCTION tanaghom\\.${name}`));
  }
  assert.match(migration, /CREATE ROLE tanaghom_conversation_worker/);
  assert.match(migration, /conversation_processing_mode IN \('paused', 'shadow'\)/);
  assert.match(migration, /UNIQUE \(integration_connection_id, provider_event_id\)/);
  assert.match(migration, /WHERE job_type = 'conversation\.ghl\.inbound_event'/);
  assert.match(migration, /external_action_count', 0/);
  assert.doesNotMatch(migration, /GRANT (SELECT|INSERT|UPDATE|DELETE).+tanaghom_conversation_worker/);
  assert.doesNotMatch(migration, /GRANT .+tanaghom_n8n_worker/);

  assert.match(route, /GHL_WEBHOOK_INGRESS_ENABLED/);
  assert.match(route, /request\.arrayBuffer\(\)/);
  assert.match(route, /x-ghl-signature/);
  assert.match(route, /maximumBodyBytes = 256 \* 1024/);
  assert.doesNotMatch(route, /request\.json\(\)/);
  assert.match(verifier, /verify\(null, rawBody, webhookPublicKey\(\), decoded\)/);
  assert.match(verifier, /MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=/);
  assert.doesNotMatch(`${route}\n${verifier}`, /services\.leadconnectorhq\.com|\/conversations\/messages|GEMMA|N8N_/i);

  for (const name of [
    'ghl-inbound-event.v1.schema.json',
    'ghl-inbound-event-job.v1.schema.json',
    'ghl-inbound-event-result.v1.schema.json',
  ]) {
    const schema = JSON.parse(await readFile(new URL(`../packages/contracts/schemas/phase5/${name}`, import.meta.url), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.additionalProperties, false);
  }
  const resultSchema = JSON.parse(await readFile(new URL('../packages/contracts/schemas/phase5/ghl-inbound-event-result.v1.schema.json', import.meta.url), 'utf8'));
  assert.equal(resultSchema.properties.external_action_count.const, 0);

  assert.match(runbook, /Production[\s\S]*unauthorized/i);
  assert.match(runbook, /GHL_WEBHOOK_INGRESS_ENABLED=false/);
  assert.match(runbook, /npm run db:rollback/);
  assert.match(runbook, /pg_restore --exit-on-error/);
  assert.match(nginx, /limit_req zone=tanaghom_ghl_webhook/);
  assert.match(nginx, /client_max_body_size 256k/);
});

test('Phase 5C knowledge is versioned, tenant-bound, grounded, and proposal-only', async () => {
  const migration = await readFile(new URL('../packages/database/migrations/0013_sales_knowledge_intelligence.up.sql', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../packages/database/migrations/0013_sales_knowledge_intelligence.down.sql', import.meta.url), 'utf8');
  const prompt = await readFile(new URL('../prompts/conversation-intelligence/v1.md', import.meta.url), 'utf8');
  const service = await readFile(new URL('../apps/dashboard/lib/server/knowledge-management.ts', import.meta.url), 'utf8');
  const component = await readFile(new URL('../apps/dashboard/components/knowledge-management.tsx', import.meta.url), 'utf8');
  const runbook = await readFile(new URL('../deployment/phase5c-conversation-intelligence/RUNBOOK.md', import.meta.url), 'utf8');
  for (const name of ['create_sales_knowledge_draft', 'transition_sales_knowledge_version', 'prepare_conversation_intelligence', 'persist_conversation_intelligence_proposal']) {
    assert.match(migration, new RegExp(`CREATE FUNCTION tanaghom\\.${name}`));
    assert.match(rollback, new RegExp(`DROP FUNCTION tanaghom\\.${name}`));
  }
  assert.match(migration, /WHERE status = 'active'/);
  assert.match(migration, /external_action_count integer NOT NULL DEFAULT 0 CHECK \(external_action_count = 0\)/);
  assert.match(migration, /cardinality\(input_event_ids\) BETWEEN 1 AND 12/);
  assert.match(migration, /citation is not an active organization knowledge version/);
  assert.match(migration, /forbidden_claims text\[\]/);
  assert.doesNotMatch(migration, /GRANT (SELECT|INSERT|UPDATE|DELETE).+tanaghom_conversation_worker/);
  assert.doesNotMatch(migration, /GRANT .+tanaghom_n8n_worker/);
  assert.match(prompt, /untrusted customer data/i);
  assert.match(prompt, /Never use a[\s\S]*revoked, superseded/i);
  assert.match(prompt, /forbidden_claims/i);
  assert.match(service, /authorize\(request, \["owner"\]\)/);
  assert.match(service, /create_sales_knowledge_draft/);
  assert.match(component, /Only active versions can be retrieved/);
  assert.match(component, /No auto-reply/);
  assert.doesNotMatch(`${service}\n${component}`, /GEMMA|services\.leadconnectorhq\.com|\/conversations\/messages/i);
  for (const name of ['conversation-intelligence-request.v1.schema.json', 'conversation-intelligence-output.v1.schema.json', 'conversation-summary.v1.schema.json']) {
    const schema = JSON.parse(await readFile(new URL(`../packages/contracts/schemas/phase5/${name}`, import.meta.url), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.additionalProperties, false);
  }
  assert.match(runbook, /Production[\s\S]*unauthorized/i);
  assert.match(runbook, /npm run db:rollback/);
  assert.match(runbook, /pg_restore --exit-on-error/);
});

test('Phase 5D supervisor ownership is atomic, tenant-bound, and dispatch-safe', async () => {
  const migration = await readFile(new URL('../packages/database/migrations/0014_supervised_conversation_ownership.up.sql', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../packages/database/migrations/0014_supervised_conversation_ownership.down.sql', import.meta.url), 'utf8');
  const service = await readFile(new URL('../apps/dashboard/lib/server/conversation-supervision.ts', import.meta.url), 'utf8');
  const component = await readFile(new URL('../apps/dashboard/components/supervisor-inbox.tsx', import.meta.url), 'utf8');
  const runbook = await readFile(new URL('../deployment/phase5d-supervisor-ownership/RUNBOOK.md', import.meta.url), 'utf8');
  for (const name of ['transition_supervised_conversation', 'claim_conversation_ai_lease', 'assert_conversation_ai_reply_authority', 'create_conversation_human_reply_draft', 'set_organization_conversation_emergency_stop', 'sweep_conversation_supervisor_alerts']) {
    assert.match(migration, new RegExp(`CREATE FUNCTION tanaghom\\.${name}`));
    assert.match(rollback, new RegExp(`DROP FUNCTION tanaghom\\.${name}`));
  }
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /stale conversation version/);
  assert.match(migration, /AI reply authority lost before dispatch/);
  assert.match(migration, /UNIQUE \(organization_id, command_id\)/);
  assert.match(migration, /conversation_version=conversation\.conversation_version\+1/);
  assert.match(migration, /conversation_emergency_stop boolean NOT NULL DEFAULT true/);
  assert.doesNotMatch(migration, /GRANT (SELECT|INSERT|UPDATE|DELETE).+tanaghom_conversation_worker/);
  assert.doesNotMatch(migration, /GRANT .+tanaghom_n8n_worker/);
  assert.match(service, /authorize\(request, \["owner", "reviewer", "operator", "viewer"\]\)/);
  assert.match(service, /organization_id=\$1/);
  assert.doesNotMatch(`${service}\n${component}`, /services\.leadconnectorhq\.com|\/conversations\/messages|axios/i);
  for (const state of ['loading', 'forbidden', 'error', 'offline', 'stale']) assert.match(component.toLowerCase(), new RegExp(state));
  assert.match(component, /Nothing was sent to GHL/);
  assert.match(component, /dir=\{conversation\.language === "ar" \? "rtl" : "ltr"\}/);
  assert.match(runbook, /Production[\s\S]*unauthorized/i);
  assert.match(runbook, /assert_conversation_ai_reply_authority/);
  assert.match(runbook, /npm run db:rollback/);
  assert.match(runbook, /pg_restore --exit-on-error/);
});

test('Phase 5E GHL actions are governed, inactive, replay-safe, and least privileged', async () => {
  const migration = await readFile(new URL('../packages/database/migrations/0015_governed_ghl_actions.up.sql', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../packages/database/migrations/0015_governed_ghl_actions.down.sql', import.meta.url), 'utf8');
  const workflow = JSON.parse(await readFile(new URL('../n8n/workflows/phase5/governed-ghl-actions.v1.json', import.meta.url), 'utf8'));
  const gateway = await readFile(new URL('../apps/dashboard/app/api/internal/integrations/ghl/action/route.ts', import.meta.url), 'utf8');
  const provider = await readFile(new URL('../apps/dashboard/lib/server/integration-providers.ts', import.meta.url), 'utf8');
  const runbook = await readFile(new URL('../deployment/phase5e-governed-ghl-actions/RUNBOOK.md', import.meta.url), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
  const integration = await readFile(new URL('../scripts/n8n-ghl-workflow-integration.mjs', import.meta.url), 'utf8');
  for (const name of ['set_ghl_action_automation_mode', 'set_ghl_action_emergency_stop', 'queue_ghl_action', 'decide_ghl_action', 'claim_ghl_action_job', 'prepare_ghl_action_dispatch', 'complete_ghl_action', 'record_ghl_action_failure']) {
    assert.match(migration, new RegExp(`CREATE FUNCTION tanaghom\\.${name}`));
    assert.match(rollback, new RegExp(`DROP FUNCTION tanaghom\\.${name}`));
  }
  assert.match(migration, /action_mode text NOT NULL DEFAULT 'manual'/);
  assert.match(migration, /action_emergency_stop boolean NOT NULL DEFAULT true/);
  assert.match(migration, /consent_status IN \('unknown','opted_in','opted_out','dnd'\)/);
  assert.match(migration, /organization quiet hours block proactive messaging/);
  assert.match(migration, /contact frequency cap reached/);
  assert.match(migration, /indeterminate GHL action exists/);
  assert.doesNotMatch(migration, /GRANT (SELECT|INSERT|UPDATE|DELETE).+tanaghom_(n8n|conversation)_worker/);
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.find((node) => node.type === 'n8n-nodes-base.scheduleTrigger')?.disabled, true);
  assert.match(JSON.stringify(workflow), /claim_ghl_action_job/);
  assert.match(JSON.stringify(workflow), /prepare_ghl_action_dispatch/);
  assert.match(JSON.stringify(workflow), /TANAGHOM_INTEGRATION_GATEWAY_URL/);
  assert.doesNotMatch(JSON.stringify(workflow), /services\.leadconnectorhq\.com|Bearer [A-Za-z0-9]/);
  assert.match(gateway, /GHL_ACTION_RUNTIME_ENABLED !== "true"/);
  assert.match(gateway, /operation\.request_fingerprint='md5:'\|\|md5/);
  assert.match(gateway, /operation\.response_summary IS NULL/);
  assert.match(gateway, /conversation\.ownership_epoch=job\.ownership_epoch/);
  for (const path of ['/conversations/messages', '/calendars/events/appointments', '/contacts/', '/opportunities/']) {
    assert.match(provider, new RegExp(path.replaceAll('/', '\\/')));
  }
  for (const name of ['ghl-action-job.v1.schema.json', 'ghl-action-dispatch.v1.schema.json', 'ghl-action-result.v1.schema.json']) {
    const schema = JSON.parse(await readFile(new URL(`../packages/contracts/schemas/phase5/${name}`, import.meta.url), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.additionalProperties, false);
  }
  assert.match(runbook, /Production[\s\S]*unauthorized/i);
  assert.match(runbook, /simulated provider/i);
  assert.match(runbook, /npm run db:rollback/);
  assert.match(runbook, /pg_restore --exit-on-error/);
  assert.match(quality, /test-disposable-backup\.sh "\$DATABASE_TEST_URL" 0018_conversation_capacity_backpressure/);
  assert.match(quality, /name: phase5-sales-lifecycle-evidence/);
  assert.match(integration, /phase5\.sales-lifecycle-evidence\.v1/);
  assert.match(integration, /accept_ghl_inbound_event/);
  assert.match(integration, /persist_conversation_intelligence_proposal/);
  for (const action of ['message', 'qualification', 'appointment', 'opportunity']) {
    assert.match(integration, new RegExp(`type: "${action}"`));
  }
  assert.match(integration, /customer_credentials_used: false/);
  assert.match(integration, /external_publish_or_message: false/);
});

test('Phase 5E service-agent completions retain an attributable audit actor', async () => {
  const migration = await readFile(new URL('../packages/database/migrations/0017_ghl_service_action_audit_attribution.up.sql', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../packages/database/migrations/0017_ghl_service_action_audit_attribution.down.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE OR REPLACE FUNCTION tanaghom\.attach_ghl_service_actor_to_audit/);
  assert.match(migration, /NEW\.entity_type='ghl_action_job'/);
  assert.match(migration, /job\.requested_by_agent_id INTO NEW\.actor_user_id/);
  assert.match(migration, /REVOKE ALL ON FUNCTION tanaghom\.attach_ghl_service_actor_to_audit\(\) FROM PUBLIC/);
  assert.match(rollback, /NEW\.action_type='ghl\.action_queued'/);
  assert.doesNotMatch(rollback, /NEW\.entity_type='ghl_action_job'/);
});

test('Phase 5E action review records immutable human reconciliation without worker table access', async () => {
  const migration = await readFile(new URL('../packages/database/migrations/0016_ghl_action_review_reconciliation.up.sql', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../packages/database/migrations/0016_ghl_action_review_reconciliation.down.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE tanaghom\.ghl_action_reconciliations/);
  assert.match(migration, /CREATE FUNCTION tanaghom\.reconcile_ghl_action/);
  assert.match(migration, /CREATE TRIGGER ghl_action_reconciliation_no_update/);
  assert.match(migration, /CREATE TRIGGER ghl_action_reconciliation_no_delete/);
  assert.match(migration, /CREATE TRIGGER agent_actions_log_ghl_service_actor/);
  assert.match(migration, /job\.requested_by_agent_id INTO NEW\.actor_user_id/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /confirmed_succeeded/);
  assert.match(migration, /confirmed_not_applied/);
  assert.match(migration, /status<>'indeterminate'/);
  assert.match(migration, /GHL reconciliation command conflict/);
  assert.doesNotMatch(migration, /GRANT (SELECT|INSERT|UPDATE|DELETE).+tanaghom_(n8n|conversation)_worker/);
  assert.match(rollback, /DROP FUNCTION tanaghom\.reconcile_ghl_action/);
  assert.match(rollback, /DROP TABLE tanaghom\.ghl_action_reconciliations/);
});

test('Phase 5F capacity is measured, bounded, recoverable, and SmartLabs-isolated', async () => {
  const migration = await readFile(new URL('../packages/database/migrations/0018_conversation_capacity_backpressure.up.sql', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../packages/database/migrations/0018_conversation_capacity_backpressure.down.sql', import.meta.url), 'utf8');
  const integration = await readFile(new URL('../scripts/conversation-capacity-integration.mjs', import.meta.url), 'utf8');
  const resilience = await readFile(new URL('../scripts/conversation-resilience-integration.mjs', import.meta.url), 'utf8');
  const runbook = await readFile(new URL('../deployment/phase5f-capacity/RUNBOOK.md', import.meta.url), 'utf8');
  const architecture = await readFile(new URL('../docs/architecture/0010-conversation-capacity-and-backpressure.md', import.meta.url), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
  const alerts = JSON.parse(await readFile(new URL('../deployment/phase5f-capacity/alerts/conversation-capacity-alerts.v1.json', import.meta.url), 'utf8'));
  const evidenceSchema = JSON.parse(await readFile(new URL('../packages/contracts/schemas/phase5/conversation-capacity-evidence.v1.schema.json', import.meta.url), 'utf8'));
  const resilienceSchema = JSON.parse(await readFile(new URL('../packages/contracts/schemas/phase5/conversation-resilience-evidence.v1.schema.json', import.meta.url), 'utf8'));

  assert.match(migration, /CREATE TABLE tanaghom\.conversation_capacity_policies/);
  assert.match(migration, /CREATE TABLE tanaghom\.conversation_dependency_cooldowns/);
  assert.match(migration, /CREATE VIEW tanaghom\.conversation_capacity_status/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION tanaghom\.claim_ghl_inbound_event_job/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION tanaghom\.claim_ghl_action_job/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /priority_score/);
  assert.match(migration, /gemma_rate_limited/);
  assert.match(migration, /p_http_status=429/);
  assert.doesNotMatch(migration, /GRANT (SELECT|INSERT|UPDATE|DELETE).+tanaghom_(n8n|conversation)_worker/);
  assert.match(rollback, /DROP TABLE tanaghom\.conversation_capacity_policies/);
  assert.match(rollback, /input-['"]workload_class['"]/);
  assert.match(rollback, /CREATE OR REPLACE FUNCTION tanaghom\.claim_ghl_inbound_event_job/);
  assert.match(rollback, /CREATE OR REPLACE FUNCTION tanaghom\.claim_ghl_action_job/);

  assert.equal(evidenceSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(evidenceSchema.additionalProperties, false);
  assert.equal(evidenceSchema.properties.boundaries.properties.smartlabs_touched.const, false);
  assert.equal(resilienceSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(resilienceSchema.additionalProperties, false);
  assert.equal(resilienceSchema.properties.boundaries.properties.smartlabs_touched.const, false);
  assert.equal(alerts.contract_version, 'phase5.conversation-capacity-alerts.v1');
  assert.equal(alerts.rules.length, 6);
  assert.match(integration, /GHL_CAPACITY_LOAD_EVENTS/);
  assert.match(integration, /phase5\.conversation-capacity-evidence\.v1/);
  assert.match(integration, /provider_calls: 0/);
  assert.match(integration, /smartlabs_touched: false/);
  assert.match(integration, /fixed_75000_lead_sla_claimed: false/);
  assert.match(resilience, /phase5\.conversation-resilience-evidence\.v1/);
  assert.match(resilience, /pg_terminate_backend/);
  assert.match(resilience, /createCipheriv\("aes-256-gcm"/);
  assert.match(resilience, /pg_dump/);
  assert.match(resilience, /pg_restore/);
  assert.doesNotMatch(resilience, /--no-acl/);
  assert.match(resilience, /replay_ghl_inbound_event/);
  assert.match(resilience, /smartlabs_touched: false/);
  assert.match(quality, /GHL_CAPACITY_LOAD_EVENTS: 10000/);
  assert.match(quality, /name: phase5-conversation-capacity-evidence/);
  assert.match(quality, /GHL_RESILIENCE_SOAK_SECONDS: 10/);
  assert.match(quality, /name: phase5-conversation-resilience-evidence/);
  assert.match(runbook, /Production execution is unauthorized/);
  assert.match(runbook, /SmartLabs file, container, firewall rule, volume, or voice path/);
  assert.match(runbook, /npm run db:rollback/);
  assert.match(architecture, /measured operating envelope/);
  assert.match(architecture, /cannot establish production/);
});

test('Phase 5D production update is manual, transactional, scoped, and recoverable', async () => {
  const root = new URL('../deployment/phase5d-production-update/', import.meta.url);
  const common = await readFile(new URL('scripts/common.sh', root), 'utf8');
  const preflight = await readFile(new URL('scripts/preflight.sh', root), 'utf8');
  const deploy = await readFile(new URL('scripts/deploy-update.sh', root), 'utf8');
  const validate = await readFile(new URL('scripts/validate-release.sh', root), 'utf8');
  const rollback = await readFile(new URL('scripts/rollback-update.sh', root), 'utf8');
  const backup = await readFile(new URL('scripts/prepare-offserver-backup.ps1', root), 'utf8');
  const disposableBackup = await readFile(new URL('scripts/test-disposable-backup.sh', root), 'utf8');
  const packageValidation = await readFile(new URL('scripts/validate-package.sh', root), 'utf8');
  const refusalPaths = await readFile(new URL('scripts/test-refusal-paths.sh', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');

  assert.match(common, /YES-I-AM-THE-AUTHORIZED-OWNER/);
  assert.match(common, /EXPECTED_START_MIGRATION=0009_postiz_automation_controls/);
  assert.match(common, /TARGET_MIGRATION=0014_supervised_conversation_ownership/);
  for (const version of ['0010_postiz_performance_monitoring', '0011_ghl_contact_sync', '0012_ghl_inbound_event_inbox', '0013_sales_knowledge_intelligence', '0014_supervised_conversation_ownership']) {
    assert.match(common, new RegExp(version));
  }
  assert.match(preflight, /less than 20 GiB/);
  assert.match(preflight, /assert_firewall_boundary/);
  assert.match(preflight, /assert_database_locked/);
  assert.match(preflight, /assert_public_boundary/);
  assert.match(preflight, /release-source checkout is dirty/);
  assert.match(deploy, /rollback_applied_migrations/);
  assert.match(deploy, /trap automatic_rollback EXIT/);
  assert.match(deploy, /n8n-container-ids\.before/);
  assert.match(deploy, /compose up -d --no-deps dashboard/);
  assert.doesNotMatch(deploy, /npm run db:(migrate|rollback)/);
  assert.match(validate, /external_operations/);
  assert.match(validate, /has_table_privilege\('tanaghom_n8n_worker','tanaghom\.conversations'/);
  assert.match(validate, /assert_protected_container_ids_unchanged/);
  assert.match(validate, /package-owned firewall state changed/);
  assert.match(validate, /Tanaghom Nginx configuration changed/);
  assert.match(rollback, /ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE/);
  assert.match(rollback, /applied-migrations/);
  assert.match(rollback, /awk '\{ lines\[NR\]=\$0 \} END/);
  assert.doesNotMatch(rollback, /for .+ in 1 2 3 4 5|seq 5|npm run db:rollback/);
  assert.match(backup, /ConvertFrom-SecureString/);
  assert.match(backup, /postgres:16\.14-alpine3\.24@sha256:[0-9a-f]{64}/);
  assert.match(backup, /pg_restore/);
  assert.match(backup, /RESTORE_VERIFIED=YES/);
  assert.match(disposableBackup, /openssl enc -aes-256-cbc -pbkdf2/);
  assert.match(disposableBackup, /postgres:16\.14-alpine3\.24@sha256:[0-9a-f]{64}/);
  assert.match(disposableBackup, /pg_restore/);
  assert.match(disposableBackup, /SELECT version FROM public\.schema_migrations/);
  assert.match(packageValidation, /sh -n/);
  assert.match(refusalPaths, /expected refusal unexpectedly succeeded/);
  assert.match(refusalPaths, /RESTORE_VERIFIED=NO/);
  assert.match(runbook, /not GitHub Actions CD/i);
  assert.match(runbook, /Production execution remains unauthorized/i);
  assert.match(runbook, /never blindly runs a fixed\s+number of rollbacks/i);

  const protectedScope = `${common}\n${preflight}\n${deploy}\n${validate}\n${rollback}`;
  assert.doesNotMatch(protectedScope, /systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)/i);
  assert.doesNotMatch(protectedScope, /docker (stop|restart|rm).*(smartlabs|n8n)/i);
  assert.doesNotMatch(protectedScope, /\/data\//);
  assert.doesNotMatch(`${protectedScope}\n${backup}`, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@/);
});
