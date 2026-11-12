BEGIN;

-- Reverses the schema change only. Demo-tenant retirement is one-way: the
-- down migration never reactivates accounts, sessions, channels, or campaigns.

ALTER TABLE tanaghom.organizations
  DROP COLUMN IF EXISTS onboarding_completed_at,
  DROP COLUMN IF EXISTS location,
  DROP COLUMN IF EXISTS industry,
  DROP COLUMN IF EXISTS business_name_ar;

DELETE FROM public.schema_migrations WHERE version = '0050_tenant_onboarding';

COMMIT;
