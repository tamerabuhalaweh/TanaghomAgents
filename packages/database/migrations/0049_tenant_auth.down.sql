BEGIN;

DROP TABLE IF EXISTS tanaghom.sessions;
DROP TABLE IF EXISTS tanaghom.auth_tokens;
DROP TABLE IF EXISTS tanaghom.memberships;
DROP TABLE IF EXISTS tanaghom.users;

ALTER TABLE tanaghom.organizations
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS default_locale;

DELETE FROM public.schema_migrations WHERE version = '0049_tenant_auth';

COMMIT;
