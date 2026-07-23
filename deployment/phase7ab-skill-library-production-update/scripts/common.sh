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
EXPECTED_START_MIGRATION=0025_runtime_agent_reconciliation
TARGET_MIGRATION=0027_governed_skill_library
PENDING_MIGRATIONS='0026_skill_registry 0027_governed_skill_library'
ALLOWED_PRODUCTION_CHANGE=' M deployment/phase4-postiz-activation/egress/squid.conf'
ALLOWED_PRODUCTION_FILE="$PRODUCTION_ROOT/deployment/phase4-postiz-activation/egress/squid.conf"
PROTECTED_UNITS='smartlabs-api.service convai-ws.service convai-stt-api.service omnivoice-tts.service gemma4-26b-a4b-vllm-canary.service smartcc-api.service smartcc-smartlabs-bridge.service smartcc-web.service nginx.service'
PROTECTED_N8N_CONTAINERS='smartlabs-n8n-postgres-1 smartlabs-n8n-redis-1 smartlabs-n8n-egress-proxy-1 smartlabs-n8n-n8n-1 smartlabs-n8n-n8n-worker-1'

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_root() {
  test "$(id -u)" -eq 0 || die 'run with sudo; privileged release checks are required'
}

require_release_environment() {
  test "${TANAGHOM_RELEASE_AUTHORIZATION:-}" = 'YES-I-AM-THE-AUTHORIZED-OWNER' ||
    die 'explicit owner authorization is absent'
  case "${TANAGHOM_RELEASE_ID:-}" in
    phase7ab-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_RELEASE_ID must use phase7ab-YYYYMMDDTHHMMSSZ' ;;
  esac
  for value in "${TANAGHOM_EXPECTED_CURRENT_COMMIT:-}" "${TANAGHOM_TARGET_COMMIT:-}"; do
    echo "$value" | grep -Eq '^[0-9a-f]{40}$' ||
      die 'expected and target commits must be full lowercase Git SHAs'
  done
  test "$TANAGHOM_EXPECTED_CURRENT_COMMIT" != "$TANAGHOM_TARGET_COMMIT" ||
    die 'current and target commits must differ'
}

database_url() {
  test -s "$DATABASE_SECRET" || die 'Tanaghom database secret is missing'
  cat "$DATABASE_SECRET"
}

db_scalar() {
  url=$(database_url)
  PGAPPNAME=tanaghom-phase7ab-release psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"
  unset url
}

db_file() {
  url=$(database_url)
  status=0
  PGAPPNAME=tanaghom-phase7ab-release psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" || status=$?
  unset url
  return "$status"
}

latest_migration() {
  db_scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;'
}

compose() {
  docker compose -p "$PROJECT" -f "$BASE_COMPOSE" -f "$PUBLIC_COMPOSE" "$@"
}

container_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null
}

evidence_value() {
  file=$1
  key=$2
  awk -F= -v wanted="$key" '
    $1 == wanted {
      value=substr($0,index($0,"=")+1)
      sub(/\r$/, "", value)
      print value
      found=1
    }
    END { if (!found) exit 1 }
  ' "$file"
}

production_unexpected_changes() {
  git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" status --porcelain |
    grep -Fvx "$ALLOWED_PRODUCTION_CHANGE" || true
}

assert_protected_units_active() {
  for unit in $PROTECTED_UNITS; do
    test "$(systemctl is-active "$unit")" = active ||
      die "protected unit is not active: $unit"
  done
}

assert_protected_containers_healthy() {
  for container in $PROTECTED_N8N_CONTAINERS; do
    test "$(container_health "$container")" = healthy ||
      die "protected n8n container is not healthy: $container"
  done
}

capture_protected_container_ids() {
  destination=$1
  : > "$destination"
  chmod 0600 "$destination"
  for container in $PROTECTED_N8N_CONTAINERS; do
    docker inspect -f '{{.Name}}={{.Id}}' "$container" |
      sed 's#^/##' >> "$destination"
  done
}

