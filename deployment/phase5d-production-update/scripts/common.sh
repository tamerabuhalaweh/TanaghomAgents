#!/bin/sh
set -eu

PRODUCTION_ROOT=${TANAGHOM_PRODUCTION_ROOT:-/opt/tanaghom-dashboard}
SCRIPT_DIR_COMMON=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_SOURCE_ROOT=${TANAGHOM_RELEASE_SOURCE_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR_COMMON/../../.." && pwd)}
PROJECT=tanaghom-dashboard-canary
BASE_COMPOSE="$PRODUCTION_ROOT/deployment/dashboard-canary/docker-compose.yml"
PUBLIC_COMPOSE="$PRODUCTION_ROOT/deployment/dashboard-public/docker-compose.yml"
DATABASE_SECRET="$PRODUCTION_ROOT/deployment/dashboard-canary/secrets/database_url"
PUBLIC_HOST=tanaghom.38-247-187-232.sslip.io
EXPECTED_START_MIGRATION=0009_postiz_automation_controls
TARGET_MIGRATION=0014_supervised_conversation_ownership
PENDING_MIGRATIONS='0010_postiz_performance_monitoring 0011_ghl_contact_sync 0012_ghl_inbound_event_inbox 0013_sales_knowledge_intelligence 0014_supervised_conversation_ownership'
PROTECTED_UNITS='smartlabs-api.service convai-ws.service convai-stt-api.service omnivoice-tts.service gemma4-26b-a4b-vllm-canary.service smartcc-api.service smartcc-smartlabs-bridge.service smartcc-web.service nginx.service'
PROTECTED_N8N_CONTAINERS='smartlabs-n8n-postgres-1 smartlabs-n8n-redis-1 smartlabs-n8n-egress-proxy-1 smartlabs-n8n-n8n-1 smartlabs-n8n-n8n-worker-1'

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_root() {
  test "$(id -u)" -eq 0 || die 'run with sudo; privileged preflight is required'
}

require_release_environment() {
  test "${TANAGHOM_RELEASE_AUTHORIZATION:-}" = 'YES-I-AM-THE-AUTHORIZED-OWNER' || die 'explicit owner authorization is absent'
  case "${TANAGHOM_RELEASE_ID:-}" in
    phase5d-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_RELEASE_ID must use phase5d-YYYYMMDDTHHMMSSZ' ;;
  esac
  for value in "${TANAGHOM_EXPECTED_CURRENT_COMMIT:-}" "${TANAGHOM_TARGET_COMMIT:-}"; do
    echo "$value" | grep -Eq '^[0-9a-f]{40}$' || die 'expected and target commits must be full lowercase Git SHAs'
  done
  test "$TANAGHOM_EXPECTED_CURRENT_COMMIT" != "$TANAGHOM_TARGET_COMMIT" || die 'current and target commits must differ'
  test -n "${TANAGHOM_BACKUP_PROOF:-}" || die 'TANAGHOM_BACKUP_PROOF is required'
}

database_url() {
  test -s "$DATABASE_SECRET" || die 'database secret is missing'
  cat "$DATABASE_SECRET"
}

db_scalar() {
  url=$(database_url)
  PGAPPNAME=tanaghom-phase5d-release psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"
  unset url
}

db_file() {
  url=$(database_url)
  status=0
  PGAPPNAME=tanaghom-phase5d-release psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" || status=$?
  unset url
  return "$status"
}

latest_migration() {
  db_scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;"
}

compose() {
  docker compose -p "$PROJECT" -f "$BASE_COMPOSE" -f "$PUBLIC_COMPOSE" "$@"
}

proof_value() {
  key=$1
  awk -F= -v wanted="$key" '$1 == wanted { print substr($0, index($0, "=") + 1); found=1 } END { if (!found) exit 1 }' "$TANAGHOM_BACKUP_PROOF"
}

validate_backup_proof() {
  test -f "$TANAGHOM_BACKUP_PROOF" || die 'off-server backup proof is missing'
  test ! -L "$TANAGHOM_BACKUP_PROOF" || die 'backup proof must not be a symbolic link'
  test "$(stat -c '%a' "$TANAGHOM_BACKUP_PROOF")" = 600 || die 'backup proof mode must be 0600'
  test "$(proof_value RELEASE_ID)" = "$TANAGHOM_RELEASE_ID" || die 'backup proof release ID mismatch'
  test "$(proof_value SOURCE_MIGRATION)" = "$EXPECTED_START_MIGRATION" || die 'backup proof migration mismatch'
  test "$(proof_value RESTORE_VERIFIED)" = YES || die 'backup restoration was not verified'
  proof_value ARCHIVE_SHA256 | grep -Eq '^[0-9A-Fa-f]{64}$' || die 'backup archive checksum is invalid'
}

assert_protected_units_active() {
  for unit in $PROTECTED_UNITS; do
    test "$(systemctl is-active "$unit")" = active || die "protected unit is not active: $unit"
  done
}

container_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null
}

