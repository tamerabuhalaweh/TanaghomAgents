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

test('Phase 5C Conversation Intelligence worker is inactive, least privileged, and proposal-only', async () => {
  const workflow = JSON.parse(await readFile(new URL('../n8n/workflows/phase5/conversation-intelligence.v1.json', import.meta.url), 'utf8'));
  const generator = await readFile(new URL('../scripts/generate-phase5-workflows.mjs', import.meta.url), 'utf8');
  const integration = await readFile(new URL('../scripts/conversation-intelligence-workflow-integration.mjs', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
  const serialized = JSON.stringify(workflow);

  assert.equal(workflow.id, 'phase5ConversationIntelligenceV1');
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.find(node => node.type === 'n8n-nodes-base.scheduleTrigger')?.disabled, true);
  assert.ok(workflow.nodes.every(node => ![
    'n8n-nodes-base.webhook', 'n8n-nodes-base.executeCommand',
    'n8n-nodes-base.readWriteFile', 'n8n-nodes-base.ssh',
  ].includes(node.type)));
  assert.match(serialized, /https:\/\/api\.thesmartlabs\.net\/gemma4\/v1\/chat\/completions/);
  assert.doesNotMatch(serialized, /services\.leadconnectorhq\.com|postiz|\/conversations\/messages/i);
  for (const functionName of [
    'claim_ghl_inbound_event_job', 'prepare_conversation_intelligence',
    'persist_conversation_intelligence_proposal', 'record_ghl_inbound_event_failure',
  ]) assert.match(serialized, new RegExp(`tanaghom\\.${functionName}`));
  assert.equal((serialized.match(/tanaghom\.[a-z_]+/g) ?? []).length, 4);
  assert.match(serialized, /62000000-0000-4000-8000-000000000005/);
  assert.match(serialized, /Tanaghom Conversation PostgreSQL/);
  assert.match(serialized, /62000000-0000-4000-8000-000000000002/);
  assert.match(serialized, /Tanaghom Gemma API/);
  assert.match(serialized, /external_action_count/);
  assert.match(generator, /conversation-intelligence\.v1\.json/);
  assert.match(generator, /replace\(\/\\r\\n\/g, "\\n"\)/);
  assert.equal(serialized.includes('\\r'), false);
  assert.match(integration, /grounded English and Arabic escalation scenarios/);
  assert.match(integration, /gemma_invalid_json/);
  assert.match(integration, /gemma_contract_mismatch/);
  assert.match(integration, /gemma_rate_limited/);
  assert.match(integration, /gemma_overloaded/);
  assert.match(integration, /tanaghom_conversation_runtime/);
  assert.match(integration, /general_worker_member: false/);
  assert.match(integration, /proposal_table_access: false/);
  assert.match(integration, /external_operations/);
  assert.equal(manifest.scripts['test:phase5-conversation-workflow'], 'node scripts/conversation-intelligence-workflow-integration.mjs');
  assert.match(quality, /phase5-conversation-workflow-integration:/);
  assert.match(quality, /npm run test:phase5-conversation-workflow/);
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
  assert.match(quality, /test-disposable-backup\.sh "\$DATABASE_TEST_URL" 0025_runtime_agent_reconciliation/);
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

test('Phase 5F pinned n8n queue runtime is disposable, restart-tested, and alert-observable', async () => {
  const root = new URL('../deployment/phase5f-runtime-recovery/', import.meta.url);
  const compose = await readFile(new URL('docker-compose.yml', root), 'utf8');
  const workflow = JSON.parse(await readFile(new URL('fixtures/runtime-recovery-probe.v1.json', root), 'utf8'));
  const monitor = await readFile(new URL('scripts/runtime-monitor.mjs', root), 'utf8');
  const alertSink = await readFile(new URL('scripts/alert-sink.mjs', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  const integration = await readFile(new URL('../scripts/n8n-runtime-recovery-integration.mjs', import.meta.url), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
  const schema = JSON.parse(await readFile(new URL('../packages/contracts/schemas/phase5/n8n-runtime-recovery-evidence.v1.schema.json', import.meta.url), 'utf8'));

  assert.match(compose, /n8n:2\.26\.8@sha256:[0-9a-f]{64}/);
  assert.match(compose, /postgres:16\.14-alpine3\.24@sha256:[0-9a-f]{64}/);
  assert.match(compose, /redis:7\.2\.14-alpine3\.21@sha256:[0-9a-f]{64}/);
  assert.match(compose, /EXECUTIONS_MODE: queue/);
  assert.match(compose, /QUEUE_WORKER_LOCK_DURATION: "30000"/);
  assert.match(compose, /QUEUE_WORKER_LOCK_RENEW_TIME: "5000"/);
  assert.match(compose, /QUEUE_WORKER_STALLED_INTERVAL: "10000"/);
  assert.match(compose, /QUEUE_WORKER_MAX_STALLED_COUNT: "1"/);
  assert.match(compose, /QUEUE_HEALTH_CHECK_ACTIVE/);
  assert.match(compose, /N8N_METRICS: "true"/);
  assert.match(compose, /--appendonly yes/);
  assert.match(compose, /--maxmemory-policy noeviction/);
  assert.match(compose, /internal: true/);
  assert.doesNotMatch(compose, /ports:/);
  assert.match(compose, /\.\/scripts:\/runtime-scripts:ro/);
  assert.match(compose, /N8N_SSRF_PROTECTION_ENABLED: "true"/);
  assert.match(compose, /n8n-nodes-base\.executeCommand/);
  assert.match(compose, /n8n-nodes-base\.readWriteFile/);
  assert.match(compose, /n8n-nodes-base\.ssh/);

  assert.equal(workflow.active, false);
  assert.equal(workflow.id, 'phase5RuntimeRecoveryProbeV1');
  assert.deepEqual(workflow.nodes.map((node) => node.type).sort(), ['n8n-nodes-base.code', 'n8n-nodes-base.webhook']);
  assert.equal(workflow.nodes.some((node) => node.credentials), false);
  assert.match(JSON.stringify(workflow), /external_action_count/);

  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.boundaries.properties.smartlabs_touched.const, false);
  assert.equal(schema.properties.monitoring.properties.production_destination_configured.const, false);
  assert.match(integration, /compose\("kill", "-s", "KILL", "n8n-worker"\)/);
  assert.match(integration, /"publish:workflow"/);
  assert.doesNotMatch(integration, /update:workflow/);
  assert.match(integration, /mode: 0o700/);
  assert.equal((integration.match(/mode: 0o644/g) || []).length, 3);
  assert.match(integration, /compose\("stop", "-t", "5", "redis"\)/);
  assert.match(integration, /queueKeysAfterRestart/);
  assert.match(integration, /same_execution_id_recovered: false/);
  assert.match(integration, /correlation_id_replayed: true/);
  assert.match(integration, /logical_work_unrecovered: 0/);
  assert.match(integration, /provider_calls: 0/);
  assert.match(integration, /smartlabs_touched: false/);
  assert.match(integration, /disposable compose status/);
  assert.match(integration, /disposable service logs/);
  assert.match(monitor, /phase5\.runtime-alert\.v1/);
  assert.match(monitor, /n8n_worker_unready/);
  assert.match(alertSink, /TANAGHOM_ALERT_SINK_FILE/);
  assert.match(alertSink, /appendFile/);
  assert.match(quality, /name: phase5-n8n-runtime-recovery-evidence/);
  assert.match(runbook, /does not authorize a GPU-server test/);
  assert.match(runbook, /Never run this package's\s+`docker compose down --volumes` command against `smartlabs-n8n`/);
});

test('Phase 5F retention is measured, built-in, restorable, and SmartLabs-isolated', async () => {
  const root = new URL('../deployment/phase5f-retention/', import.meta.url);
  const compose = await readFile(new URL('docker-compose.yml', root), 'utf8');
  const policy = await readFile(new URL('retention-policy.env', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  const integration = await readFile(new URL('../scripts/n8n-retention-pruning-integration.mjs', import.meta.url), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
  const schema = JSON.parse(await readFile(new URL('../packages/contracts/schemas/phase5/n8n-retention-pruning-evidence.v1.schema.json', import.meta.url), 'utf8'));

  assert.match(compose, /EXECUTIONS_DATA_PRUNE:/);
  assert.match(compose, /EXECUTIONS_DATA_PRUNE_MAX_COUNT:/);
  assert.match(compose, /EXECUTIONS_DATA_HARD_DELETE_BUFFER: "0"/);
  assert.match(compose, /EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL: "1"/);
  assert.match(compose, /EXECUTIONS_DATA_PRUNE_SOFT_DELETE_INTERVAL: "1"/);
  assert.doesNotMatch(compose, /ports:/);
  assert.match(policy, /EXECUTIONS_DATA_MAX_AGE=168/);
  assert.match(policy, /EXECUTIONS_DATA_PRUNE_MAX_COUNT=10000/);
  assert.match(policy, /EXECUTIONS_DATA_SAVE_ON_PROGRESS=false/);

  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.boundaries.properties.gpu_server_contacted.const, false);
  assert.equal(schema.properties.boundaries.properties.smartlabs_touched.const, false);
  assert.equal(schema.properties.postgres.properties.physical_file_shrink_claimed.const, false);
  assert.equal(schema.properties.redis.properties.manual_queue_key_deletion_performed.const, false);
  assert.equal(schema.properties.backup_restore.properties.in_place_undelete_claimed.const, false);
  assert.equal(schema.properties.proposed_policy.properties.production_applied.const, false);
  assert.equal(schema.properties.projections.properties.fixed_75000_lead_sla_claimed.const, false);

  assert.match(integration, /phase5\.n8n-retention-pruning-evidence\.v1/);
  assert.match(integration, /createCipheriv\("aes-256-gcm"/);
  assert.match(integration, /pg_dump/);
  assert.match(integration, /pg_restore/);
  assert.match(integration, /BGREWRITEAOF/);
  assert.match(integration, /VACUUM \(ANALYZE\) execution_entity/);
  assert.doesNotMatch(integration, /VACUUM FULL/);
  assert.doesNotMatch(integration, /FLUSHDB|FLUSHALL/);
  assert.doesNotMatch(integration, /redis-cli\s+DEL/);
  assert.match(integration, /gpu_server_contacted: false/);
  assert.match(integration, /smartlabs_touched: false/);
  assert.match(integration, /physical_file_shrink_claimed: false/);
  assert.match(integration, /in_place_undelete_claimed: false/);

  assert.match(runbook, /does \*\*not\*\*\s+authorize a GPU-server connection/);
  assert.match(runbook, /inspection or modification of a SmartLabs file/);
  assert.match(runbook, /cannot be undeleted in place/);
  assert.match(runbook, /ordinary `VACUUM`/);
  assert.match(runbook, /separately approved by Tamer/);
  assert.match(quality, /name: phase5-n8n-retention-pruning-evidence/);
  assert.match(quality, /N8N_RETENTION_PAYLOAD_BYTES: 16384/);
});

test('Phase 5F abrupt dependency loss is durable, exact-once, observed, and SmartLabs-isolated', async () => {
  const root = new URL('../deployment/phase5f-dependency-loss/', import.meta.url);
  const compose = await readFile(new URL('docker-compose.yml', root), 'utf8');
  const observer = await readFile(new URL('scripts/dependency-observer.mjs', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  const integration = await readFile(new URL('../scripts/n8n-dependency-loss-integration.mjs', import.meta.url), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
  const schema = JSON.parse(await readFile(new URL('../packages/contracts/schemas/phase5/n8n-dependency-loss-evidence.v1.schema.json', import.meta.url), 'utf8'));

  assert.match(compose, /n8n:2\.26\.8@sha256:[0-9a-f]{64}/);
  assert.match(compose, /entrypoint: \["node"\]/);
  assert.match(compose, /cap_drop:\s+\- ALL/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /read_only: true/);
  assert.doesNotMatch(compose, /ports:/);
  assert.match(observer, /redis_unavailable/);
  assert.match(observer, /postgres_unavailable/);
  assert.match(observer, /deliveredDependencyAlerts/);
  assert.match(observer, /\["redis_unavailable", "postgres_unavailable"\]/);

  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.boundaries.properties.provider_calls.const, 0);
  assert.equal(schema.properties.boundaries.properties.external_actions.const, 0);
  assert.equal(schema.properties.boundaries.properties.gpu_server_contacted.const, false);
  assert.equal(schema.properties.boundaries.properties.smartlabs_touched.const, false);
  assert.equal(schema.properties.monitoring.properties.independent_observer_required.const, true);
  assert.equal(schema.$defs.lossResultRedis.properties.container_exit_code.const, 137);
  assert.equal(schema.$defs.lossResultPostgres.properties.container_exit_code.const, 137);

  assert.match(integration, /compose\("kill", "-s", "KILL", "redis"\)/);
  assert.match(integration, /compose\("kill", "-s", "KILL", "postgres"\)/);
  assert.equal((integration.match(/=== 137/g) || []).length, 2);
  assert.match(integration, /DB loaded from append only file/);
  assert.match(integration, /database system was interrupted\|automatic recovery in progress\|redo starts at/);
  assert.match(integration, /assertCorrelations\("redis-loss"/);
  assert.match(integration, /assertCorrelations\("postgres-loss"/);
  assert.match(integration, /provider_calls: 0/);
  assert.match(integration, /external_actions: 0/);
  assert.match(integration, /gpu_server_contacted: false/);
  assert.match(integration, /smartlabs_touched: false/);
  assert.doesNotMatch(integration, /ssh|38\.247\.187\.232|thesmartlabs/i);
  assert.match(runbook, /does \*\*not\*\* authorize a\s+GPU-server connection/);
  assert.match(runbook, /native main readiness detected PostgreSQL loss but remained ready/);
  assert.match(runbook, /Never point this harness at another Compose project/);
  assert.match(quality, /name: phase5-n8n-dependency-loss-evidence/);
  assert.match(quality, /N8N_DEPENDENCY_REDIS_EXECUTIONS: 20/);
  assert.match(quality, /N8N_DEPENDENCY_POSTGRES_EXECUTIONS: 20/);
});

test('Phase 5F monitoring destinations default locked and preserve least privilege', async () => {
  const up = await readFile(new URL('../packages/database/migrations/0019_notification_monitoring_destinations.up.sql', import.meta.url), 'utf8');
  const down = await readFile(new URL('../packages/database/migrations/0019_notification_monitoring_destinations.down.sql', import.meta.url), 'utf8');
  const assertion = await readFile(new URL('../packages/database/tests/notification_monitoring_destinations.sql', import.meta.url), 'utf8');
  const databaseTest = await readFile(new URL('../scripts/database-test.mjs', import.meta.url), 'utf8');
  assert.match(up, /runtime_ready boolean NOT NULL DEFAULT false/);
  assert.match(up, /emergency_stop boolean NOT NULL DEFAULT true/);
  assert.match(up, /channel IN \('email','slack','whatsapp'\)/);
  assert.match(up, /target_ciphertext bytea NOT NULL/);
  assert.match(up, /REVOKE ALL ON tanaghom\.notification_delivery_controls,tanaghom\.notification_destinations/);
  assert.match(up, /GRANT SELECT,INSERT,UPDATE,DELETE ON tanaghom\.notification_destinations\s+TO tanaghom_api/);
  assert.doesNotMatch(up, /GRANT .*notification_destinations.*tanaghom_n8n_worker/);
  assert.match(down, /delete customer notification destinations before rolling back 0019/);
  assert.match(assertion, /notification delivery did not start locked/);
  assert.match(assertion, /has_table_privilege\('tanaghom_api','tanaghom\.notification_delivery_controls','UPDATE'\)/);
  assert.match(databaseTest, /notification_monitoring_destinations\.sql/);
});

test('Phase 5D production update is manual, transactional, scoped, and recoverable', async () => {
  const root = new URL('../deployment/phase5d-production-update/', import.meta.url);
  const common = await readFile(new URL('scripts/common.sh', root), 'utf8');
  const preflight = await readFile(new URL('scripts/preflight.sh', root), 'utf8');
  const deploy = await readFile(new URL('scripts/deploy-update.sh', root), 'utf8');
  const validate = await readFile(new URL('scripts/validate-release.sh', root), 'utf8');
  const rollback = await readFile(new URL('scripts/rollback-update.sh', root), 'utf8');
  const backup = await readFile(new URL('scripts/prepare-offserver-backup.ps1', root), 'utf8');
  const sharedBackup = await readFile(new URL('../deployment/production-database-backup/prepare-offserver-backup.ps1', import.meta.url), 'utf8');
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
  assert.match(preflight, /superseded: use deployment\/phase5f-database-bridge/);
  assert.match(backup, /superseded by deployment\/phase5f-database-bridge/);
  assert.match(sharedBackup, /ConvertFrom-SecureString/);
  assert.match(sharedBackup, /postgres:17\.6-alpine3\.22@sha256:[0-9a-f]{64}/);
  assert.match(sharedBackup, /pg_restore/);
  assert.match(sharedBackup, /RESTORE_VERIFIED=YES/);
  assert.match(disposableBackup, /openssl enc -aes-256-cbc -pbkdf2/);
  assert.match(disposableBackup, /postgres:16\.14-alpine3\.24@sha256:[0-9a-f]{64}/);
  assert.match(disposableBackup, /pg_restore/);
  assert.match(disposableBackup, /SELECT version FROM public\.schema_migrations/);
  assert.match(packageValidation, /sh -n/);
  assert.match(refusalPaths, /expected refusal unexpectedly succeeded/);
  assert.match(refusalPaths, /RESTORE_VERIFIED=NO/);
  assert.match(runbook, /not GitHub Actions CD/i);
  assert.match(runbook, /superseded/i);
  assert.match(runbook, /Production execution remains unauthorized/i);
  assert.match(runbook, /never blindly runs a fixed\s+number of rollbacks/i);

  const protectedScope = `${common}\n${preflight}\n${deploy}\n${validate}\n${rollback}`;
  assert.doesNotMatch(protectedScope, /systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)/i);
  assert.doesNotMatch(protectedScope, /docker (stop|restart|rm).*(smartlabs|n8n)/i);
  assert.doesNotMatch(protectedScope, /\/data\//);
  assert.doesNotMatch(`${protectedScope}\n${backup}`, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@/);
});

test('Phase 5F production update is manual, exact, data-preserving, and SmartLabs-isolated', async () => {
  const root = new URL('../deployment/phase5f-production-update/', import.meta.url);
  const common = await readFile(new URL('scripts/common.sh', root), 'utf8');
  const preflight = await readFile(new URL('scripts/preflight.sh', root), 'utf8');
  const deploy = await readFile(new URL('scripts/deploy-update.sh', root), 'utf8');
  const validate = await readFile(new URL('scripts/validate-release.sh', root), 'utf8');
  const rollback = await readFile(new URL('scripts/rollback-update.sh', root), 'utf8');
  const backup = await readFile(new URL('scripts/prepare-offserver-backup.ps1', root), 'utf8');
  const sharedBackup = await readFile(new URL('../deployment/production-database-backup/prepare-offserver-backup.ps1', import.meta.url), 'utf8');
  const lifecycle = await readFile(new URL('scripts/test-disposable-lifecycle.sh', root), 'utf8');
  const packageValidation = await readFile(new URL('scripts/validate-package.sh', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');

  assert.match(common, /YES-I-AM-THE-AUTHORIZED-OWNER/);
  assert.match(common, /EXPECTED_START_MIGRATION=0014_supervised_conversation_ownership/);
  assert.match(common, /TARGET_MIGRATION=0019_notification_monitoring_destinations/);
  for (const version of ['0015_governed_ghl_actions', '0016_ghl_action_review_reconciliation', '0017_ghl_service_action_audit_attribution', '0018_conversation_capacity_backpressure', '0019_notification_monitoring_destinations']) {
    assert.match(common, new RegExp(version));
  }
  assert.match(common, /ghl_action_approvals/);
  assert.match(common, /a GHL action policy differs from its release default/);
  assert.match(common, /a capacity policy differs from its release default/);
  assert.match(preflight, /less than 20 GiB/);
  assert.match(preflight, /assert_database_at_start/);
  assert.match(preflight, /release-source checkout is dirty/);
  assert.match(deploy, /rollback_applied_migrations/);
  assert.match(deploy, /trap automatic_rollback EXIT/);
  assert.match(deploy, /assert_release_tables_empty/);
  assert.match(deploy, /compose up -d --no-deps dashboard/);
  assert.doesNotMatch(deploy, /npm run db:(migrate|rollback)/);
  assert.match(validate, /runtime_ready IS NOT FALSE OR emergency_stop IS NOT TRUE/);
  assert.match(validate, /has_table_privilege\('tanaghom_n8n_worker','tanaghom\.notification_destinations'/);
  assert.match(validate, /assert_protected_container_ids_unchanged/);
  assert.match(rollback, /ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE/);
  assert.match(rollback, /assert_release_tables_empty/);
  assert.match(rollback, /awk '\{ lines\[NR\]=\$0 \} END/);
  assert.doesNotMatch(rollback, /for .+ in 1 2 3 4 5|seq 5|npm run db:rollback/);
  assert.match(backup, /production-database-backup\\prepare-offserver-backup\.ps1/);
  assert.match(sharedBackup, /postgres:17\.6-alpine3\.22@sha256:[0-9a-f]{64}/);
  assert.match(sharedBackup, /docker run --rm --name \$sourceContainer/);
  assert.match(sharedBackup, /--network none/);
  assert.match(sharedBackup, /ConvertFrom-SecureString/);
  assert.match(sharedBackup, /RESTORE_VERIFIED=YES/);
  assert.match(lifecycle, /rollback unexpectedly accepted customer notification data/);
  assert.match(lifecycle, /0019_notification_monitoring_destinations\.down\.sql/);
  assert.match(packageValidation, /sh -n/);
  assert.match(runbook, /No deployment is authorized by this document/);
  assert.match(runbook, /Do not delete records to force the downgrade/);
  assert.match(runbook, /only the Tanaghom dashboard/);

  const protectedScope = `${common}\n${preflight}\n${deploy}\n${validate}\n${rollback}`;
  assert.doesNotMatch(protectedScope, /systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)/i);
  assert.doesNotMatch(protectedScope, /docker (stop|restart|rm).*(smartlabs|n8n)/i);
  assert.doesNotMatch(protectedScope, /\/data\//);
  assert.doesNotMatch(`${protectedScope}\n${backup}`, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@/);
});

test('Phase 5G production update is exact, quality-evidence-preserving, and Tanaghom-only', async () => {
  const root = new URL('../deployment/phase5g-production-update/', import.meta.url);
  const common = await readFile(new URL('scripts/common.sh', root), 'utf8');
  const preflight = await readFile(new URL('scripts/preflight.sh', root), 'utf8');
  const deploy = await readFile(new URL('scripts/deploy-update.sh', root), 'utf8');
  const validate = await readFile(new URL('scripts/validate-release.sh', root), 'utf8');
  const rollback = await readFile(new URL('scripts/rollback-update.sh', root), 'utf8');
  const backup = await readFile(new URL('scripts/prepare-offserver-backup.ps1', root), 'utf8');
  const lifecycle = await readFile(new URL('scripts/test-disposable-lifecycle.sh', root), 'utf8');
  const packageValidation = await readFile(new URL('scripts/validate-package.sh', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  const sharedBackup = await readFile(new URL('../deployment/production-database-backup/prepare-offserver-backup.ps1', import.meta.url), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

  assert.match(common, /EXPECTED_START_MIGRATION=0019_notification_monitoring_destinations/);
  assert.match(common, /TARGET_MIGRATION=0020_quality_rollout_control/);
  assert.match(common, /PENDING_MIGRATIONS='0020_quality_rollout_control'/);
  assert.match(common, /assert_quality_tables_safe_to_drop/);
  assert.match(common, /sub\(\/\\r\$\//);
  assert.doesNotMatch(common, /PENDING_MIGRATIONS='[^']*001[5-9]_/);
  assert.match(preflight, /assert_database_at_start/);
  assert.match(preflight, /less than 20 GiB/);
  assert.match(deploy, /trap automatic_rollback EXIT/);
  assert.match(deploy, /assert_quality_tables_safe_to_drop/);
  assert.match(deploy, /compose up -d --no-deps dashboard/);
  assert.doesNotMatch(deploy, /npm run db:(migrate|rollback)/);
  assert.match(validate, /quality_rollout_policies/);
  assert.match(validate, /api\/quality/);
  assert.match(validate, /has_table_privilege\('tanaghom_n8n_worker','tanaghom\.quality_rollout_policies'/);
  assert.match(rollback, /ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE/);
  assert.match(rollback, /assert_quality_tables_safe_to_drop/);
  assert.match(backup, /ExpectedMigration = '0019_notification_monitoring_destinations'/);
  assert.match(backup, /-ExpectedMigration \$ExpectedMigration/);
  assert.match(sharedBackup, /\(phase5\[fg\]\|phase6\)-\\d\{8\}T\\d\{6\}Z/);
  assert.match(lifecycle, /0020 rollback unexpectedly accepted quality evidence/);
  assert.match(lifecycle, /count\(\*\) FROM tanaghom\.notification_destinations/);
  assert.match(packageValidation, /sh -n/);
  assert.match(runbook, /No deployment is authorized by this document/);
  assert.match(runbook, /Existing data from migrations 0001–0019 is preserved/);
  assert.match(runbook, /Do not delete records to force the downgrade/);
  assert.match(quality, /phase5g-production-update-contract/);

  const protectedScope = `${common}\n${preflight}\n${deploy}\n${validate}\n${rollback}`;
  assert.doesNotMatch(protectedScope, /systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)/i);
  assert.doesNotMatch(protectedScope, /docker (stop|restart|rm).*(smartlabs|n8n)/i);
  assert.doesNotMatch(protectedScope, /\/data\/|\/opt\/(smartlabs|n8n-smartlabs)/i);
  assert.doesNotMatch(`${protectedScope}\n${backup}`, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@/);
});

test('Phase 5G shadow production update is exact, inactive, reversible, and existing-workflow preserving', async () => {
  const root = new URL('../deployment/phase5g-shadow-production-update/', import.meta.url);
  const common = await readFile(new URL('scripts/common.sh', root), 'utf8');
  const preflight = await readFile(new URL('scripts/preflight.sh', root), 'utf8');
  const deploy = await readFile(new URL('scripts/deploy-update.sh', root), 'utf8');
  const validate = await readFile(new URL('scripts/validate-release.sh', root), 'utf8');
  const rollback = await readFile(new URL('scripts/rollback-update.sh', root), 'utf8');
  const databaseLifecycle = await readFile(new URL('scripts/test-disposable-lifecycle.sh', root), 'utf8');
  const workflowLifecycle = await readFile(new URL('scripts/test-disposable-workflow-lifecycle.sh', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

  assert.match(common, /EXPECTED_START_MIGRATION=0020_quality_rollout_control/);
  assert.match(common, /TARGET_MIGRATION=0021_quality_baseline_shadow_pipeline/);
  assert.match(common, /WORKFLOW_ID=phase5gQualityShadowEvaluatorV1/);
  assert.match(common, /N8N_EXPECTED_VERSION=2\.26\.8/);
  assert.match(common, /assert_existing_workflows_unchanged/);
  assert.match(common, /\/home\/node\/tanaghom-workflows-/);
  assert.match(common, /docker exec -u node .* test -s "\$remote"/);
  assert.match(common, /docker cp .*"\$destination"/);
  assert.match(common, /DELETE FROM workflow_entity WHERE id=/);
  assert.match(preflight, /assert_workflow_absent/);
  assert.match(preflight, /validate_workflow_source/);
  assert.match(deploy, /import:workflow --input=.*--activeState=false/);
  assert.match(deploy, /workflow_remote="\/home\/node\//);
  assert.match(deploy, /docker exec -u root .* test -s "\$workflow_remote"/);
  assert.match(deploy, /docker exec -u node .* test -r "\$workflow_remote"/);
  assert.match(deploy, /docker exec -u node .* rm -f "\$workflow_remote"/);
  assert.doesNotMatch(deploy, /docker exec -u root .* rm -f "\$workflow_remote"/);
  assert.match(deploy, /ROLLBACK_CLEANUP_FAILED=YES/);
  assert.match(deploy, /if test "\$rollback_failed" -eq 0; then rollback_applied_migrations/);
  assert.match(deploy, /n8n audit/);
  assert.match(deploy, /trap automatic_rollback EXIT/);
  assert.ok(deploy.indexOf('trap automatic_rollback EXIT') < deploy.indexOf('capture_protected_container_ids'), 'failure trap must precede evidence capture');
  assert.match(common, /workflow_execution_count/);
  assert.match(validate, /has_function_privilege\('tanaghom_n8n_worker','tanaghom\.claim_quality_shadow_job\(\)'/);
  assert.match(rollback, /ROLLBACK-THE-AUTHORIZED-TANAGHOM-SHADOW-RELEASE/);
  assert.match(rollback, /delete_quality_workflow/);
  assert.match(databaseLifecycle, /0021 rollback unexpectedly accepted metric evidence/);
  assert.match(workflowLifecycle, /host-copied, container-imported inactive, container-exported, host-verified, audited, and transactionally removed exactly one zero-execution shadow workflow/);
  assert.match(workflowLifecycle, /docker cp .*quality-shadow-evaluator\.v1\.json.*\$n8n_container:\$container_import/);
  assert.match(workflowLifecycle, /docker exec -u node .* rm -f "\$container_import"/);
  assert.match(workflowLifecycle, /docker cp "\$n8n_container:\$container_export"/);
  assert.match(runbook, /No deployment is authorized by this document/);
  assert.match(runbook, /does not execute the workflow/i);
  assert.match(runbook, /preserve its evidence directory unchanged/i);
  assert.match(quality, /phase5g-shadow-production-update-contract/);

  const protectedScope = `${common}\n${preflight}\n${deploy}\n${validate}\n${rollback}`;
  assert.doesNotMatch(protectedScope, /systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)/i);
  assert.doesNotMatch(protectedScope, /docker (stop|restart|rm).*(smartlabs|gemma|voice|smartcc)/i);
  assert.doesNotMatch(protectedScope, /\/opt\/(smartlabs|n8n-smartlabs)|\/data\//i);
  assert.doesNotMatch(protectedScope, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@/);
});

test('Phase 5C Conversation Intelligence production update is least-privileged, inactive, and exactly reversible', async () => {
  const root = new URL('../deployment/phase5c-conversation-worker-production-update/', import.meta.url);
  const common = await readFile(new URL('scripts/common.sh', root), 'utf8');
  const preflight = await readFile(new URL('scripts/preflight.sh', root), 'utf8');
  const deploy = await readFile(new URL('scripts/deploy-update.sh', root), 'utf8');
  const validate = await readFile(new URL('scripts/validate-release.sh', root), 'utf8');
  const rollback = await readFile(new URL('scripts/rollback-update.sh', root), 'utf8');
  const databaseLifecycle = await readFile(new URL('scripts/test-disposable-lifecycle.sh', root), 'utf8');
  const n8nLifecycle = await readFile(new URL('scripts/test-disposable-n8n-lifecycle.sh', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

  assert.match(common, /EXPECTED_START_MIGRATION=0023_campaign_lifecycle/);
  assert.match(common, /TARGET_MIGRATION=0024_conversation_intelligence_worker_registry/);
  assert.match(common, /RUNTIME_ROLE=tanaghom_conversation_runtime/);
  assert.match(common, /CREDENTIAL_ID=62000000-0000-4000-8000-000000000005/);
  assert.match(common, /REVIEWED_DIRTY_PATH=deployment\/phase4-postiz-activation\/egress\/squid\.conf/);
  assert.match(common, /REVIEWED_DIRTY_DIFF_SHA256=94733679d940cc704f568fac6b488c4001638a39336ec843dd99306a64044c5d/);
  assert.match(common, /assert_production_worktree_unchanged/);
  assert.match(common, /has_table_privilege\('\$RUNTIME_ROLE','tanaghom\.conversation_intelligence_proposals'/);
  assert.match(common, /has_function_privilege\('\$RUNTIME_ROLE','\$signature','EXECUTE'/);
  assert.match(common, /DELETE FROM shared_credentials/);
  assert.match(preflight, /assert_credential_absent/);
  assert.match(preflight, /assert_workflow_absent/);
  assert.match(preflight, /assert_production_worktree_reviewed/);
  assert.match(preflight, /Gemma credential is unavailable/);
  assert.match(deploy, /openssl rand -hex 32/);
  assert.match(deploy, /import:credentials/);
  assert.match(deploy, /docker exec -i -u node .* cat > .*credential_remote/);
  assert.doesNotMatch(deploy, /chown node:node "\$credential_remote"/);
  assert.match(deploy, /test -r "\$credential_remote"/);
  assert.match(deploy, /import:workflow --input=.*--activeState=false/);
  assert.match(deploy, /rm -f "\$secret_file" "\$role_sql" "\$credential_json" "\$connection_env" "\$pgpass_file"/);
  assert.match(deploy, /runtime-authentication\.txt/);
  assert.match(deploy, /authenticate_runtime_role_with_retry/);
  assert.match(deploy, /WITH updated AS \(UPDATE .* SELECT count\(\*\) FROM updated/);
  assert.match(rollback, /WITH updated AS \(UPDATE .* SELECT count\(\*\) FROM updated/);
  assert.match(common, /TANAGHOM_RUNTIME_AUTH_ATTEMPTS:-24/);
  assert.match(common, /runtime authentication attempt count is outside 1\.\.60/);
  assert.match(deploy, /n8n audit/);
  assert.match(deploy, /trap automatic_rollback EXIT/);
  assert.match(validate, /inactive-zero-execution/);
  assert.match(validate, /external_operations/);
  assert.match(validate, /assert_production_worktree_unchanged/);
  assert.match(rollback, /ROLLBACK-THE-AUTHORIZED-CONVERSATION-WORKER-RELEASE/);
  assert.match(databaseLifecycle, /0024 rollback unexpectedly accepted an imported runtime/);
  assert.match(n8nLifecycle, /one encrypted credential and one inactive zero-execution workflow/);
  assert.match(runbook, /does \*\*not\*\* authorize production execution/);
  assert.match(runbook, /does not activate a workflow/i);
  assert.match(quality, /phase5c-conversation-worker-production-update-contract/);

  const protectedScope = `${common}\n${preflight}\n${deploy}\n${validate}\n${rollback}`;
  assert.doesNotMatch(protectedScope, /systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)/i);
  assert.doesNotMatch(protectedScope, /docker (stop|restart|rm).*(smartlabs|gemma|voice|smartcc)/i);
  assert.doesNotMatch(protectedScope, /\/opt\/(smartlabs|n8n-smartlabs)|\/data\//i);
  assert.doesNotMatch(protectedScope, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@/);
});

test('Phase 6 Agent Registry production update is exact, inactive, reversible, and Tanaghom-only', async () => {
  const root = new URL('../deployment/phase6-agent-registry-production-update/', import.meta.url);
  const common = await readFile(new URL('scripts/common.sh', root), 'utf8');
  const preflight = await readFile(new URL('scripts/preflight.sh', root), 'utf8');
  const deploy = await readFile(new URL('scripts/deploy-update.sh', root), 'utf8');
  const validate = await readFile(new URL('scripts/validate-release.sh', root), 'utf8');
  const rollback = await readFile(new URL('scripts/rollback-update.sh', root), 'utf8');
  const backup = await readFile(new URL('scripts/prepare-offserver-backup.ps1', root), 'utf8');
  const lifecycle = await readFile(new URL('scripts/test-disposable-lifecycle.sh', root), 'utf8');
  const packageValidation = await readFile(new URL('scripts/validate-package.sh', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

  assert.match(common, /EXPECTED_START_MIGRATION=0021_quality_baseline_shadow_pipeline/);
  assert.match(common, /TARGET_MIGRATION=0022_agent_registry/);
  assert.match(common, /PENDING_MIGRATIONS='0022_agent_registry'/);
  assert.match(common, /assert_agent_registry_safe_to_drop/);
  assert.match(common, /campaign_strategist,content_producer,publisher_monitor,sales_crm/);
  assert.match(common, /campaign_content_generator,campaign_strategy_generator,ghl_contact_sync,governed_ghl_actions,postiz_draft_publisher,postiz_performance_monitor,quality_shadow_evaluator/);
  assert.match(preflight, /assert_database_at_start/);
  assert.match(preflight, /less than 20 GiB/);
  assert.match(deploy, /trap automatic_rollback EXIT/);
  assert.match(deploy, /assert_agent_registry_safe_to_drop/);
  assert.match(deploy, /compose up -d --no-deps dashboard/);
  assert.doesNotMatch(deploy, /npm run db:(migrate|rollback)/);
  assert.match(validate, /count\(\*\) FROM tanaghom\.agent_role_registry/);
  assert.match(validate, /count\(\*\) FROM tanaghom\.agent_workflow_registry/);
  assert.match(validate, /runtime_state='active'/);
  assert.match(validate, /has_table_privilege\('tanaghom_n8n_worker','tanaghom\.agent_workflow_registry'/);
  assert.match(validate, /has_table_privilege\('tanaghom_api','tanaghom\.agent_workflow_registry','SELECT'/);
  assert.match(rollback, /ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE/);
  assert.match(rollback, /assert_agent_registry_safe_to_drop/);
  assert.match(backup, /ExpectedMigration = '0021_quality_baseline_shadow_pipeline'/);
  assert.match(lifecycle, /0022 rollback guard unexpectedly accepted modified registry evidence/);
  assert.match(lifecycle, /count\(\*\) FROM tanaghom\.quality_evaluation_snapshots/);
  assert.match(packageValidation, /sh -n/);
  assert.match(runbook, /No deployment is authorized by this document/);
  assert.match(runbook, /only the Tanaghom dashboard image\/container/i);
  assert.match(runbook, /does not import, activate, execute, or edit an n8n workflow/i);
  assert.match(quality, /phase6-agent-registry-production-update-contract/);

  const protectedScope = `${common}\n${preflight}\n${deploy}\n${validate}\n${rollback}`;
  assert.doesNotMatch(protectedScope, /systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)/i);
  assert.doesNotMatch(protectedScope, /docker (stop|restart|rm).*(smartlabs|n8n)/i);
  assert.doesNotMatch(protectedScope, /\/data\/|\/opt\/(smartlabs|n8n-smartlabs)/i);
  assert.doesNotMatch(`${protectedScope}\n${backup}`, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@/);
});

test('Phase 6 Campaign Lifecycle production update is exact, mutation-guarded, reversible, and Tanaghom-only', async () => {
  const root = new URL('../deployment/phase6-campaign-lifecycle-production-update/', import.meta.url);
  const common = await readFile(new URL('scripts/common.sh', root), 'utf8');
  const preflight = await readFile(new URL('scripts/preflight.sh', root), 'utf8');
  const deploy = await readFile(new URL('scripts/deploy-update.sh', root), 'utf8');
  const validate = await readFile(new URL('scripts/validate-release.sh', root), 'utf8');
  const rollback = await readFile(new URL('scripts/rollback-update.sh', root), 'utf8');
  const dashboardRollback = await readFile(new URL('scripts/rollback-dashboard-only.sh', root), 'utf8');
  const resumePreflight = await readFile(new URL('scripts/resume-preflight.sh', root), 'utf8');
  const resume = await readFile(new URL('scripts/resume-update.sh', root), 'utf8');
  const backup = await readFile(new URL('scripts/prepare-offserver-backup.ps1', root), 'utf8');
  const lifecycle = await readFile(new URL('scripts/test-disposable-lifecycle.sh', root), 'utf8');
  const packageValidation = await readFile(new URL('scripts/validate-package.sh', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

  assert.match(common, /EXPECTED_START_MIGRATION=0022_agent_registry/);
  assert.match(common, /TARGET_MIGRATION=0023_campaign_lifecycle/);
  assert.match(common, /PENDING_MIGRATIONS='0023_campaign_lifecycle'/);
  assert.match(common, /campaign_lifecycle_fingerprint/);
  assert.match(common, /assert_campaign_lifecycle_unchanged/);
  assert.match(common, /agent_registry_fingerprint/);
  assert.match(common, /assert_agent_registry_unchanged/);
  assert.doesNotMatch(common, /updated_at<>created_at/);
  assert.match(common, /content_item_target<>2/);
  assert.match(common, /PRESERVED_RELATIVE_PATH=deployment\/phase4-postiz-activation\/egress\/squid\.conf/);
  assert.match(common, /assert_preserved_path_stable/);
  assert.match(common, /assert_production_checkout_at/);
  assert.match(common, /TANAGHOM_PRESERVED_FILE_SHA256/);
  assert.match(preflight, /assert_database_at_start/);
  assert.match(preflight, /assert_preserved_path_stable/);
  assert.match(preflight, /less than 20 GiB/);
  assert.match(deploy, /trap automatic_rollback EXIT/);
  assert.match(deploy, /campaign-lifecycle\.before\.md5/);
  assert.match(deploy, /assert_campaign_lifecycle_unchanged/);
  assert.match(deploy, /capture_agent_registry_fingerprint/);
  assert.match(deploy, /\( assert_agent_registry_unchanged/);
  assert.match(deploy, /ROLLBACK_FAILED=YES/);
  assert.match(deploy, /preserved-squid\.before\.sha256/);
  assert.match(deploy, /assert_preserved_file_unchanged/);
  assert.match(deploy, /compose up -d --no-deps dashboard/);
  assert.doesNotMatch(deploy, /npm run db:(migrate|rollback)/);
  assert.match(validate, /create_campaign_draft/);
  assert.match(validate, /has_function_privilege\('tanaghom_n8n_worker'/);
  assert.match(validate, /agent_jobs_one_open_core_job_per_campaign_idx/);
  assert.match(validate, /api\/campaigns/);
  assert.match(validate, /assert_preserved_file_unchanged/);
  assert.match(rollback, /ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE/);
  assert.match(rollback, /assert_campaign_lifecycle_unchanged/);
  assert.match(dashboardRollback, /ROLLBACK-THE-AUTHORIZED-TANAGHOM-DASHBOARD/);
  assert.match(dashboardRollback, /DATABASE_MIGRATION_PRESERVED/);
  assert.match(resumePreflight, /RESUME-THE-REVIEWED-TANAGHOM-RELEASE/);
  assert.match(resumePreflight, /assert_database_at_target/);
  assert.match(resumePreflight, /already applied/);
  assert.match(resume, /RESUMED_FROM_RELEASE_ID/);
  assert.match(resume, /capture_agent_registry_fingerprint/);
  assert.match(resume, /compose up -d --no-deps dashboard/);
  assert.doesNotMatch(resume, /db_file|\.down\.sql/);
  assert.match(backup, /ExpectedMigration = '0022_agent_registry'/);
  assert.match(lifecycle, /campaign lifecycle fingerprint did not detect a governed mutation/);
  assert.match(lifecycle, /external_operations/);
  assert.match(packageValidation, /sh -n/);
  assert.match(runbook, /No deployment is authorized by this document/);
  assert.match(runbook, /only the Tanaghom dashboard image\/container/i);
  assert.match(runbook, /does not import, activate, execute, or edit an n8n workflow/i);
  assert.match(runbook, /dashboard-only rollback/i);
  assert.match(runbook, /never edited, reloaded, or restarted/i);
  assert.match(quality, /phase6-campaign-lifecycle-production-update-contract/);

  const protectedScope = `${common}\n${preflight}\n${deploy}\n${validate}\n${rollback}\n${dashboardRollback}\n${resumePreflight}\n${resume}`;
  assert.doesNotMatch(protectedScope, /systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)/i);
  assert.doesNotMatch(protectedScope, /docker (stop|restart|rm).*(smartlabs|n8n)/i);
  assert.doesNotMatch(protectedScope, /\/data\/|\/opt\/(smartlabs|n8n-smartlabs)/i);
  assert.doesNotMatch(`${protectedScope}\n${backup}`, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@/);
});

test('Phase 5F database bridge is database-only, PostgreSQL 17.6-pinned, and reversibly tested', async () => {
  const root = new URL('../deployment/phase5f-database-bridge/', import.meta.url);
  const common = await readFile(new URL('scripts/common.sh', root), 'utf8');
  const preflight = await readFile(new URL('scripts/preflight.sh', root), 'utf8');
  const deploy = await readFile(new URL('scripts/deploy-bridge.sh', root), 'utf8');
  const validate = await readFile(new URL('scripts/validate-release.sh', root), 'utf8');
  const rollback = await readFile(new URL('scripts/rollback-bridge.sh', root), 'utf8');
  const lifecycle = await readFile(new URL('scripts/test-disposable-lifecycle.sh', root), 'utf8');
  const packageValidation = await readFile(new URL('scripts/validate-package.sh', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  const sharedBackup = await readFile(new URL('../deployment/production-database-backup/prepare-offserver-backup.ps1', import.meta.url), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

  assert.match(common, /EXPECTED_START_MIGRATION=0009_postiz_automation_controls/);
  assert.match(common, /TARGET_MIGRATION=0014_supervised_conversation_ownership/);
  for (const version of ['0010_postiz_performance_monitoring', '0011_ghl_contact_sync', '0012_ghl_inbound_event_inbox', '0013_sales_knowledge_intelligence', '0014_supervised_conversation_ownership']) {
    assert.match(common, new RegExp(version));
  }
  assert.match(common, /assert_bridge_default_state/);
  assert.match(common, /assert_dashboard_identity_unchanged/);
  assert.match(preflight, /assert_database_at_start/);
  assert.match(preflight, /validate_backup_proof/);
  assert.match(deploy, /rollback_applied_migrations/);
  assert.match(deploy, /trap automatic_rollback EXIT/);
  assert.doesNotMatch(deploy, /docker compose.+(build|up|restart|stop|rm)|git (checkout|reset|pull)/);
  assert.match(validate, /assert_dashboard_identity_unchanged/);
  assert.match(rollback, /ROLLBACK-THE-AUTHORIZED-TANAGHOM-BRIDGE/);
  assert.match(rollback, /assert_bridge_default_state/);
  assert.match(lifecycle, /0014_supervised_conversation_ownership 0013_sales_knowledge_intelligence/);
  assert.match(lifecycle, /\$version\.down\.sql/);
  assert.match(lifecycle, /bridge default guard accepted customer policy changes/);
  assert.match(sharedBackup, /postgres:17\.6-alpine3\.22@sha256:[0-9a-f]{64}/);
  assert.match(sharedBackup, /RESTORE_VERIFIED=YES/);
  assert.match(sharedBackup, /--network none/);
  assert.match(packageValidation, /cannot operate on dashboard or protected services/);
  assert.match(runbook, /No dashboard image is built/);
  assert.match(runbook, /fresh 0014 backup/i);
  assert.match(quality, /phase5f-database-bridge-contract/);
  assert.match(quality, /postgres:17\.6-alpine3\.22@sha256:[0-9a-f]{64}/);

  const protectedScope = `${common}\n${preflight}\n${deploy}\n${validate}\n${rollback}`;
  assert.doesNotMatch(protectedScope, /systemctl (stop|restart|reload)|iptables (-A|-I|-D|-N|-F|-X)|nft /i);
  assert.doesNotMatch(protectedScope, /docker (build|pull|stop|restart|rm)|docker compose.+(up|down|stop|restart|rm)/i);
  assert.doesNotMatch(protectedScope, /\/data\/|\/opt\/(smartlabs|n8n-smartlabs)/i);
});

test('Phase 5G quality rollout is sequential, evidence-backed, and runtime-independent', async () => {
  const up = await readFile(new URL('../packages/database/migrations/0020_quality_rollout_control.up.sql', import.meta.url), 'utf8');
  const down = await readFile(new URL('../packages/database/migrations/0020_quality_rollout_control.down.sql', import.meta.url), 'utf8');
  const assertion = await readFile(new URL('../packages/database/tests/quality_rollout_control.sql', import.meta.url), 'utf8');
  const server = await readFile(new URL('../apps/dashboard/lib/server/quality-rollout.ts', import.meta.url), 'utf8');
  const component = await readFile(new URL('../apps/dashboard/components/quality-rollout.tsx', import.meta.url), 'utf8');
  const decision = await readFile(new URL('../docs/architecture/0011-quality-evidence-and-rollout.md', import.meta.url), 'utf8');

  assert.match(up, /current_stage text NOT NULL DEFAULT 'baseline'/);
  assert.match(up, /cohort IN \('human_baseline','ai_shadow','assisted','bounded_autonomous'\)/);
  assert.match(up, /version_attribution \?& ARRAY\['model','prompt','knowledge','policy','campaign'\]/);
  assert.match(up, /quality evaluation evidence is append-only/);
  assert.match(up, /quality rollout stages must be promoted sequentially/);
  assert.match(up, /REVOKE ALL ON tanaghom\.quality_rollout_policies[\s\S]+tanaghom_n8n_worker,tanaghom_conversation_worker/);
  assert.doesNotMatch(up, /GRANT (INSERT|UPDATE|DELETE).+tanaghom_(n8n|conversation)_worker/);
  assert.match(down, /preserve quality evaluation evidence before rolling back 0020/);
  assert.match(assertion, /promotion succeeded without baseline evidence/);
  assert.match(assertion, /append-only snapshot accepted mutation/);
  assert.match(server, /viewer: \{ role: user\.role, can_promote: user\.role === "owner" \}/);
  assert.match(component, /Missing data is shown as “—”/);
  assert.match(component, /never activates n8n, clears an emergency stop, or sends a customer message/i);
  assert.match(decision, /performs no\s+provider call, workflow activation, server deployment, customer message, or\s+production migration/i);
});

test('Phase 5G baseline and shadow evaluation is de-identified, proposal-only, and least privileged', async () => {
  const migration = await readFile(new URL('../packages/database/migrations/0021_quality_baseline_shadow_pipeline.up.sql', import.meta.url), 'utf8');
  const workflow = JSON.parse(await readFile(new URL('../n8n/workflows/phase5g/quality-shadow-evaluator.v1.json', import.meta.url), 'utf8'));
  const prompt = await readFile(new URL('../prompts/quality-shadow-evaluator/v1.md', import.meta.url), 'utf8');
  const server = await readFile(new URL('../apps/dashboard/lib/server/quality-rollout.ts', import.meta.url), 'utf8');
  const component = await readFile(new URL('../apps/dashboard/components/quality-rollout.tsx', import.meta.url), 'utf8');
  for (const name of ['quality-baseline-import.v1.schema.json','quality-shadow-job.v1.schema.json','quality-shadow-result.v1.schema.json']) {
    const schema = JSON.parse(await readFile(new URL(`../packages/contracts/schemas/phase5g/${name}`, import.meta.url), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  }
  assert.match(migration, /possible personal data detected; import refused/);
  assert.match(migration, /external_action_count integer NOT NULL CHECK \(external_action_count=0\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION tanaghom\.claim_quality_shadow_job\(\),tanaghom\.persist_quality_shadow_result/);
  assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE|DELETE).+quality_.+tanaghom_n8n_worker/);
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.find(node => node.type === 'n8n-nodes-base.scheduleTrigger')?.disabled, true);
  assert.match(JSON.stringify(workflow), /claim_quality_shadow_job/);
  assert.match(JSON.stringify(workflow), /external_action_count/);
  assert.match(prompt, /Never send a message/);
  assert.match(server, /approve_default_metrics/);
  assert.match(server, /import_quality_baseline_dataset/);
  assert.match(component, /Baseline → shadow evidence setup/);
  assert.match(component, /Nothing in this workspace sends a message/);
});

test('Phase 6 agentic simulation executes every inactive workflow without customer credentials', async () => {
  const script = await readFile(new URL('../scripts/phase6-agentic-simulation.mjs', import.meta.url), 'utf8');
  const runbook = await readFile(new URL('../docs/acceptance/PHASE6_AGENTIC_SIMULATION.md', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

  assert.equal(manifest.scripts['test:phase6-agentic'], 'node scripts/phase6-agentic-simulation.mjs');
  assert.match(quality, /phase6-agentic-simulation:/);
  assert.match(quality, /POSTGRES_DB: tanaghom_agents_workflow_test/);
  assert.match(quality, /npm run test:phase6-agentic/);
  assert.match(quality, /phase6-agentic-simulation-evidence/);
  assert.match(script, /workflowFiles = \[/);
  for (const id of [
    'campaign-strategist.v1.json', 'content-producer.v1.json',
    'postiz-draft-publisher.v1.json', 'postiz-performance-monitor.v1.json',
    'ghl-contact-sync.v1.json', 'governed-ghl-actions.v1.json',
    'conversation-intelligence.v1.json',
    'quality-shadow-evaluator.v1.json',
  ]) assert.match(script, new RegExp(id.replaceAll('.', '\\.')));
  assert.match(script, /customer_credentials_used: false/);
  assert.match(script, /production_contacted: false/);
  assert.match(script, /smartlabs_contacted_or_modified: false/);
  assert.match(script, /quality_external_actions/);
  assert.match(script, /unexpected_personal_data_records/);
  assert.match(runbook, /does not authorize workflow activation/i);
  assert.match(runbook, /English and Arabic/i);
  assert.match(runbook, /Remaining acceptance after this gate/);
  assert.doesNotMatch(`${script}\n${runbook}`, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@(?:38\.|aws-)/);
});

test('Phase 6 core-agent canary is sequential, zero-budget, human-gated, and transactionally restored', async () => {
  const root = new URL('../deployment/phase6-core-agent-canary/', import.meta.url);
  const common = await readFile(new URL('scripts/common.sh', root), 'utf8');
  const workflowContract = await readFile(new URL('scripts/workflow-contract.mjs', root), 'utf8');
  const operator = await readFile(new URL('scripts/canary-operator.mjs', root), 'utf8');
  const run = await readFile(new URL('scripts/run-canary.sh', root), 'utf8');
  const restore = await readFile(new URL('scripts/restore-workflows.sh', root), 'utf8');
  const reconcile = await readFile(new URL('scripts/reconcile-firewall-evidence.sh', root), 'utf8');
  const verify = await readFile(new URL('scripts/verify-human-approval.sh', root), 'utf8');
  const packageValidation = await readFile(new URL('scripts/validate-package.sh', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

  assert.match(common, /EXPECTED_MIGRATION=0023_campaign_lifecycle/);
  assert.match(common, /assert_no_claimable_core_backlog/);
  assert.match(common, /postiz_draft_mode<>'manual'/);
  assert.match(common, /action_emergency_stop IS NOT TRUE/);
  assert.match(common, /NODE_EXTRA_CA_CERTS="\$DATABASE_CA_CERT"/);
  assert.match(common, /TANAGHOM_DATABASE_SSL_MODE=verify-full/);
  assert.match(workflowContract, /node\.disabled = true/);
  assert.match(workflowContract, /unexpected external endpoint/);
  assert.match(workflowContract, /publishing or CRM reference/);
  assert.match(operator, /budget_target,revenue_target/);
  assert.match(operator, /max_items: 2/);
  assert.match(operator, /verifyApproved/);
  assert.match(operator, /human_approvals/);
  assert.match(operator, /BEGIN READ ONLY/);
  assert.match(operator, /check-database/);
  assert.match(operator, /searchParams\.set\("sslmode", "verify-full"\)/);
  assert.match(run, /publish_workflow "\$STRATEGIST_ID"[\s\S]+unpublish_workflow "\$STRATEGIST_ID"[\s\S]+publish_workflow "\$PRODUCER_ID"[\s\S]+unpublish_workflow "\$PRODUCER_ID"/);
  assert.match(run, /operator verify-pending/);
  assert.doesNotMatch(run, /operator (seed|queue-content|verify-pending).+\| tee/);
  assert.match(run, /n8n audit/);
  assert.match(common, /normalize_firewall_snapshot/);
  assert.match(common, /sed -E '\/\^#\/d; s\//);
  assert.match(common, /\[COUNTERS\]/);
  assert.match(run, /iptables\.rules\.before/);
  assert.match(run, /iptables\.rules\.after/);
  assert.match(run, /cmp -s "\$evidence\/iptables\.rules\.before" "\$evidence\/iptables\.rules\.after"/);
  assert.doesNotMatch(run, /cmp -s "\$evidence\/iptables\.before" "\$evidence\/iptables\.after"/);
  assert.match(packageValidation, /firewall normalization did not exclude timestamps and counters/);
  assert.match(packageValidation, /firewall normalization concealed a rule change/);
  assert.match(reconcile, /YES-RECONCILE-VOLATILE-FIREWALL-EVIDENCE/);
  assert.match(reconcile, /READY_FOR_HUMAN_APPROVAL_AT=/);
  assert.match(reconcile, /compare-others/);
  assert.match(reconcile, /operator verify-pending/);
  assert.doesNotMatch(reconcile, /publish_workflow|execute_workflow_once|operator (seed|queue-content)/);
  assert.doesNotMatch(run, /\| tee/);
  assert.match(restore, /import_workflow_inactive/);
  assert.match(verify, /YES-VERIFY-AUTHENTICATED-HUMAN-APPROVAL/);
  assert.match(verify, /content\.postiz\.draft/);
  assert.doesNotMatch(verify, /operator verify-approved.+\| tee/);
  assert.match(runbook, /intentionally ends before[\s\S]+publishing/i);
  assert.match(runbook, /does not restart\/recreate n8n/i);
  assert.match(quality, /phase6-core-agent-canary\/scripts\/validate-package\.sh/);
  assert.match(quality, /phase6-core-agent-canary\/scripts\/test-refusal-paths\.sh/);

  const mutationScope = `${run}\n${restore}\n${reconcile}\n${verify}`;
  assert.doesNotMatch(mutationScope, /systemctl (stop|restart|reload)|iptables (-A|-I|-D|-N|-F|-X)|docker (stop|restart|rm)|docker compose/);
  assert.doesNotMatch(mutationScope, /publish_workflow .*postiz|publish_workflow .*ghl/i);
  assert.doesNotMatch(`${common}\n${workflowContract}\n${operator}\n${mutationScope}\n${runbook}`, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@(?:38\.|aws-)/);
});

test('Phase 6 Conversation Intelligence canary is synthetic, exclusive, grounded, and restored inactive', async () => {
  const root = new URL('../deployment/phase6-conversation-shadow-canary/', import.meta.url);
  const common = await readFile(new URL('scripts/common.sh', root), 'utf8');
  const preflight = await readFile(new URL('scripts/preflight.sh', root), 'utf8');
  const run = await readFile(new URL('scripts/run-canary.sh', root), 'utf8');
  const restore = await readFile(new URL('scripts/restore-locks.sh', root), 'utf8');
  const operator = await readFile(new URL('scripts/canary-operator.mjs', root), 'utf8');
  const workflowContract = await readFile(new URL('scripts/workflow-contract.mjs', root), 'utf8');
  const lifecycle = await readFile(new URL('scripts/test-disposable-lifecycle.sh', root), 'utf8');
  const packageValidation = await readFile(new URL('scripts/validate-package.sh', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

  assert.match(common, /EXPECTED_MIGRATION=0025_runtime_agent_reconciliation/);
  assert.match(common, /WORKFLOW_ID=phase5ConversationIntelligenceV1/);
  assert.match(common, /assert_conversation_baseline/);
  assert.match(common, /integration_connections WHERE provider='ghl' AND status='connected'/);
  assert.match(common, /conversation_processing_mode<>'paused'/);
  assert.match(common, /assert_counts_unchanged_except_execution/);
  assert.match(preflight, /workflow_execution_count/);
  assert.match(preflight, /assert_production_worktree_reviewed/);
  assert.match(preflight, /tanaghom_conversation_runtime/);
  assert.match(preflight, /operator check-database/);
  assert.match(workflowContract, /schedule-disabled|disabled schedule/);
  assert.match(workflowContract, /unexpected external endpoint/);
  assert.match(workflowContract, /62000000-0000-4000-8000-000000000005/);
  assert.match(workflowContract, /62000000-0000-4000-8000-000000000002/);
  assert.match(operator, /conversation-canary\.test/);
  assert.match(operator, /What is the approved Tanaghom Canary Growth plan price/);
  assert.match(operator, /USD 99 per month/);
  assert.match(operator, /assertOnlyCanary/);
  assert.match(operator, /connected_ghl: 1/);
  assert.match(operator, /external_action_count/);
  assert.match(operator, /awaiting_approval/);
  assert.match(operator, /integration_status !== "disconnected"/);
  assert.match(run, /operator assert-only-canary[\s\S]+operator unlock[\s\S]+publish_workflow[\s\S]+execute_workflow_once[\s\S]+unpublish_workflow[\s\S]+operator restore-locks/);
  assert.match(run, /operator verify-ready/);
  assert.match(run, /operator verify-finalized/);
  assert.match(run, /n8n audit/);
  assert.match(run, /trap cleanup EXIT HUP INT TERM/);
  assert.match(restore, /operator quarantine/);
  assert.match(lifecycle, /operator accepted a competing connected GHL integration/);
  assert.match(lifecycle, /zero external actions passed in disposable PostgreSQL/);
  assert.match(packageValidation, /protected-service scoped/);
  assert.match(runbook, /does not test or[\s\S]+outbound messaging/i);
  assert.match(runbook, /Customer GHL credentials[\s\S]+remain separate approval gates/i);
  assert.match(quality, /phase6-conversation-shadow-canary-contract/);
  assert.match(quality, /postgres:17\.6-alpine3\.22@sha256:[0-9a-f]{64}/);

  const mutationScope = `${common}\n${preflight}\n${run}\n${restore}\n${operator}\n${workflowContract}`;
  assert.doesNotMatch(mutationScope, /systemctl (stop|restart|reload)|docker (stop|restart|rm)|docker compose|iptables (-A|-I|-D|-N|-F|-X)/i);
  assert.doesNotMatch(mutationScope, /https:\/\/[^\s"']*(gohighlevel|leadconnectorhq)|\/opt\/(smartlabs|n8n-smartlabs)|\/data\//i);
  assert.doesNotMatch(`${mutationScope}\n${runbook}`, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@(?:38\.|aws-)/);
});

test('Phase 6 runtime-agent reconciliation guarantees Publisher and Sales workers without rewriting history', async () => {
  const up = await readFile(new URL('../packages/database/migrations/0025_runtime_agent_reconciliation.up.sql', import.meta.url), 'utf8');
  const down = await readFile(new URL('../packages/database/migrations/0025_runtime_agent_reconciliation.down.sql', import.meta.url), 'utf8');
  const seed = await readFile(new URL('../packages/database/seeds/staging.sql', import.meta.url), 'utf8');
  const databaseTest = await readFile(new URL('../scripts/database-test.mjs', import.meta.url), 'utf8');
  const root = new URL('../deployment/phase6-runtime-agent-reconciliation/', import.meta.url);
  const common = await readFile(new URL('scripts/common.sh', root), 'utf8');
  const preflight = await readFile(new URL('scripts/preflight.sh', root), 'utf8');
  const deploy = await readFile(new URL('scripts/deploy-update.sh', root), 'utf8');
  const validate = await readFile(new URL('scripts/validate-release.sh', root), 'utf8');
  const rollback = await readFile(new URL('scripts/rollback-update.sh', root), 'utf8');
  const lifecycle = await readFile(new URL('scripts/test-disposable-lifecycle.sh', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

  assert.match(up, /10000000-0000-4000-8000-000000000003/);
  assert.match(up, /10000000-0000-4000-8000-000000000004/);
  assert.match(up, /publisher_monitor/);
  assert.match(up, /sales_crm/);
  assert.match(up, /fixed identity conflict/);
  assert.match(up, /incompatible existing agent/);
  assert.match(down, /NOT EXISTS[\s\S]+tanaghom\.agent_jobs/);
  assert.match(seed, /ON CONFLICT \(code\) DO UPDATE SET/);
  assert.match(databaseTest, /runtime_agent_reconciliation\.sql/);
  assert.match(databaseTest, /0025 rollback left migration state behind/);
  assert.match(common, /EXPECTED_START_MIGRATION=0024_conversation_intelligence_worker_registry/);
  assert.match(common, /TARGET_MIGRATION=0025_runtime_agent_reconciliation/);
  assert.match(common, /assert_prior_agents_unchanged/);
  assert.match(common, /assert_new_agents_unused/);
  assert.match(preflight, /assert_production_worktree_reviewed/);
  assert.match(preflight, /assert_database_at_start_runtime_agents/);
  assert.match(deploy, /trap automatic_rollback EXIT HUP INT TERM/);
  assert.match(deploy, /db_file "\$MIGRATION_UP"/);
  assert.match(validate, /n8n audit/);
  assert.match(validate, /assert_prior_agents_unchanged/);
  assert.match(rollback, /ROLLBACK-THE-AUTHORIZED-RUNTIME-AGENT-RELEASE/);
  assert.match(lifecycle, /preserves prior rows and used history/);
  assert.match(runbook, /does not update the dashboard checkout|No production action is authorized/i);
  assert.match(quality, /phase6-runtime-agent-reconciliation-contract/);
  assert.match(quality, /test-disposable-backup\.sh "\$DATABASE_TEST_URL" 0025_runtime_agent_reconciliation/);

  const protectedScope = `${common}\n${preflight}\n${deploy}\n${validate}\n${rollback}`;
  assert.doesNotMatch(protectedScope, /systemctl (stop|restart|reload)|docker (stop|restart|rm)|docker compose|iptables (-A|-I|-D|-N|-F|-X)/i);
  assert.doesNotMatch(protectedScope, /\/opt\/(smartlabs|n8n-smartlabs)|\/data\//i);
  assert.doesNotMatch(`${protectedScope}\n${runbook}`, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@/);
});

test('Phase 6 existing-campaign canary is exact-ID, governed, human-gated, and evidence-preserving', async () => {
  const root = new URL('../deployment/phase6-existing-campaign-canary/', import.meta.url);
  const common = await readFile(new URL('scripts/common.sh', root), 'utf8');
  const operator = await readFile(new URL('scripts/existing-campaign-operator.mjs', root), 'utf8');
  const preflight = await readFile(new URL('scripts/preflight.sh', root), 'utf8');
  const run = await readFile(new URL('scripts/run-canary.sh', root), 'utf8');
  const resumePreflight = await readFile(new URL('scripts/resume-preflight.sh', root), 'utf8');
  const resume = await readFile(new URL('scripts/resume-after-strategy.sh', root), 'utf8');
  const restore = await readFile(new URL('scripts/restore-workflows.sh', root), 'utf8');
  const verify = await readFile(new URL('scripts/verify-human-approval.sh', root), 'utf8');
  const lifecycle = await readFile(new URL('scripts/test-disposable-lifecycle.sh', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

  assert.match(common, /EXPECTED_MIGRATION=0023_campaign_lifecycle/);
  assert.match(common, /TANAGHOM_CANARY_CAMPAIGN_ID/);
  assert.match(common, /TANAGHOM_CANARY_STRATEGY_JOB_ID/);
  assert.match(common, /TANAGHOM_EXPECTED_CONTENT_ITEMS/);
  assert.match(common, /TANAGHOM_CANARY_ALLOW_OWNER_FUNCTION_CALL/);
  assert.match(common, /NODE_EXTRA_CA_CERTS="\$DATABASE_CA_CERT"/);
  assert.match(common, /TANAGHOM_DATABASE_SSL_MODE=verify-full/);
  assert.match(preflight, /operator verify-authorized/);
  assert.match(operator, /exact campaign and strategy job identity did not match/);
  assert.match(operator, /claimable_core_jobs !== 1/);
  assert.match(operator, /the exact content job is not the sole safe claimable core work/);
  assert.match(operator, /persisted strategy is not at the exact safe resume boundary/);
  assert.match(operator, /content_succeeded/);
  assert.match(operator, /content\.review_completed/);
  assert.match(operator, /privileged governed-function invocation boundary/);
  assert.match(operator, /procedure\.proowner = role\.oid/);
  assert.match(operator, /has_function_privilege\('tanaghom_n8n_worker'/);
  assert.doesNotMatch(operator, /SET LOCAL ROLE tanaghom_api/);
  assert.match(operator, /SELECT \* FROM tanaghom\.queue_campaign_content/);
  assert.match(operator, /row\.drafts < 1 \|\| row\.drafts > expectedItems/);
  assert.match(run, /operator verify-authorized[\s\S]+publish_workflow "\$STRATEGIST_ID"/);
  assert.match(run, /publish_workflow "\$STRATEGIST_ID"[\s\S]+unpublish_workflow "\$STRATEGIST_ID"[\s\S]+operator queue-content[\s\S]+publish_workflow "\$PRODUCER_ID"[\s\S]+unpublish_workflow "\$PRODUCER_ID"/);
  assert.match(run, /publish_workflow "\$PRODUCER_ID"[\s\S]+operator verify-content-ready[\s\S]+execute_workflow_once "\$PRODUCER_ID"/);
  assert.match(run, /existing campaign and jobs were deliberately preserved/);
  assert.match(resumePreflight, /operator verify-resume-authorized/);
  assert.match(resume, /RESUME_MODE=CONTENT_PRODUCER_ONLY/);
  assert.match(resume, /resume unexpectedly executed Campaign Strategist/);
  assert.doesNotMatch(resume, /publish_workflow "\$STRATEGIST_ID"|execute_workflow_once "\$STRATEGIST_ID"/);
  assert.doesNotMatch(`${operator}\n${run}`, /operator (seed|mark-failed)|INSERT INTO tanaghom\.(campaigns|agent_jobs)/);
  assert.match(restore, /import_workflow_inactive/);
  assert.match(verify, /YES-VERIFY-AUTHENTICATED-HUMAN-APPROVAL/);
  assert.match(lifecycle, /operator accepted competing claimable work/);
  assert.match(lifecycle, /persist_strategy_result/);
  assert.match(lifecycle, /persist_content_result/);
  assert.match(lifecycle, /reconcile_campaign_content_jobs/);
  assert.match(runbook, /Issue #100 remains open/);
  assert.match(quality, /phase6-existing-campaign-canary-contract/);
  assert.match(quality, /phase6-existing-campaign-canary\/scripts\/test-disposable-lifecycle\.sh/);

  const mutationScope = `${run}\n${resume}\n${restore}\n${verify}`;
  assert.doesNotMatch(mutationScope, /systemctl (stop|restart|reload)|iptables (-A|-I|-D|-N|-F|-X)|docker (stop|restart|rm)|docker compose/);
  assert.doesNotMatch(mutationScope, /publish_workflow .*postiz|publish_workflow .*ghl/i);
  assert.doesNotMatch(`${common}\n${operator}\n${mutationScope}\n${runbook}`, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@(?:38\.|aws-)/);
});

test('Phase 6 content-job reconciliation is exact, least-privileged, idempotent, and provider-isolated', async () => {
  const root = new URL('../deployment/phase6-content-job-reconciliation/', import.meta.url);
  const common = await readFile(new URL('scripts/common.sh', root), 'utf8');
  const operator = await readFile(new URL('scripts/reconcile-operator.mjs', root), 'utf8');
  const preflight = await readFile(new URL('scripts/preflight.sh', root), 'utf8');
  const reconcile = await readFile(new URL('scripts/reconcile-job.sh', root), 'utf8');
  const lifecycle = await readFile(new URL('scripts/test-disposable-lifecycle.sh', root), 'utf8');
  const workflowBaseline = await readFile(new URL('scripts/test-workflow-baseline.sh', root), 'utf8');
  const packageValidation = await readFile(new URL('scripts/validate-package.sh', root), 'utf8');
  const runbook = await readFile(new URL('RUNBOOK.md', root), 'utf8');
  const quality = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

  assert.match(common, /EXPECTED_MIGRATION=0023_campaign_lifecycle/);
  assert.match(common, /TANAGHOM_JOB_RECONCILIATION_AUTHORIZATION/);
  assert.match(common, /assert_canary_evidence/);
  assert.match(common, /HUMAN_APPROVAL_VERIFIED_AT=/);
  assert.match(operator, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(operator, /WITH INHERIT FALSE GRANTED BY CURRENT_USER/);
  assert.match(operator, /WITH SET TRUE GRANTED BY CURRENT_USER/);
  assert.match(operator, /REVOKE tanaghom_n8n_worker FROM %I GRANTED BY CURRENT_USER/);
  assert.match(operator, /SET LOCAL ROLE tanaghom_n8n_worker/);
  assert.match(operator, /SELECT tanaghom\.complete_content_job\(\$1::uuid\)/);
  assert.match(operator, /matching_active_human_decisions !== 1/);
  assert.match(operator, /worker_has_approval_table_access/);
  assert.match(operator, /operator_worker_set_option/);
  assert.doesNotMatch(operator, /client\.query\([`"]\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
  assert.match(preflight, /operator preflight/);
  assert.doesNotMatch(preflight, /compare-others/);
  assert.match(reconcile, /YES-COMPLETE-THE-REVIEWED-CONTENT-JOB/);
  assert.equal((reconcile.match(/operator reconcile/g) || []).length, 1);
  assert.equal((reconcile.match(/compare-others/g) || []).length, 1);
  assert.match(reconcile, /compare-others "\$evidence\/workflows\.before\.json" "\$evidence\/workflows\.after\.json"/);
  assert.doesNotMatch(`${preflight}\n${reconcile}`, /\$CANARY_EVIDENCE\/workflows\.before\.json/);
  assert.match(reconcile, /RECONCILIATION_SUCCEEDED_AT=/);
  assert.match(reconcile, /workflow_execution_count/);
  assert.match(reconcile, /n8n audit/);
  assert.match(lifecycle, /complete_content_job/);
  assert.match(lifecycle, /CREATEROLE INHERIT NOREPLICATION/);
  assert.match(lifecycle, /SELECT rolinherit FROM pg_roles/);
  assert.match(lifecycle, /inactive human reviewer/);
  assert.match(lifecycle, /cross-organization human reviewer/);
  assert.match(lifecycle, /repeated reconciliation unexpectedly succeeded/);
  assert.match(lifecycle, /true\|false\|false/);
  assert.match(lifecycle, /count\(\*\) FROM tanaghom\.external_operations/);
  assert.match(workflowBaseline, /post-canary workflows are accepted in the current operation baseline/);
  assert.match(workflowBaseline, /in-window unrelated workflow drift was not rejected/);
  assert.match(packageValidation, /runtime package can modify or execute a workflow/);
  assert.match(runbook, /There is intentionally no command/);
  assert.match(runbook, /does not authorize\s+workflow activation/i);
  assert.match(quality, /phase6-content-job-reconciliation-contract/);
  assert.match(quality, /phase6-content-job-reconciliation\/scripts\/validate-package\.sh/);

  const runtimeScope = `${common}\n${operator}\n${preflight}\n${reconcile}`;
  assert.doesNotMatch(runtimeScope, /systemctl (?:stop|restart|reload)|iptables (?:-A|-I|-D|-N|-F|-X)|docker (?:stop|restart|rm)|docker compose/i);
  assert.doesNotMatch(runtimeScope, /n8n (?:import|execute|publish|unpublish)|publish_workflow|execute_workflow/i);
  assert.doesNotMatch(runtimeScope, /export:credentials|--decrypted/i);
  assert.doesNotMatch(runtimeScope, /api\.postiz|services\.leadconnectorhq|^\s*Authorization:|Bearer /m);
  assert.doesNotMatch(`${runtimeScope}\n${runbook}`, /Bearer\s+[A-Za-z0-9_-]{20,}|postgresql:\/\/[^\s:]+:[^\s@]+@(?:38\.|aws-)/);
});