assert_protected_container_ids_unchanged() {
  expected=$1
  actual=$(mktemp)
  capture_protected_container_ids "$actual"
  cmp -s "$expected" "$actual" ||
    die 'a protected n8n container identity changed'
  rm -f "$actual"
}

assert_policy_locked() {
  test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 ||
    die 'a provider emergency stop is inactive'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_automation_policies WHERE postiz_draft_mode<>'manual';")" = 0 ||
    die 'Postiz organization policy is not manual'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_crm_policies WHERE contact_sync_mode<>'manual' OR conversation_processing_mode<>'paused' OR conversation_emergency_stop IS NOT TRUE OR action_mode<>'manual' OR proactive_message_mode<>'disabled' OR action_emergency_stop IS NOT TRUE;")" = 0 ||
    die 'CRM, conversation, or GHL action policy is not locked'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.notification_delivery_controls WHERE runtime_ready IS NOT FALSE OR emergency_stop IS NOT TRUE;")" = 0 ||
    die 'notification delivery policy is not locked'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 ||
    die 'external provider operations exist'
}

assert_database_at_start() {
  test "$(latest_migration)" = "$EXPECTED_START_MIGRATION" ||
    die "unexpected migration ledger; expected $EXPECTED_START_MIGRATION"
  for table in \
    skill_definitions skill_versions agent_skill_bindings skill_references skill_audit_events \
    organization_skill_definitions organization_skill_versions organization_skill_references organization_skill_audit_events
  do
    test "$(db_scalar "SELECT to_regclass('tanaghom.$table') IS NULL;")" = t ||
      die "unexpected pre-existing table: tanaghom.$table"
  done
  assert_policy_locked
}

assert_platform_skill_registry_exact() {
  test "$(db_scalar "SELECT count(*) FROM tanaghom.skill_definitions WHERE owner_scope='platform' AND organization_id IS NULL;")" = 8 ||
    die 'platform Skill definition count differs from the reviewed registry'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.skill_definitions WHERE organization_id IS NOT NULL OR owner_scope<>'platform';")" = 0 ||
    die 'organization-owned or non-platform Skill definitions exist'
  test "$(db_scalar "SELECT string_agg(code,',' ORDER BY code) FROM tanaghom.skill_definitions;")" = 'create_campaign_strategy,create_postiz_draft,evaluate_reply_quality,execute_governed_ghl_action,generate_content_drafts,propose_conversation_reply,read_postiz_performance,upsert_ghl_contact' ||
    die 'platform Skill codes differ from the reviewed registry'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.skill_versions WHERE lifecycle_state='published' AND published_at IS NOT NULL;")" = 8 ||
    die 'platform Skill version lifecycle differs from the reviewed registry'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.skill_versions;")" = 8 ||
    die 'platform Skill version count differs from the reviewed registry'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_skill_bindings WHERE organization_id IS NULL AND binding_state='active';")" = 8 ||
    die 'platform agent Skill binding count differs from the reviewed registry'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_skill_bindings WHERE organization_id IS NOT NULL;")" = 0 ||
    die 'organization agent Skill bindings exist'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.skill_references WHERE organization_id IS NULL;")" = 24 ||
    die 'platform Skill reference count differs from the reviewed registry'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.skill_references WHERE organization_id IS NOT NULL;")" = 0 ||
    die 'organization Skill references exist in the platform registry'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.skill_audit_events WHERE organization_id IS NULL AND event_type='published' AND actor_kind='migration';")" = 8 ||
    die 'platform Skill audit evidence differs from the reviewed registry'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.skill_audit_events WHERE organization_id IS NOT NULL;")" = 0 ||
    die 'organization Skill audits exist in the platform registry'
}

