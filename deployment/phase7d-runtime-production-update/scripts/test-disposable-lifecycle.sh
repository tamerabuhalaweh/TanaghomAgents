#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
url=${1:-${DATABASE_TEST_URL:-}}
test -n "$url" || { echo 'DATABASE_TEST_URL is required' >&2; exit 2; }

psql_file() {
  psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" >/dev/null
}
scalar() {
  psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"
}

test "$(scalar "
  SELECT to_regclass('public.schema_migrations') IS NULL;
")" = t || {
  echo 'disposable Phase 7D database must start empty' >&2
  exit 3
}

for file in "$root"/packages/database/migrations/*.up.sql; do
  version=$(basename "$file" .up.sql)
  test "$version" = 0030_policy_resolved_agent_runtime && break
  psql_file "$file"
done
test "$(scalar "
  SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;
")" = 0029_organization_agent_studio

psql_file "$root/packages/database/migrations/0030_policy_resolved_agent_runtime.up.sql"
psql_file "$root/packages/database/migrations/0031_policy_runtime_executors_certification.up.sql"
test "$(scalar "
  SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;
")" = 0031_policy_runtime_executors_certification
test "$(scalar "
  SELECT count(*) FROM tanaghom.agent_runtime_executor_adapters
   WHERE enabled IS FALSE;
")" = 3
test "$(scalar "
  SELECT count(*) FROM tanaghom.agent_runtime_executor_adapter_events
   WHERE enabled IS FALSE AND operator_ref='migration_0031';
")" = 3
test "$(scalar "
  SELECT
    (SELECT count(*) FROM tanaghom.organization_agent_jobs)
    +(SELECT count(*) FROM tanaghom.organization_agent_runs)
    +(SELECT count(*) FROM tanaghom.organization_agent_invocations)
    +(SELECT count(*) FROM tanaghom.organization_agent_invocation_approvals)
    +(SELECT count(*) FROM tanaghom.organization_agent_dependency_blocks)
    +(SELECT count(*) FROM tanaghom.organization_agent_runtime_events)
    +(SELECT count(*) FROM tanaghom.organization_agent_runtime_certifications)
    +(SELECT count(*) FROM tanaghom.agent_runtime_executor_adapter_events
        WHERE operator_ref<>'migration_0031');
")" = 0
test "$(scalar "
  SELECT count(*) FROM tanaghom.agent_runtime_controls
   WHERE singleton AND emergency_stop IS TRUE;
")" = 1
test "$(scalar "
  SELECT count(*) FROM tanaghom.agent_runtime_executor_adapters
   WHERE (code='phase7d_read_executor_v1'
           AND workflow_sha256='fa59952fcb99468a26b03c951dc8c6123527835fcc75fe555ab9b31e86b886f2')
      OR (code='phase7d_proposal_executor_v1'
           AND workflow_sha256='00e231e1c6ea263855e81d57ec484d9caf8da8632c9e3c3c871e31461edba797')
      OR (code='phase7d_action_executor_v1'
           AND workflow_sha256='027d588f8268ee72a87183cfff13dedc9fdd77e40af432136853d9f56698b19b');
")" = 3

psql "$url" -X -v ON_ERROR_STOP=1 -c "
  CREATE ROLE tanaghom_phase7d_runtime_login LOGIN PASSWORD 'disposable'
    NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS
    IN ROLE tanaghom_agent_runtime;
  CREATE ROLE tanaghom_phase7d_read_login LOGIN PASSWORD 'disposable'
    NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS
    IN ROLE tanaghom_skill_read_executor;
  CREATE ROLE tanaghom_phase7d_proposal_login LOGIN PASSWORD 'disposable'
    NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS
    IN ROLE tanaghom_skill_proposal_executor;
  CREATE ROLE tanaghom_phase7d_action_login LOGIN PASSWORD 'disposable'
    NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS
    IN ROLE tanaghom_skill_action_executor;
" >/dev/null

test "$(scalar "
  SELECT count(*) FROM pg_roles
   WHERE rolname LIKE 'tanaghom_phase7d_%_login'
     AND rolcanlogin AND NOT rolsuper AND NOT rolcreaterole
     AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls;
")" = 4
test "$(scalar "
  SELECT pg_has_role(
    'tanaghom_phase7d_read_login','tanaghom_skill_read_executor','MEMBER'
  );
")" = t
test "$(scalar "
  SELECT pg_has_role(
    'tanaghom_phase7d_read_login','tanaghom_skill_action_executor','MEMBER'
  );
")" = f
test "$(scalar "
  SELECT has_function_privilege(
    'tanaghom_phase7d_runtime_login',
    'tanaghom.claim_organization_agent_job(text)','EXECUTE'
  );
")" = t
test "$(scalar "
  SELECT has_function_privilege(
    'tanaghom_phase7d_action_login',
    'tanaghom.claim_agent_action_invocation(text)','EXECUTE'
  );
")" = t
test "$(scalar "
  SELECT has_function_privilege(
    'tanaghom_phase7d_action_login',
    'tanaghom.claim_agent_read_invocation(text)','EXECUTE'
  );
")" = f

psql "$url" -X -v ON_ERROR_STOP=1 -c "
  DROP ROLE tanaghom_phase7d_runtime_login;
  DROP ROLE tanaghom_phase7d_read_login;
  DROP ROLE tanaghom_phase7d_proposal_login;
  DROP ROLE tanaghom_phase7d_action_login;
" >/dev/null
psql_file "$root/packages/database/migrations/0031_policy_runtime_executors_certification.down.sql"
test "$(scalar "
  SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;
")" = 0030_policy_resolved_agent_runtime
psql_file "$root/packages/database/migrations/0030_policy_resolved_agent_runtime.down.sql"
test "$(scalar "
  SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;
")" = 0029_organization_agent_studio
test "$(scalar "
  SELECT count(*) FROM pg_roles
   WHERE rolname IN (
     'tanaghom_agent_runtime','tanaghom_skill_read_executor',
     'tanaghom_skill_proposal_executor','tanaghom_skill_action_executor'
   );
")" = 0

psql_file "$root/packages/database/migrations/0030_policy_resolved_agent_runtime.up.sql"
psql_file "$root/packages/database/migrations/0031_policy_runtime_executors_certification.up.sql"
test "$(scalar "
  SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;
")" = 0031_policy_runtime_executors_certification

echo 'PASS: Phase 7D applies exactly after 0029, isolates four logins, rolls back exactly to 0029, and reapplies cleanly.'
