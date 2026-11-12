BEGIN;

-- WS2: tenant auth. Credentials, memberships, one-time tokens and browser
-- sessions move out of the JSON account store and into PostgreSQL so every
-- request can be scoped to an organisation the authenticated user belongs to.

ALTER TABLE tanaghom.organizations
  ADD COLUMN status text NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
  ADD COLUMN stripe_customer_id text UNIQUE,
  ADD COLUMN default_locale text NOT NULL DEFAULT 'en'
    CHECK (default_locale IN ('ar', 'en'));

-- The workspace that existed before self-signup is an active paying tenant,
-- not a trial created through /signup.
UPDATE tanaghom.organizations
   SET status = 'active'
 WHERE created_at < now();

CREATE TABLE tanaghom.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  password_hash text NOT NULL CHECK (password_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$'),
  full_name text NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 120),
  locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('ar', 'en')),
  email_verified_at timestamptz,
  disabled boolean NOT NULL DEFAULT false,
  must_change_password boolean NOT NULL DEFAULT false,
  session_epoch integer NOT NULL DEFAULT 0 CHECK (session_epoch >= 0),
  password_changed_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tanaghom.memberships (
  user_id uuid NOT NULL REFERENCES tanaghom.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer', 'reviewer', 'operator')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);

CREATE TABLE tanaghom.auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES tanaghom.users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'invite')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE TABLE tanaghom.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES tanaghom.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_user_idx ON tanaghom.sessions(user_id, expires_at DESC);
CREATE INDEX auth_tokens_user_idx ON tanaghom.auth_tokens(user_id, purpose);

CREATE TRIGGER users_updated_at BEFORE UPDATE ON tanaghom.users
  FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();
CREATE TRIGGER memberships_updated_at BEFORE UPDATE ON tanaghom.memberships
  FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

-- app_users stays the profile row that existing foreign keys point at. Signup
-- inserts its auth_subject and acceptance in one transaction.
GRANT INSERT (email, display_name, kind, role, is_active, auth_subject, organization_id, invited_at, accepted_at)
ON tanaghom.app_users TO tanaghom_api;

REVOKE ALL ON tanaghom.users, tanaghom.memberships, tanaghom.auth_tokens, tanaghom.sessions
  FROM PUBLIC, tanaghom_readonly, tanaghom_n8n_worker;
GRANT SELECT, INSERT, UPDATE ON tanaghom.users TO tanaghom_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON tanaghom.memberships TO tanaghom_api;
GRANT SELECT, INSERT, UPDATE ON tanaghom.auth_tokens TO tanaghom_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON tanaghom.sessions TO tanaghom_api;
GRANT INSERT ON tanaghom.organizations TO tanaghom_api;
GRANT UPDATE (name, slug, status, stripe_customer_id, default_locale)
  ON tanaghom.organizations TO tanaghom_api;

INSERT INTO public.schema_migrations(version)
VALUES ('0049_tenant_auth');

COMMIT;
