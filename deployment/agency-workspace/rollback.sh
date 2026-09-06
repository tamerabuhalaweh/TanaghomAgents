#!/bin/bash
set -euo pipefail
test "$(id -u)" = 0
test "$(hostname)" = vps-khal-tanaghom
state=$(realpath -e "${1:?recorded update state required}")
case "$state" in /opt/tanaghom-test/runtime/workspace-20*) ;; *) echo 'invalid rollback state' >&2; exit 1;; esac
cd /opt/tanaghom-test/source
old_image=$(cat "$state/old-image")
[[ "$old_image" =~ ^sha256:[a-f0-9]{64}$ ]]
export TANAGHOM_RELEASE="$(git rev-parse HEAD)"
compose=(docker compose -p tanaghom-test -f deployment/fresh-test-vps/compose.yml -f deployment/agency-workspace/compose.yml)
"${compose[@]}" stop workspace-n8n
"${compose[@]}" exec -T postgres psql -U postgres -d tanaghom_test -X -v ON_ERROR_STOP=1 -c "UPDATE tanaghom.agency_workspace_control SET enabled=false,emergency_stop=true,reason='Workspace rollback; evidence preserved',updated_at=now()"
# Keep migration and task/audit history. Never apply the destructive down script
# to a used workspace; never overwrite this DB with the pre-update backup.
docker tag "$old_image" tanaghom-test-dashboard:workspace-rollback
export TANAGHOM_RELEASE=workspace-rollback
docker compose -p tanaghom-test -f deployment/fresh-test-vps/compose.yml up -d --no-deps dashboard caddy
curl -fsS --connect-timeout 5 --max-time 15 --retry 10 --retry-delay 2 --retry-all-errors https://tanaghom-test.155-117-45-45.sslip.io/api/health
echo 'Previous dashboard restored; new workspace dispatch stopped; DB evidence retained'
