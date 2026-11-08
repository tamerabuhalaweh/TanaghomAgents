#!/bin/bash
# Idempotent Postiz bootstrap for the Tanaghom Phase 1 host (#265).
#
# Seeds or verifies the Postiz owner organization, owner user and organization
# API key inside postiz-postgres, then writes the runtime credential the
# Tanaghom dashboard uses. A re-run only reports state: it never rotates an
# existing key, never resets an existing password and never prints a secret.
#
#   POSTIZ_SECRETS_DIR=/home/ubuntu/tanaghom-demo/runtime/secrets \
#     bash deployment/postiz/scripts/postiz-bootstrap.sh
#
# Safe to run while Postiz serves the operator UI. It reads and writes only the
# Postiz database and, when present, the runtime secrets directory.
set -euo pipefail

project="${POSTIZ_PROJECT:-postiz}"
db_container="${POSTIZ_DB_CONTAINER:-postiz-postiz-postgres-1}"
secrets_dir="${POSTIZ_SECRETS_DIR:-/home/ubuntu/tanaghom-demo/runtime/secrets}"
owner_email="${POSTIZ_OWNER_EMAIL:-owner@demo.tanaghom.test}"
org_name="${POSTIZ_ORG_NAME:-Tanaghom}"
org_id="${POSTIZ_ORG_ID:-10000000-0000-4000-8000-00000000c001}"
user_id="${POSTIZ_USER_ID:-10000000-0000-4000-8000-00000000c002}"
membership_id="${POSTIZ_MEMBERSHIP_ID:-10000000-0000-4000-8000-00000000c003}"
db_user="${POSTIZ_DB_USER:-postiz}"
db_name="${POSTIZ_DB_NAME:-postiz}"

refuse() { echo "POSTIZ_BOOTSTRAP_REFUSED: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || refuse "docker is unavailable"
docker info >/dev/null 2>&1 || refuse "docker is unavailable"
command -v openssl >/dev/null 2>&1 || refuse "openssl is unavailable"
docker ps --format '{{.Names}}' | grep -Fxq "$db_container" ||
  refuse "postiz database container '$db_container' is not running (project $project)"
docker exec "$db_container" pg_isready -U "$db_user" -d "$db_name" >/dev/null 2>&1 ||
  refuse "postiz database is not ready"

# SQL always arrives on stdin: a generated key or password is never placed in a
# process argument, a shell trace, a log line or this script's output.
run_sql() { docker exec -i "$db_container" psql -X -At -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name"; }
q() { printf '%s\n' "$1" | run_sql; }

table_present="$(q "SELECT to_regclass('\"Organization\"') IS NOT NULL")"
[ "$table_present" = "t" ] || refuse "postiz schema is not migrated (no Organization table)"

# --- owner organization -------------------------------------------------------
org_present="$(q "SELECT count(*) FROM \"Organization\" WHERE id='$org_id'")"
org_state=present
apiKey=""
if [ "$org_present" = "0" ]; then
  apiKey="$(openssl rand -hex 32)"
  q "INSERT INTO \"Organization\" (id,name,description,\"apiKey\",\"createdAt\",\"updatedAt\",\"allowTrial\",\"isTrailing\")
     VALUES ('$org_id','$org_name','Tanaghom Phase 1 owner organization','$apiKey',now(),now(),false,false)" >/dev/null
  org_state=created
fi

org_key_len="$(q "SELECT coalesce(length(\"apiKey\"),0) FROM \"Organization\" WHERE id='$org_id'")"
[ -n "$org_key_len" ] || refuse "owner organization row is missing after insert"
if [ "$org_key_len" != "64" ]; then
  # An existing organization with a missing or short key cannot authenticate the
  # dashboard. Rotating it silently would invalidate a working host, so require
  # the operator to ask for it.
  [ "${POSTIZ_ALLOW_KEY_ROTATION:-false}" = "true" ] ||
    refuse "organization $org_id has an apiKey of length $org_key_len, expected 64; set POSTIZ_ALLOW_KEY_ROTATION=true to replace it"
  apiKey="$(openssl rand -hex 32)"
  q "UPDATE \"Organization\" SET \"apiKey\"='$apiKey', \"updatedAt\"=now() WHERE id='$org_id'" >/dev/null
  org_state=key-rotated
fi

# --- owner user ---------------------------------------------------------------
user_present="$(q "SELECT count(*) FROM \"User\" WHERE email='$owner_email' AND \"providerName\"='LOCAL'")"
password=""
user_state=present
if [ "$user_present" = "0" ]; then
  password="$(openssl rand -hex 24)"
  q "CREATE EXTENSION IF NOT EXISTS pgcrypto" >/dev/null
  # pgcrypto's bcrypt ($2a$) is accepted by the Postiz password verifier.
  q "INSERT INTO \"User\" (id,email,password,\"providerName\",name,\"lastName\",\"isSuperAdmin\",activated,
       account,\"connectedAccount\",audience,timezone,\"timezoneName\",bio,
       \"sendSuccessEmails\",\"sendFailureEmails\",\"sendStreakEmails\",\"createdAt\",\"updatedAt\")
     VALUES ('$user_id','$owner_email', crypt('$password', gen_salt('bf', 12)), 'LOCAL', 'Owner', '', false, true,
       '', false, 0, 0, 'UTC', '', false, false, false, now(), now())" >/dev/null
  user_state=created
fi

# --- membership ---------------------------------------------------------------
member_present="$(q "SELECT count(*) FROM \"UserOrganization\"
  WHERE \"organizationId\"='$org_id' AND \"userId\"=(SELECT id FROM \"User\" WHERE email='$owner_email' AND \"providerName\"='LOCAL')")"
