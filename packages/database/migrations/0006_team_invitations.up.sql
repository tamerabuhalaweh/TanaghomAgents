BEGIN;

ALTER TABLE tanaghom.app_users
  ADD COLUMN invited_by uuid REFERENCES tanaghom.app_users(id),
  ADD COLUMN invited_at timestamptz,
  ADD COLUMN accepted_at timestamptz;

UPDATE tanaghom.app_users
SET accepted_at = created_at
WHERE kind = 'human' AND auth_subject IS NOT NULL;

ALTER TABLE tanaghom.app_users
  ADD CONSTRAINT app_users_invitation_lifecycle CHECK (
    kind = 'service'
    OR (auth_subject IS NULL AND invited_at IS NULL AND accepted_at IS NULL)
    OR (auth_subject IS NOT NULL AND accepted_at IS NOT NULL)
    OR (auth_subject IS NOT NULL AND invited_at IS NOT NULL AND accepted_at IS NULL)
  );

GRANT INSERT (email, display_name, kind, role, is_active, auth_subject, invited_by, invited_at)
ON tanaghom.app_users TO tanaghom_api;
GRANT UPDATE (display_name, role, is_active, accepted_at)
ON tanaghom.app_users TO tanaghom_api;

INSERT INTO public.schema_migrations(version)
VALUES ('0006_team_invitations');

COMMIT;
