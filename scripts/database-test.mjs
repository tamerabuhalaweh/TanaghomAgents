import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_TEST_URL;
const root = dirname(dirname(fileURLToPath(import.meta.url)));

if (!databaseUrl) {
  console.error('DATABASE_TEST_URL is required.');
  process.exit(2);
}

function psql(...args) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function query(sql) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], {
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function database(command) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'database.mjs'), command], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const seed = join(root, 'packages', 'database', 'seeds', 'staging.sql');
const assertions = join(root, 'packages', 'database', 'tests', 'foundation.sql');
const roleAssertions = join(root, 'packages', 'database', 'tests', 'least_privilege_roles.sql');
const workerAssertions = join(root, 'packages', 'database', 'tests', 'controlled_worker_functions.sql');
const postizAssertions = join(root, 'packages', 'database', 'tests', 'postiz_draft_handoff.sql');
const integrationAssertions = join(root, 'packages', 'database', 'tests', 'customer_integrations.sql');
const automationAssertions = join(root, 'packages', 'database', 'tests', 'postiz_automation_controls.sql');
const performanceAssertions = join(root, 'packages', 'database', 'tests', 'postiz_performance_monitoring.sql');
const ghlAssertions = join(root, 'packages', 'database', 'tests', 'ghl_contact_sync.sql');
const ghlInboundAssertions = join(root, 'packages', 'database', 'tests', 'ghl_inbound_event_inbox.sql');
const knowledgeAssertions = join(root, 'packages', 'database', 'tests', 'sales_knowledge_intelligence.sql');
const ownershipAssertions = join(root, 'packages', 'database', 'tests', 'supervised_conversation_ownership.sql');
const ghlActionAssertions = join(root, 'packages', 'database', 'tests', 'governed_ghl_actions.sql');
const ghlActionReviewAssertions = join(root, 'packages', 'database', 'tests', 'ghl_action_review_reconciliation.sql');
const capacityAssertions = join(root, 'packages', 'database', 'tests', 'conversation_capacity_backpressure.sql');
const notificationAssertions = join(root, 'packages', 'database', 'tests', 'notification_monitoring_destinations.sql');
const qualityRolloutAssertions = join(root, 'packages', 'database', 'tests', 'quality_rollout_control.sql');
const ownershipConcurrency = join(root, 'scripts', 'conversation-ownership-concurrency-test.mjs');

database('migrate');
database('migrate');
psql('-f', seed);
psql('-f', assertions);
psql('-f', roleAssertions);
psql('-f', workerAssertions);
psql('-f', postizAssertions);
psql('-f', integrationAssertions);
psql('-f', automationAssertions);
psql('-f', performanceAssertions);
psql('-f', ghlAssertions);
psql('-f', ghlInboundAssertions);
psql('-f', knowledgeAssertions);
psql('-f', ownershipAssertions);
psql('-f', ghlActionAssertions);
psql('-f', ghlActionReviewAssertions);
psql('-f', capacityAssertions);
psql('-f', notificationAssertions);
psql('-f', qualityRolloutAssertions);
{
  const result = spawnSync(process.execPath, [ownershipConcurrency], {
    env: { ...process.env, DATABASE_TEST_URL: databaseUrl }, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
database('rollback');
psql('-c', "DO $$ BEGIN IF to_regclass('tanaghom.quality_rollout_policies') IS NOT NULL OR EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='0020_quality_rollout_control') THEN RAISE EXCEPTION '0020 rollback left quality rollout objects behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF to_regclass('tanaghom.notification_destinations') IS NOT NULL OR to_regclass('tanaghom.notification_delivery_controls') IS NOT NULL OR EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='0019_notification_monitoring_destinations') THEN RAISE EXCEPTION '0019 rollback left notification monitoring objects behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF to_regclass('tanaghom.conversation_capacity_policies') IS NOT NULL OR to_regclass('tanaghom.conversation_dependency_cooldowns') IS NOT NULL OR EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='0018_conversation_capacity_backpressure') THEN RAISE EXCEPTION '0018 rollback left capacity objects behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='0017_ghl_service_action_audit_attribution') THEN RAISE EXCEPTION '0017 rollback left migration state behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF to_regclass('tanaghom.ghl_action_reconciliations') IS NOT NULL OR to_regprocedure('tanaghom.reconcile_ghl_action(uuid,uuid,text,text,text,uuid)') IS NOT NULL THEN RAISE EXCEPTION '0016 rollback left GHL review objects behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF to_regclass('tanaghom.ghl_action_jobs') IS NOT NULL OR to_regprocedure('tanaghom.claim_ghl_action_job()') IS NOT NULL THEN RAISE EXCEPTION '0015 rollback left governed GHL action objects behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF to_regclass('tanaghom.conversations') IS NOT NULL OR to_regprocedure('tanaghom.transition_supervised_conversation(uuid,text,uuid,uuid,text,bigint,uuid)') IS NOT NULL THEN RAISE EXCEPTION '0014 rollback left supervised conversation objects behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF to_regclass('tanaghom.sales_knowledge_versions') IS NOT NULL OR to_regprocedure('tanaghom.prepare_conversation_intelligence(uuid)') IS NOT NULL THEN RAISE EXCEPTION '0013 rollback left conversation intelligence objects behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF to_regclass('tanaghom.ghl_inbound_events') IS NOT NULL OR to_regprocedure('tanaghom.claim_ghl_inbound_event_job()') IS NOT NULL OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tanaghom_conversation_worker') THEN RAISE EXCEPTION '0012 rollback left inbound event objects behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF to_regclass('tanaghom.ghl_contact_sync_state') IS NOT NULL OR to_regprocedure('tanaghom.claim_ghl_contact_job()') IS NOT NULL THEN RAISE EXCEPTION '0011 rollback left GHL contact objects behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF to_regclass('tanaghom.post_metric_observations') IS NOT NULL OR to_regprocedure('tanaghom.claim_postiz_performance_job()') IS NOT NULL THEN RAISE EXCEPTION '0010 rollback left performance objects behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF to_regclass('tanaghom.organization_automation_policies') IS NOT NULL THEN RAISE EXCEPTION '0009 rollback left automation policy tables behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF to_regclass('tanaghom.integration_connections') IS NOT NULL THEN RAISE EXCEPTION '0008 rollback left integration tables behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF to_regprocedure('tanaghom.queue_postiz_draft(uuid,uuid)') IS NOT NULL THEN RAISE EXCEPTION '0007 rollback left Postiz functions behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'tanaghom' AND table_name = 'app_users' AND column_name = 'accepted_at') THEN RAISE EXCEPTION '0006 rollback left invitation columns behind'; END IF; END $$;");
database('rollback');
psql('-c', "DO $$ BEGIN IF to_regprocedure('tanaghom.claim_agent_job(text,text[])') IS NOT NULL THEN RAISE EXCEPTION '0005 rollback left worker functions behind'; END IF; END $$;");
while (query("SELECT count(*) FROM public.schema_migrations;") !== '0') {
  database('rollback');
}
psql('-c', "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tanaghom') THEN RAISE EXCEPTION 'rollback left tanaghom schema behind'; END IF; END $$;");
psql('-c', "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('tanaghom_api', 'tanaghom_n8n_worker', 'tanaghom_readonly', 'tanaghom_conversation_worker')) THEN RAISE EXCEPTION 'rollback left package roles behind'; END IF; END $$;");
database('migrate');
psql('-c', "SELECT 'PASS: migration rollback and clean reapply succeeded.' AS result;");
