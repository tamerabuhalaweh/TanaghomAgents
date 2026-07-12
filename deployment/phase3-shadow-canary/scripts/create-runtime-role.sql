\set ON_ERROR_STOP on

SELECT format(
  'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'runtime_role', :'runtime_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_role')
\gexec

SELECT format(
  'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'runtime_role', :'runtime_password'
)
\gexec

SELECT format('GRANT tanaghom_n8n_worker TO %I', :'runtime_role')
\gexec

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members membership
    JOIN pg_roles member ON member.oid = membership.member
    JOIN pg_roles granted ON granted.oid = membership.roleid
    WHERE member.rolname = 'tanaghom_n8n_runtime'
      AND granted.rolname <> 'tanaghom_n8n_worker'
  ) THEN
    RAISE EXCEPTION 'runtime login has an unexpected role membership';
  END IF;
END;
$$;
