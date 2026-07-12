BEGIN;

ALTER TABLE tanaghom.app_users
  ADD COLUMN auth_subject uuid,
  ADD CONSTRAINT app_users_auth_subject_human_only
    CHECK (auth_subject IS NULL OR kind = 'human');

CREATE UNIQUE INDEX app_users_auth_subject_uidx
  ON tanaghom.app_users(auth_subject)
  WHERE auth_subject IS NOT NULL;

INSERT INTO public.schema_migrations(version)
VALUES ('0002_auth_subjects');

COMMIT;
