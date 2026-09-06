#!/bin/bash
set -euo pipefail
test "$(id -u)" = 0
test "$(hostname)" = vps-khal-tanaghom
cd /opt/tanaghom-test/source
export TANAGHOM_RELEASE="$(git rev-parse HEAD)"
test "$TANAGHOM_RELEASE" = "${EXPECTED_WORKSPACE_RELEASE:?exact release required}"
test -z "$(git status --porcelain)"
base=(docker compose -p tanaghom-test -f deployment/fresh-test-vps/compose.yml)
compose=("${base[@]}" -f deployment/agency-workspace/compose.yml)
resume=false
if [ -n "${WORKSPACE_RESUME_STATE:-}" ]; then
 state=$(realpath -e "$WORKSPACE_RESUME_STATE")
 case "$state" in /opt/tanaghom-test/runtime/workspace-20*) ;; *) echo 'invalid resume state' >&2; exit 1;; esac
 test -s "$state/old-image" && test -f "$state/runtime-changed"
 sha256sum -c "$state/backup.sha256"
 test "$("${base[@]}" exec -T postgres psql -U postgres -d tanaghom_test -X -Atc 'SELECT max(version) FROM public.schema_migrations')" = 0035_agency_workspace
 test "$("${base[@]}" exec -T postgres psql -U postgres -d tanaghom_test -X -Atc 'SELECT count(*) FROM tanaghom.agency_workspaces')" = 0
 test "$("${base[@]}" exec -T postgres psql -U postgres -d tanaghom_test -X -Atc 'SELECT NOT enabled AND emergency_stop FROM tanaghom.agency_workspace_control')" = t
 test -z "$("${compose[@]}" ps -aq workspace-n8n)"
 for secret in workspace_worker_password workspace_database_url workspace_worker_token workspace_n8n_key; do test -s "/opt/tanaghom-test/runtime/secrets/$secret"; done
 resume=true
else
 state="/opt/tanaghom-test/runtime/workspace-$(date -u +%Y%m%dT%H%M%SZ)"
 mkdir -m 700 "$state"
 old_dashboard=$(docker ps -q --filter label=com.docker.compose.project=tanaghom-test --filter label=com.docker.compose.service=dashboard)
 test -n "$old_dashboard"
 docker inspect --format '{{.Image}}' "$old_dashboard" > "$state/old-image"
 docker inspect --format '{{.Config.Image}}' "$old_dashboard" > "$state/old-tag"
 test "$("${base[@]}" exec -T postgres psql -U postgres -d tanaghom_test -X -Atc 'SELECT max(version) FROM public.schema_migrations')" = 0034_agency_pilot_integration
 test ! -e /opt/tanaghom-test/runtime/secrets/workspace_worker_password
fi
test "$(df --output=avail -BG / | tail -1 | tr -dc '0-9')" -ge 15
committed=false
trap 'if ! $committed; then echo "UPDATE_NOT_COMMITTED; database evidence preserved. Run documented rollback using $state" >&2; if test -f "$state/runtime-changed"; then bash deployment/agency-workspace/rollback.sh "$state"; fi; fi' EXIT
# Build before any database or running-container change.
"${base[@]}" build dashboard
if ! $resume; then
umask 077
openssl rand -hex 32 > "$state/backup-key"
"${base[@]}" exec -T postgres pg_dump -U postgres -d tanaghom_test -Fc --no-owner --no-acl | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$state/backup-key" -out "$state/0034.dump.enc"
openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$state/backup-key" -in "$state/0034.dump.enc" | "${base[@]}" exec -T postgres pg_restore --list > "$state/backup-toc.txt"
test -s "$state/backup-toc.txt"
sha256sum "$state/0034.dump.enc" > "$state/backup.sha256"
python3 deployment/agency-workspace/prepare-secrets.py
fi
"${compose[@]}" config --quiet
"${compose[@]}" pull workspace-n8n
if ! $resume; then
 "${base[@]}" exec -T postgres psql -U postgres -d tanaghom_test -X -v ON_ERROR_STOP=1 < packages/database/migrations/0035_agency_workspace.up.sql
fi
touch "$state/runtime-changed"
# Add the worker secret mount to this test PostgreSQL only; preserve its volume.
"${compose[@]}" up -d --no-deps postgres
for attempt in $(seq 1 40); do
 if "${compose[@]}" exec -T postgres pg_isready -U postgres -d tanaghom_test >/dev/null 2>&1; then break; fi
 sleep 1
done
"${compose[@]}" exec -T postgres psql -U postgres -d tanaghom_test -X -v ON_ERROR_STOP=1 < deployment/agency-workspace/configure-worker.sql
"${compose[@]}" run --rm -T --no-deps --entrypoint node dashboard < deployment/agency-workspace/validate.cjs
"${compose[@]}" run --rm -T --no-deps --entrypoint /bin/sh workspace-n8n /workspace/import.sh > "$state/n8n-import.log" 2>&1
"${compose[@]}" up -d --no-deps dashboard caddy workspace-n8n
healthy=false
for attempt in $(seq 1 60); do
 all=true
 for service in postgres dashboard workspace-n8n; do
  cid=$("${compose[@]}" ps -q "$service")
  if [ -z "$cid" ] || [ "$(docker inspect --format '{{.State.Health.Status}}' "$cid")" != healthy ]; then all=false; fi
 done
 if $all; then healthy=true; break; fi
 sleep 2
done
$healthy
curl -fsS --connect-timeout 5 --max-time 15 https://tanaghom-test.155-117-45-45.sslip.io/api/health > "$state/health.json"
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 https://tanaghom-test.155-117-45-45.sslip.io/api/workspace)" = 401
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST https://tanaghom-test.155-117-45-45.sslip.io/api/internal/agency-workspace)" = 404
"${compose[@]}" exec -T workspace-n8n node -e "fetch('http://dashboard:3000/api/internal/agency-workspace',{method:'POST'}).then(r=>{if(r.status!==401)process.exit(1);console.log('private gateway reachable; missing token rejected')})"
"${compose[@]}" exec -T workspace-n8n n8n audit > "$state/n8n-audit.txt" 2>&1
# Deliberately no workflow publication, stop release, task creation or inference.
"${compose[@]}" exec -T workspace-n8n n8n export:workflow --id=tanaghomAgencyWorkspaceV1 --output=/tmp/workspace-export.json >/dev/null
"${compose[@]}" exec -T workspace-n8n node -e "const f=require('/tmp/workspace-export.json');if(f.length!==1||f[0].active)process.exit(1);console.log('workspace workflow imported inactive')"
printf '%s\n' "$TANAGHOM_RELEASE" > "$state/release"
printf '%s\n' "$state" > /opt/tanaghom-test/runtime/workspace-update-state
committed=true
echo "WORKSPACE_UPDATE_COMMITTED=$TANAGHOM_RELEASE"
echo "EVIDENCE=$state"
echo 'MODEL_NOT_ENABLED: Gemma credential and real bilingual canary still required'
