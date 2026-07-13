BEGIN;

REVOKE INSERT (email, display_name, kind, role, is_active, auth_subject, invited_by, invited_at)
ON tanaghom.app_users FROM tanaghom_api;
REVOKE UPDATE (display_name, role, is_active, accepted_at)
ON tanaghom.app_users FROM tanaghom_api;

ALTER TABLE tanaghom.app_users
  DROP CONSTRAINT app_users_invitation_lifecycle,
  DROP COLUMN accepted_at,
  DROP COLUMN invited_at,
  DROP COLUMN invited_by;

DELETE FROM public.schema_migrations
WHERE version = '0006_team_invitations';

COMMIT;
