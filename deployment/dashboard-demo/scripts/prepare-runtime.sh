#!/bin/sh
set -eu

directory="${1:-/opt/tanaghom-demo/runtime/secrets}"
umask 077

command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }
mkdir -p "$directory"

required="postgres_password api_password database_url supabase_url supabase_publishable_key supabase_jwks_url auth_users.json auth_private_key.pem s3_access_key s3_secret_key workspace_password workspace_database_url workspace_worker_token gemini_api_key demo-credentials.txt"
for name in $required; do
  if [ -e "$directory/$name" ]; then
    echo "refusing to overwrite existing demo runtime secret: $name" >&2
    exit 2
  fi
done

postgres_password="$(openssl rand -hex 32)"
api_password="$(openssl rand -hex 32)"
workspace_password="$(openssl rand -hex 32)"
workspace_worker_token="$(openssl rand -hex 32)"
s3_access_key="demo$(openssl rand -hex 12)"
s3_secret_key="$(openssl rand -hex 32)"
owner_password="${DEMO_OWNER_PASSWORD:-$(openssl rand -hex 24)}"
reviewer_password="${DEMO_REVIEWER_PASSWORD:-$(openssl rand -hex 24)}"

if [ "${#owner_password}" -lt 16 ] || [ "${#reviewer_password}" -lt 16 ]; then
  echo "DEMO_OWNER_PASSWORD and DEMO_REVIEWER_PASSWORD must be at least 16 characters" >&2
  exit 1
fi

printf '%s\n' "$postgres_password" > "$directory/postgres_password"
printf '%s\n' "$api_password" > "$directory/api_password"
printf 'postgresql://tanaghom_api:%s@postgres:5432/tanaghom_demo\n' "$api_password" > "$directory/database_url"
printf 'postgresql://tanaghom_agency_pilot_worker:%s@postgres:5432/tanaghom_demo\n' "$workspace_password" > "$directory/workspace_database_url"
printf '%s\n' "$workspace_worker_token" > "$directory/workspace_worker_token"
printf '%s\n' "$workspace_password" > "$directory/workspace_password"
: > "$directory/gemini_api_key"
printf '%s\n' 'http://auth:43191' > "$directory/supabase_url"
printf '%s\n' 'demo-publishable-key' > "$directory/supabase_publishable_key"
printf '%s\n' 'http://auth:43191/auth/v1/.well-known/jwks.json' > "$directory/supabase_jwks_url"
printf '%s\n' "$s3_access_key" > "$directory/s3_access_key"
printf '%s\n' "$s3_secret_key" > "$directory/s3_secret_key"

cat > "$directory/auth_users.json" <<EOF
{
  "users": [
    {
      "email": "owner@demo.tanaghom.test",
      "password": "$owner_password",
      "sub": "90000000-0000-4000-8000-000000000001"
    },
    {
      "email": "reviewer@demo.tanaghom.test",
      "password": "$reviewer_password",
      "sub": "90000000-0000-4000-8000-000000000011"
    }
  ]
}
EOF

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$directory/auth_private_key.pem" 2>/dev/null

cat > "$directory/demo-credentials.txt" <<EOF
Tanaghom demo accounts (synthetic; private handoff only)
owner@demo.tanaghom.test
$owner_password

reviewer@demo.tanaghom.test
$reviewer_password
EOF

chmod 0700 "$directory"
chmod 0444 \
  "$directory/postgres_password" \
  "$directory/api_password" \
  "$directory/database_url" \
  "$directory/supabase_url" \
  "$directory/supabase_publishable_key" \
  "$directory/supabase_jwks_url" \
  "$directory/auth_users.json" \
  "$directory/auth_private_key.pem" \
  "$directory/s3_access_key" \
  "$directory/s3_secret_key" \
  "$directory/workspace_password" \
  "$directory/workspace_database_url" \
  "$directory/workspace_worker_token" \
  "$directory/gemini_api_key"
chmod 0600 "$directory/demo-credentials.txt"
echo "Demo runtime secrets created. Credentials are in $directory/demo-credentials.txt"