assert_protected_containers_healthy() {
  for container in $PROTECTED_N8N_CONTAINERS; do
    test "$(container_health "$container")" = healthy || die "protected n8n container is not healthy: $container"
  done
}

capture_protected_container_ids() {
  destination=$1
  : > "$destination"
  chmod 0600 "$destination"
  for container in $PROTECTED_N8N_CONTAINERS; do
    docker inspect -f '{{.Name}}={{.Id}}' "$container" | sed 's#^/##' >> "$destination"
  done
}

assert_protected_container_ids_unchanged() {
  expected=$1
  actual=$(mktemp)
  capture_protected_container_ids "$actual"
  cmp -s "$expected" "$actual" || die 'a protected n8n container was recreated'
  rm -f "$actual"
}

assert_database_locked() {
  test "$(latest_migration)" = "$1" || die "unexpected migration ledger; expected $1"
  test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 || die 'a provider emergency stop is inactive'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_automation_policies WHERE postiz_draft_mode <> 'manual';")" = 0 || die 'Postiz organization mode is not manual'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 || die 'external operations exist'
}

assert_public_boundary() {
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/login")" = 200 || die 'public login is unhealthy'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/")" = 307 || die 'unauthenticated root boundary changed'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/operations")" = 401 || die 'protected API boundary changed'
  if timeout 4 bash -c "</dev/tcp/38.247.187.232/5678" 2>/dev/null; then
    die 'public TCP 5678 is reachable'
  fi
}

evidence_value() {
  file=$1
  key=$2
  awk -F= -v wanted="$key" '$1 == wanted { print substr($0, index($0, "=") + 1); found=1 } END { if (!found) exit 1 }' "$file"
}

assert_firewall_boundary() {
  iptables -C DOCKER-USER -j TANAGHOM_N8N_DB_EGRESS >/dev/null 2>&1 || die 'approved Tanaghom n8n database firewall hook is absent'
  ! iptables -S DOCKER-USER | grep -q TANAGHOM_N8N_GATEWAY_EGRESS || die 'rolled-back Phase 4F gateway firewall hook is unexpectedly present'
}

capture_firewall_boundary() {
  destination=$1
  {
    iptables -S TANAGHOM_N8N_DB_EGRESS
    iptables -S TANAGHOM_N8N_DB_INPUT
    iptables -S DOCKER-USER | grep TANAGHOM_N8N_DB_EGRESS
    iptables -S INPUT | grep TANAGHOM_N8N_DB_INPUT
  } > "$destination"
  chmod 0600 "$destination"
}

assert_secret_metadata() {
  secret_dir="$PRODUCTION_ROOT/deployment/dashboard-canary/secrets"
  test "$(stat -c '%a' "$secret_dir")" = 710 || die 'secret directory mode must be 0710'
  for name in database_url supabase_url supabase_publishable_key supabase_jwks_url supabase_secret_key integration_credential_key integration_worker_token; do
    file="$secret_dir/$name"
    test -s "$file" || die "required secret file is missing: $name"
    mode=$(stat -c '%a' "$file")
    case "$mode" in 400|440|600|640) ;; *) die "unsafe secret mode for $name: $mode" ;; esac
  done
}
