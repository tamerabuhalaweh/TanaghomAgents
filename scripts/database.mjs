import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const command = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDirectory = join(root, 'packages', 'database', 'migrations');

if (!['migrate', 'rollback'].includes(command)) {
  console.error('Usage: node scripts/database.mjs <migrate|rollback>');
  process.exit(2);
}
if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}

const suffix = command === 'migrate' ? '.up.sql' : '.down.sql';
const files = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith(suffix))
  .sort();

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

function run(file) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-f', join(migrationDirectory, file)], {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`Unable to run psql: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const ledgerExists = query("SELECT to_regclass('public.schema_migrations') IS NOT NULL;") === 't';
const applied = ledgerExists
  ? new Set(query('SELECT version FROM public.schema_migrations ORDER BY version;').split('\n').filter(Boolean))
  : new Set();

if (command === 'migrate') {
  for (const file of files) {
    const version = file.slice(0, -suffix.length);
    if (!/^\d+_[a-z0-9_]+$/.test(version)) throw new Error(`Invalid migration filename: ${file}`);
    if (applied.has(version)) {
      console.log(`SKIP: ${version} is already applied.`);
      continue;
    }
    run(file);
  }
} else {
  const latest = [...applied].sort().at(-1);
  if (!latest) {
    console.log('SKIP: no applied migration to roll back.');
    process.exit(0);
  }
  const file = `${latest}.down.sql`;
  if (!files.includes(file)) throw new Error(`Missing rollback migration: ${file}`);
  run(file);
}
