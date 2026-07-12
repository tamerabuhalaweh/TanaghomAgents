BEGIN;

DROP TABLE tanaghom.api_idempotency_keys;

DELETE FROM public.schema_migrations
WHERE version = '0003_api_idempotency';

COMMIT;