assert_skill_library_target() {
  test "$(latest_migration)" = "$TARGET_MIGRATION" ||
    die 'target migration is not applied'
  assert_platform_skill_registry_exact
  for table in organization_skill_definitions organization_skill_versions organization_skill_references organization_skill_audit_events; do
    test "$(db_scalar "SELECT to_regclass('tanaghom.$table') IS NOT NULL;")" = t ||
      die "missing $table"
    test "$(db_scalar "SELECT count(*) FROM tanaghom.$table;")" = 0 ||
      die "unexpected organization Skill Library data in $table"
  done
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_api','tanaghom.skill_versions','SELECT');")" = t ||
    die 'dashboard API cannot read the platform Skill Registry'
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_api','tanaghom.skill_versions','INSERT,UPDATE,DELETE');")" = f ||
    die 'dashboard API received direct platform Skill Registry DML'
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_api','tanaghom.organization_skill_versions','SELECT');")" = t ||
    die 'dashboard API cannot read the organization Skill Library'
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_api','tanaghom.organization_skill_versions','INSERT,UPDATE,DELETE');")" = f ||
    die 'dashboard API received direct organization Skill Library DML'
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.skill_versions','SELECT,INSERT,UPDATE,DELETE');")" = f ||
    die 'n8n received platform Skill Registry table access'
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.organization_skill_versions','SELECT,INSERT,UPDATE,DELETE');")" = f ||
    die 'n8n received organization Skill Library table access'
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_conversation_worker','tanaghom.skill_versions','SELECT,INSERT,UPDATE,DELETE');")" = f ||
    die 'conversation worker received platform Skill Registry table access'
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_conversation_worker','tanaghom.organization_skill_versions','SELECT,INSERT,UPDATE,DELETE');")" = f ||
    die 'conversation worker received organization Skill Library table access'
}

assert_skill_registry_safe_to_drop() {
  assert_platform_skill_registry_exact
  for table in organization_skill_definitions organization_skill_versions organization_skill_references organization_skill_audit_events; do
    if test "$(db_scalar "SELECT to_regclass('tanaghom.$table') IS NOT NULL;")" = t; then
      test "$(db_scalar "SELECT count(*) FROM tanaghom.$table;")" = 0 ||
        die "rollback refused because customer Skill Library data exists in $table"
    fi
  done
}

assert_secret_metadata() {
  secret_dir="$PRODUCTION_ROOT/deployment/dashboard-canary/secrets"
  test "$(stat -c '%a' "$secret_dir")" = 710 ||
    die 'secret directory mode must be 0710'
  for name in database_url supabase_url supabase_publishable_key supabase_jwks_url supabase_secret_key integration_credential_key integration_worker_token; do
    file="$secret_dir/$name"
    test -s "$file" || die "required secret file is missing: $name"
    mode=$(stat -c '%a' "$file")
    case "$mode" in
      400|440|600|640) ;;
      *) die "unsafe secret mode for $name: $mode" ;;
    esac
  done
}

assert_firewall_boundary() {
  iptables -C DOCKER-USER -j TANAGHOM_N8N_DB_EGRESS >/dev/null 2>&1 ||
    die 'approved Tanaghom n8n database firewall hook is absent'
  ! iptables -S DOCKER-USER | grep -q TANAGHOM_N8N_GATEWAY_EGRESS ||
    die 'rolled-back Phase 4F gateway firewall hook is unexpectedly present'
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

assert_public_common_boundary() {
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/login")" = 200 ||
    die 'public login is unhealthy'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/")" = 307 ||
    die 'unauthenticated root boundary changed'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/operations")" = 401 ||
    die 'protected operations API boundary changed'
  if timeout 4 bash -c "</dev/tcp/38.247.187.232/5678" 2>/dev/null; then
    die 'public TCP 5678 is reachable'
  fi
}

assert_public_preupdate_boundary() {
  assert_public_common_boundary
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/admin/skills")" = 404 ||
    die 'pre-update Skill Library API boundary is not the expected 404'
}

assert_public_target_boundary() {
  assert_public_common_boundary
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/settings/skills")" = 307 ||
    die 'Skill Library page authentication boundary changed'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/admin/skills")" = 401 ||
    die 'Skill Library API authentication boundary changed'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/agents")" = 307 ||
    die 'Agents page authentication boundary changed'
}
