#!/bin/sh
set -eu

read_secret() {
  name="$1"
  path="/run/secrets/$2"
  test -s "$path" || { echo "required secret file is missing: $2" >&2; exit 1; }
  value="$(cat "$path")"
  export "$name=$value"
}

read_secret DATABASE_URL database_url
read_secret SUPABASE_URL supabase_url
read_secret SUPABASE_PUBLISHABLE_KEY supabase_publishable_key
read_secret SUPABASE_JWKS_URL supabase_jwks_url
read_secret AGENCY_WORKSPACE_DATABASE_URL workspace_database_url
read_secret AGENCY_WORKSPACE_WORKER_TOKEN workspace_worker_token

test -s /run/secrets/s3_access_key
test -s /run/secrets/s3_secret_key
test -e /run/secrets/gemini_api_key
export GEMINI_API_KEY_FILE=/run/secrets/gemini_api_key

exec node apps/dashboard/server.js