if [ "$member_present" = "0" ]; then
  q "INSERT INTO \"UserOrganization\" (id,\"userId\",\"organizationId\",disabled,role,\"createdAt\",\"updatedAt\")
     VALUES ('$membership_id',
       (SELECT id FROM \"User\" WHERE email='$owner_email' AND \"providerName\"='LOCAL'),
       '$org_id', false, 'ADMIN', now(), now())" >/dev/null
fi

# --- runtime credentials ------------------------------------------------------
if [ -d "$secrets_dir" ]; then
  if [ ! -s "$secrets_dir/postiz_api_key" ]; then
    [ -n "$apiKey" ] || apiKey="$(q "SELECT \"apiKey\" FROM \"Organization\" WHERE id='$org_id'")"
    (umask 077 && printf '%s\n' "$apiKey" > "$secrets_dir/postiz_api_key")
  fi
  chmod 0600 "$secrets_dir/postiz_api_key"
  if [ -n "$password" ] && [ ! -s "$secrets_dir/postiz_owner_password" ]; then
    (umask 077 && printf '%s\n' "$password" > "$secrets_dir/postiz_owner_password")
  fi
  [ -f "$secrets_dir/postiz_owner_password" ] && chmod 0600 "$secrets_dir/postiz_owner_password"
  staged="$(head -c 128 "$secrets_dir/postiz_api_key" | tr -d '[:space:]')"
  live="$(q "SELECT \"apiKey\" FROM \"Organization\" WHERE id='$org_id'")"
  [ "$staged" = "$live" ] || refuse "runtime postiz_api_key does not match the organization apiKey in the database"
  key_verified=yes
  [ -s "$secrets_dir/postiz_owner_password" ] && password_state=staged || password_state=missing
else
  echo "POSTIZ_BOOTSTRAP_NOTE no runtime secrets directory at $secrets_dir; credentials were not written"
  key_verified=skipped
  password_state=$([ -n "$password" ] && echo generated-not-saved || echo unknown)
fi

# --- verification (booleans only) ---------------------------------------------
role="$(q "SELECT role FROM \"UserOrganization\"
  WHERE \"organizationId\"='$org_id' AND \"userId\"=(SELECT id FROM \"User\" WHERE email='$owner_email' AND \"providerName\"='LOCAL')")"
integrations="$(q "SELECT count(*) FROM \"Integration\"")"

echo "POSTIZ_BOOTSTRAP_OK project=$project org=$org_id org_state=$org_state user_state=$user_state role=${role:-missing} integrations=$integrations api_key_length=${#org_key_len} key_matches_runtime=$key_verified owner_password=$password_state"
