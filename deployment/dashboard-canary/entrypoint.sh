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
read_secret SUPABASE_SECRET_KEY supabase_secret_key

exec node apps/dashboard/server.js
