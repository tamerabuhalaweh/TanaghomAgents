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
psql('-c', "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('tanaghom_api', 'tanaghom_n8n_worker', 'tanaghom_readonly')) THEN RAISE EXCEPTION 'rollback left package roles behind'; END IF; END $$;");
database('migrate');
psql('-c', "SELECT 'PASS: migration rollback and clean reapply succeeded.' AS result;");
