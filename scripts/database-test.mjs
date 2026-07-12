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

database('migrate');
database('migrate');
psql('-f', seed);
psql('-f', assertions);
database('rollback');
psql('-c', "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tanaghom') THEN RAISE EXCEPTION 'rollback left tanaghom schema behind'; END IF; END $$;");
database('migrate');
psql('-c', "SELECT 'PASS: migration rollback and clean reapply succeeded.' AS result;");
