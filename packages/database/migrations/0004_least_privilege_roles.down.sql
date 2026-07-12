BEGIN;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tanaghom TO PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA tanaghom GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

DROP OWNED BY tanaghom_api;
DROP OWNED BY tanaghom_n8n_worker;
DROP OWNED BY tanaghom_readonly;

DROP ROLE tanaghom_api;
DROP ROLE tanaghom_n8n_worker;
DROP ROLE tanaghom_readonly;

DELETE FROM public.schema_migrations
WHERE version = '0004_least_privilege_roles';

COMMIT;
