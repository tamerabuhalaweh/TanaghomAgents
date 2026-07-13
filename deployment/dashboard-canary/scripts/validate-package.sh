#!/bin/sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"
package="$root/deployment/dashboard-canary"

cd "$package"
docker compose -p tanaghom-dashboard-canary -f docker-compose.yml config --quiet
test "$(docker compose -p tanaghom-dashboard-canary -f docker-compose.yml config --services)" = dashboard
grep -Fq '127.0.0.1:3200:3000' docker-compose.yml
grep -Fq 'read_only: true' docker-compose.yml
grep -Fq 'no-new-privileges:true' docker-compose.yml
grep -Fq 'cap_drop:' docker-compose.yml

for secret in database_url supabase_url supabase_publishable_key supabase_jwks_url supabase_secret_key; do
  test ! -e "secrets/$secret" || { echo "runtime secret exists in source package: $secret" >&2; exit 1; }
done

echo "dashboard canary package validation passed"
