\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE test_password text;
BEGIN
  IF current_database() <> 'tanaghom_test' OR
     (SELECT count(*) FROM public.schema_migrations) <> 34 THEN
    RAISE EXCEPTION 'fresh test database at migration 0034 required';
  END IF;
  -- SQL trim() removes spaces, not the newline written by prepare-runtime.py.
  test_password := rtrim(pg_read_file('/run/secrets/api_password'),chr(13)||chr(10));
  IF test_password !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid generated test password format';
  END IF;
  EXECUTE format('ALTER ROLE tanaghom_api LOGIN PASSWORD %L',test_password);
END $$;
COMMIT;
