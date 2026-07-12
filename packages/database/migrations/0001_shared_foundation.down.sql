BEGIN;

DROP SCHEMA IF EXISTS tanaghom CASCADE;
DELETE FROM public.schema_migrations WHERE version = '0001_shared_foundation';

COMMIT;
