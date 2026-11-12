BEGIN;

-- WS5: tenant onboarding. Business-profile fields and a completion timestamp
-- live beside the tenant record; wizard progress is derived from these fields
-- plus the real brand-kit/knowledge/integration rows instead of a second
-- progress store.

DO $$ BEGIN
  IF (SELECT count(*) FROM public.schema_migrations) <> 46
     OR (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0049_tenant_auth' THEN
    RAISE EXCEPTION '0050 requires the exact 0049 ledger (46 migrations)';
  END IF;
END $$;

ALTER TABLE tanaghom.organizations
  ADD COLUMN business_name_en text CHECK (
    business_name_en IS NULL OR length(trim(business_name_en)) BETWEEN 2 AND 120
  ),
  ADD COLUMN business_name_ar text CHECK (
    business_name_ar IS NULL OR length(trim(business_name_ar)) BETWEEN 2 AND 120
  ),
  ADD COLUMN industry text CHECK (
    industry IS NULL OR industry IN (
      'retail_ecommerce', 'food_hospitality', 'services_consulting',
      'education_training', 'health_wellness', 'beauty_personal_care',
      'real_estate', 'creative_media', 'technology', 'nonprofit', 'other'
    )
  ),
  ADD COLUMN location text CHECK (
    location IS NULL OR length(trim(location)) BETWEEN 2 AND 160
  ),
  ADD COLUMN onboarding_completed_at timestamptz;

GRANT UPDATE (business_name_en, business_name_ar, industry, location, onboarding_completed_at)
  ON tanaghom.organizations TO tanaghom_api;

-- Retire the synthetic tenant that powers the operator demo. Customer views
-- are already organization-scoped, and this org's only human profiles are
-- detached below, so no customer session can resolve into it. Rows remain for
-- audit history; sessions expire, memberships deactivate, and invitation
-- columns are detached together as app_users_invitation_lifecycle requires.
UPDATE tanaghom.campaigns
   SET status = 'closed',
       blocked_reason = 'Archived synthetic demo fixture; not a customer campaign.'
 WHERE organization_id = '10000000-0000-4000-8000-000000000001'
   AND status <> 'closed';

UPDATE tanaghom.organizations
   SET is_active = false
 WHERE id = '10000000-0000-4000-8000-000000000001';

UPDATE tanaghom.integration_connections
   SET status = 'disconnected',
       credential_ciphertext = NULL,
       credential_nonce = NULL,
       credential_auth_tag = NULL,
       credential_key_version = NULL,
       secret_last_four = NULL,
       disconnected_at = coalesce(disconnected_at, now())
 WHERE organization_id = '10000000-0000-4000-8000-000000000001'
   AND status <> 'disconnected';

UPDATE tanaghom.publishing_channels
   SET is_active = false
 WHERE organization_id = '10000000-0000-4000-8000-000000000001'
   AND is_active;

UPDATE tanaghom.users u
   SET disabled = true, session_epoch = session_epoch + 1
 WHERE EXISTS (
   SELECT 1 FROM tanaghom.memberships m
    WHERE m.user_id = u.id
      AND m.organization_id = '10000000-0000-4000-8000-000000000001'
 );

UPDATE tanaghom.sessions
   SET expires_at = now()
 WHERE organization_id = '10000000-0000-4000-8000-000000000001'
   AND expires_at > now();

UPDATE tanaghom.memberships
   SET is_active = false
 WHERE organization_id = '10000000-0000-4000-8000-000000000001'
   AND is_active;

UPDATE tanaghom.app_users
   SET is_active = false, auth_subject = NULL, invited_at = NULL, accepted_at = NULL
 WHERE organization_id = '10000000-0000-4000-8000-000000000001'
   AND kind = 'human';

INSERT INTO public.schema_migrations(version)
VALUES ('0050_tenant_onboarding');

COMMIT;
