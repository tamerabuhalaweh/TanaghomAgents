#!/bin/sh
set -eu

PRODUCTION_ROOT=${TANAGHOM_PRODUCTION_ROOT:-/opt/tanaghom-dashboard}
PROJECT=tanaghom-dashboard-canary
BASE_COMPOSE="$PRODUCTION_ROOT/deployment/dashboard-canary/docker-compose.yml"
PUBLIC_COMPOSE="$PRODUCTION_ROOT/deployment/dashboard-public/docker-compose.yml"
DATABASE_SECRET="$PRODUCTION_ROOT/deployment/dashboard-canary/secrets/database_url"
EXPECTED_START_MIGRATION=0026_skill_registry
TARGET_MIGRATION=0027_governed_skill_library
PUBLIC_HOST=tanaghom.38-247-187-232.sslip.io
PROTECTED_UNITS='smartlabs-api.service convai-ws.service convai-stt-api.service omnivoice-tts.service gemma4-26b-a4b-vllm-canary.service smartcc-api.service smartcc-smartlabs-bridge.service smartcc-web.service nginx.service'
PROTECTED_N8N_CONTAINERS='smartlabs-n8n-postgres-1 smartlabs-n8n-redis-1 smartlabs-n8n-egress-proxy-1 smartlabs-n8n-n8n-1 smartlabs-n8n-n8n-worker-1'

die() { echo "ERROR: $*" >&2; exit 1; }
require_root() { test "$(id -u)" -eq 0 || die 'run as root'; }

require_release_environment() {
  test "${TANAGHOM_RELEASE_AUTHORIZATION:-}" = 'YES-I-AM-THE-AUTHORIZED-OWNER' ||
    die 'explicit owner authorization is absent'
  echo "${TANAGHOM_TARGET_COMMIT:-}" | grep -Eq '^[0-9a-f]{40}$' ||
    die 'TANAGHOM_TARGET_COMMIT must be a full lowercase Git SHA'
  case "${TANAGHOM_RELEASE_ID:-}" in
    phase7b-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_RELEASE_ID must use phase7b-YYYYMMDDTHHMMSSZ' ;;
  esac
}

database_url() {
  test -s "$DATABASE_SECRET" || die 'Tanaghom database secret is missing'
  cat "$DATABASE_SECRET"
}

db_scalar() {
  url=$(database_url)
  PGAPPNAME=tanaghom-phase7b-skill-library psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"
  unset url
}

db_file() {
  url=$(database_url)
  status=0
  PGAPPNAME=tanaghom-phase7b-skill-library psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" || status=$?
  unset url
  return "$status"
}

compose() {
  docker compose -p "$PROJECT" -f "$BASE_COMPOSE" -f "$PUBLIC_COMPOSE" "$@"
}

container_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null
}

capture_n8n_ids() {
  destination=$1
  : > "$destination"
  chmod 0600 "$destination"
  for container in $PROTECTED_N8N_CONTAINERS; do
    docker inspect -f '{{.Name}}={{.Id}}' "$container" | sed 's#^/##' >> "$destination"
  done
}

assert_n8n_ids_unchanged() {
  expected=$1
  actual=$(mktemp)
  capture_n8n_ids "$actual"
  cmp -s "$expected" "$actual" || die 'a protected n8n container identity changed'
  rm -f "$actual"
}

assert_policy_locked() {
  test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 ||
    die 'a provider emergency stop is inactive'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_automation_policies WHERE postiz_draft_mode<>'manual';")" = 0 ||
    die 'Postiz organization policy is not manual'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_crm_policies WHERE contact_sync_mode<>'manual' OR conversation_processing_mode<>'paused' OR conversation_emergency_stop IS NOT TRUE;")" = 0 ||
    die 'CRM or conversation policy is not locked'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 ||
    die 'external provider operations exist'
}

assert_skill_library_target() {
  test "$(db_scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;")" = "$TARGET_MIGRATION" ||
    die 'target migration is not applied'
  for table in organization_skill_definitions organization_skill_versions organization_skill_references organization_skill_audit_events; do
    test "$(db_scalar "SELECT to_regclass('tanaghom.$table') IS NOT NULL;")" = t || die "missing $table"
  done
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_api','tanaghom.organization_skill_versions','SELECT');")" = t ||
    die 'dashboard API cannot read the Skill Library'
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_api','tanaghom.organization_skill_versions','INSERT,UPDATE,DELETE');")" = f ||
    die 'dashboard API received direct Skill Library DML'
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.organization_skill_versions','SELECT,INSERT,UPDATE,DELETE');")" = f ||
    die 'n8n received Skill Library table access'
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_conversation_worker','tanaghom.organization_skill_versions','SELECT,INSERT,UPDATE,DELETE');")" = f ||
    die 'conversation worker received Skill Library table access'
}
