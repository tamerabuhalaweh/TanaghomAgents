#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
compose=(docker compose -p tanaghom-dashboard-demo -f compose.yml)
: "${TANAGHOM_DEMO_SECRETS_DIR:?set TANAGHOM_DEMO_SECRETS_DIR}"
export TANAGHOM_DEMO_SECRETS_DIR

"${compose[@]}" --profile workspace config --quiet
"${compose[@]}" --profile workspace config --format json | python3 scripts/validate-compose.py

for service in postgres auth storage dashboard; do
  id="$("${compose[@]}" ps -q "$service")"
  test -n "$id"
  test "$(docker inspect --format '{{.State.Health.Status}}' "$id")" = healthy
  test "$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$id")" = 0 || {
    test "$service" = dashboard
    test "$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$id")" = 1
  }
done

test "$(docker inspect --format '{{.State.ExitCode}}' "$("${compose[@]}" ps -aq migrate)")" = 0
test "$(docker inspect --format '{{.State.ExitCode}}' "$("${compose[@]}" ps -aq storage-init)")" = 0

dashboard_id="$("${compose[@]}" ps -q dashboard)"
test "$(docker inspect --format '{{(index (index .HostConfig.PortBindings "3000/tcp") 0).HostIp}}' "$dashboard_id")" = 127.0.0.1
test "$(docker inspect --format '{{(index (index .HostConfig.PortBindings "3000/tcp") 0).HostPort}}' "$dashboard_id")" = 3210
test "$(docker network inspect tanaghom-dashboard-demo-backend --format '{{.Internal}}')" = true

curl --fail --silent --show-error --connect-timeout 3 --max-time 10 http://127.0.0.1:3210/api/health
echo
"${compose[@]}" exec -T \
  -e DEMO_BASE_URL=http://dashboard:3000 \
  -e DEMO_AUTH_USERS_FILE=/run/secrets/auth_users \
  -e SMOKE_WRITE="${SMOKE_WRITE:-0}" \
  -e SMOKE_REJECT="${SMOKE_REJECT:-0}" \
  auth node /app/demo-smoke.mjs

"${compose[@]}" ps
echo "DEMO_VALIDATION_PASSED"
