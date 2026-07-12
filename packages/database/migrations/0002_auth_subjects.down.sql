BEGIN;

DROP INDEX tanaghom.app_users_auth_subject_uidx;
ALTER TABLE tanaghom.app_users
  DROP CONSTRAINT app_users_auth_subject_human_only,
  DROP COLUMN auth_subject;

DELETE FROM public.schema_migrations
WHERE version = '0002_auth_subjects';

COMMIT;
