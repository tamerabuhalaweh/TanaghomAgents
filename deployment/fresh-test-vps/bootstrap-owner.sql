\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'tanaghom_test' OR
     (SELECT count(*) FROM public.schema_migrations) <> 34 THEN
    RAISE EXCEPTION 'fresh test database at migration 0034 required';
  END IF;
  IF EXISTS (SELECT 1 FROM tanaghom.app_users) THEN
    RAISE EXCEPTION 'refuse reseeding a database with users';
  END IF;
END $$;
UPDATE tanaghom.organizations SET name = 'Tanaghom Test Workspace'
WHERE id = '10000000-0000-4000-8000-000000000001';
INSERT INTO tanaghom.app_users(email,display_name,kind,role,auth_subject,accepted_at)
VALUES (:'owner_email','Tamer — Test Owner','human','owner',:'owner_subject'::uuid,now());
COMMIT;
