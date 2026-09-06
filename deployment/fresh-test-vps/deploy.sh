#!/bin/bash
set -euo pipefail
test "$(id -u)" = 0
test "$(hostname)" = vps-khal-tanaghom
cd /opt/tanaghom-test/source
test -z "$(git status --porcelain)"
export TANAGHOM_RELEASE="$(git rev-parse HEAD)"
test "$TANAGHOM_RELEASE" = "${EXPECTED_TEST_RELEASE:?exact release required}"
compose=(docker compose -p tanaghom-test -f deployment/fresh-test-vps/compose.yml)
committed=false
trap 'if ! $committed; then "${compose[@]}" stop caddy dashboard >/dev/null 2>&1 || true; echo "DEPLOYMENT_NOT_COMMITTED: test DB and evidence preserved" >&2; fi' EXIT
test "$(df --output=avail -BG / | tail -1 | tr -dc '0-9')" -ge 20
test -d /opt/tanaghom-test/runtime/secrets
"${compose[@]}" config --quiet
"${compose[@]}" config --format json | python3 deployment/fresh-test-vps/validate-compose.py
"${compose[@]}" pull postgres caddy
"${compose[@]}" up -d postgres
healthy=false
for attempt in $(seq 1 30); do
  if "${compose[@]}" exec -T postgres pg_isready -U postgres -d tanaghom_test >/dev/null; then healthy=true; break; fi
  sleep 2
done
$healthy
for migration in packages/database/migrations/*.up.sql; do
  version="$(basename "$migration" .up.sql)"
  ledger=$("${compose[@]}" exec -T postgres psql -U postgres -d tanaghom_test -X -Atc "SELECT to_regclass('public.schema_migrations') IS NOT NULL")
  if [ "$ledger" = t ]; then
    applied=$("${compose[@]}" exec -T postgres psql -U postgres -d tanaghom_test -X -Atc "SELECT count(*) FROM public.schema_migrations WHERE version='$version'")
    [ "$applied" = 1 ] && continue
  fi
  "${compose[@]}" exec -T postgres psql -U postgres -d tanaghom_test -X -v ON_ERROR_STOP=1 < "$migration"
done
"${compose[@]}" exec -T postgres psql -U postgres -d tanaghom_test -X -v ON_ERROR_STOP=1 < deployment/fresh-test-vps/configure-api-role.sql
owner_count=$("${compose[@]}" exec -T postgres psql -U postgres -d tanaghom_test -X -Atc 'SELECT count(*) FROM tanaghom.app_users')
if [ "$owner_count" = 0 ]; then
  owner_subject=$(python3 -c "import json;print(json.load(open('/opt/tanaghom-test/runtime/owner.json'))['owner_subject'])")
  owner_email=$(python3 -c "import json;print(json.load(open('/opt/tanaghom-test/runtime/owner.json'))['owner_email'])")
  "${compose[@]}" exec -T postgres psql -U postgres -d tanaghom_test -X -v ON_ERROR_STOP=1 \
    -v owner_subject="$owner_subject" -v owner_email="$owner_email" < deployment/fresh-test-vps/bootstrap-owner.sql
fi
"${compose[@]}" build dashboard
"${compose[@]}" run --rm -T --no-deps --entrypoint node dashboard < deployment/fresh-test-vps/check-api-database.cjs
"${compose[@]}" up -d dashboard caddy
https_ready=false
for attempt in $(seq 1 40); do
  if curl -fsS --connect-timeout 3 --max-time 5 https://tanaghom-test.155-117-45-45.sslip.io/api/health >/dev/null 2>&1; then https_ready=true; break; fi
  sleep 3
done
$https_ready
bash deployment/fresh-test-vps/validate.sh
committed=true
echo "TEST_DEPLOYMENT_COMMITTED=$TANAGHOM_RELEASE"
