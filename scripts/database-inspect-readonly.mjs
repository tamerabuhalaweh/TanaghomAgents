import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required. Keep it in an untracked environment.');
  process.exit(2);
}

const sql = String.raw`
BEGIN TRANSACTION READ ONLY;
SELECT jsonb_pretty(jsonb_build_object(
  'server_version', current_setting('server_version'),
  'current_database', current_database(),
  'current_user', current_user,
  'current_user_capabilities', COALESCE((
    SELECT jsonb_build_object(
      'can_login', rolcanlogin,
      'is_superuser', rolsuper,
      'can_create_role', rolcreaterole,
      'can_create_database', rolcreatedb,
      'bypasses_rls', rolbypassrls
    )
    FROM pg_roles
    WHERE rolname = current_user
  ), '{}'::jsonb),
  'package_roles', COALESCE((
    SELECT jsonb_agg(rolname ORDER BY rolname)
    FROM pg_roles
    WHERE rolname IN ('tanaghom_api', 'tanaghom_n8n_worker', 'tanaghom_readonly')
  ), '[]'::jsonb),
  'schemas', COALESCE((
    SELECT jsonb_agg(schema_name ORDER BY schema_name)
    FROM information_schema.schemata
    WHERE schema_name IN ('public', 'tanaghom')
  ), '[]'::jsonb),
  'tables', COALESCE((
    SELECT jsonb_agg(format('%I.%I', table_schema, table_name) ORDER BY table_schema, table_name)
    FROM information_schema.tables
    WHERE table_schema IN ('public', 'tanaghom')
      AND table_type = 'BASE TABLE'
  ), '[]'::jsonb),
  'views', COALESCE((
    SELECT jsonb_agg(format('%I.%I', table_schema, table_name) ORDER BY table_schema, table_name)
    FROM information_schema.views
    WHERE table_schema IN ('public', 'tanaghom')
  ), '[]'::jsonb),
  'extensions', COALESCE((
    SELECT jsonb_agg(extname ORDER BY extname)
    FROM pg_extension
  ), '[]'::jsonb),
  'migration_ledger_exists', to_regclass('public.schema_migrations') IS NOT NULL
));
ROLLBACK;
`;

const result = spawnSync(
  'psql',
  [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
  { encoding: 'utf8', env: { ...process.env, PGAPPNAME: 'tanaghom-readonly-inspection' } },
);

if (result.error) {
  console.error(`Unable to run psql: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

process.stdout.write(result.stdout);
