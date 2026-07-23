#!/bin/sh
set -eu

PRODUCTION_ROOT=${TANAGHOM_PRODUCTION_ROOT:-/opt/tanaghom-dashboard}
SCRIPT_DIR_COMMON=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_SOURCE_ROOT=${TANAGHOM_RELEASE_SOURCE_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR_COMMON/../../.." && pwd)}
PROJECT=tanaghom-dashboard-canary
BASE_COMPOSE="$PRODUCTION_ROOT/deployment/dashboard-canary/docker-compose.yml"
PUBLIC_COMPOSE="$PRODUCTION_ROOT/deployment/dashboard-public/docker-compose.yml"
DATABASE_SECRET="$PRODUCTION_ROOT/deployment/dashboard-canary/secrets/database_url"
WORKER_TOKEN_SECRET="$PRODUCTION_ROOT/deployment/dashboard-canary/secrets/integration_worker_token"
GATEWAY_VALIDATOR="$RELEASE_SOURCE_ROOT/deployment/phase6-provider-runtime-readiness/scripts/validate-gateway-boundary.sh"
PUBLIC_HOST=tanaghom.38-247-187-232.sslip.io
GATEWAY_URL="https://$PUBLIC_HOST"
EXPECTED_MIGRATION=0028_strategy_cadence_integrity
DASHBOARD_CONTAINER=tanaghom-dashboard-canary-dashboard-1
N8N_DB_CONTAINER=smartlabs-n8n-postgres-1
PROTECTED_N8N_CONTAINERS='smartlabs-n8n-postgres-1 smartlabs-n8n-redis-1 smartlabs-n8n-egress-proxy-1 smartlabs-n8n-n8n-1 smartlabs-n8n-n8n-worker-1'
ALLOWED_PRODUCTION_CHANGE=' M deployment/phase4-postiz-activation/egress/squid.conf'
ALLOWED_PRODUCTION_FILE="$PRODUCTION_ROOT/deployment/phase4-postiz-activation/egress/squid.conf"

die() { echo "ERROR: $*" >&2; exit 1; }
require_root() { test "$(id -u)" -eq 0 || die 'run with sudo'; }

require_release_environment() {
  test "${TANAGHOM_PROVIDER_RUNTIME_AUTHORIZATION:-}" = 'GO-ENABLE-PROVEN-PROVIDER-RUNTIME-BOUNDARY' ||
    die 'explicit provider-runtime authorization is absent'
  case "${TANAGHOM_PROVIDER_RUNTIME_ID:-}" in
    providerruntime-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_PROVIDER_RUNTIME_ID must use providerruntime-YYYYMMDDTHHMMSSZ' ;;
  esac
  for value in "${TANAGHOM_EXPECTED_CURRENT_COMMIT:-}" "${TANAGHOM_TARGET_COMMIT:-}"; do
    echo "$value" | grep -Eq '^[0-9a-f]{40}$' || die 'commit IDs must be full lowercase Git SHAs'
  done
  test "$TANAGHOM_EXPECTED_CURRENT_COMMIT" != "$TANAGHOM_TARGET_COMMIT" ||
    die 'current and target commits must differ'
}

database_url() {
  test -s "$DATABASE_SECRET" || die 'database secret is missing'
  cat "$DATABASE_SECRET"
}

db_scalar() {
  url=$(database_url)
  PGAPPNAME=tanaghom-provider-runtime psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"
  unset url
}

compose() {
  docker compose -p "$PROJECT" -f "$BASE_COMPOSE" -f "$PUBLIC_COMPOSE" "$@"
}

source_compose() {
  docker compose -p "$PROJECT" \
    -f "$RELEASE_SOURCE_ROOT/deployment/dashboard-canary/docker-compose.yml" \
    -f "$RELEASE_SOURCE_ROOT/deployment/dashboard-public/docker-compose.yml" "$@"
}

container_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null
}

container_env() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$DASHBOARD_CONTAINER"
}

production_unexpected_changes() {
  git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" status --porcelain |
    grep -Fvx "$ALLOWED_PRODUCTION_CHANGE" || true
}

assert_secret_metadata() {
  secret_dir="$PRODUCTION_ROOT/deployment/dashboard-canary/secrets"
  test "$(stat -c '%a' "$secret_dir")" = 710 || die 'secret directory mode must be 0710'
  for name in integration_credential_key integration_worker_token; do
    file="$secret_dir/$name"
    test -s "$file" || die "required secret is missing: $name"
    case "$(stat -c '%a' "$file")" in 400|440|600|640) ;; *) die "unsafe secret mode: $name" ;; esac
  done
}

assert_gateway_credential_metadata() {
  shape=$(printf '%s\n' \
    "SELECT name||'|'||type FROM credentials_entity WHERE id='62000000-0000-4000-8000-000000000004';" |
    docker exec -i "$N8N_DB_CONTAINER" sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -At')
  test "$shape" = 'Tanaghom Integration Gateway|httpHeaderAuth' ||
    die 'fixed encrypted n8n gateway credential is absent or incompatible'
}

assert_safety_locks() {
  test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 ||
    die 'a provider platform stop is open'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_automation_policies WHERE postiz_draft_mode<>'manual';")" = 0 ||
    die 'Postiz policy is not manual'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_crm_policies WHERE contact_sync_mode<>'manual' OR conversation_processing_mode<>'paused' OR conversation_emergency_stop IS NOT TRUE OR action_mode<>'manual' OR proactive_message_mode<>'disabled' OR action_emergency_stop IS NOT TRUE;")" = 0 ||
    die 'CRM or GHL policy is not fail-closed'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.publishing_channels WHERE is_active;")" = 0 ||
    die 'an active publishing channel exists'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.integration_connections WHERE provider='ghl' AND status='connected';")" = 0 ||
    die 'a connected GHL integration exists'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 ||
    die 'external provider operations exist'
}

assert_no_reconciliation_blocker() {
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_jobs job WHERE job.job_type='campaign.content.generate' AND job.status='waiting_approval' AND NOT EXISTS (SELECT 1 FROM tanaghom.content_items content WHERE content.campaign_id=job.campaign_id AND content.status='pending_approval');")" = 0 ||
    die 'a content approval job still requires reconciliation'
}

assert_protected_n8n_healthy() {
  for container in $PROTECTED_N8N_CONTAINERS; do
    test "$(container_health "$container")" = healthy || die "protected n8n container is unhealthy: $container"
  done
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

capture_firewall() {
  destination=$1
  {
    iptables -S TANAGHOM_N8N_DB_EGRESS
    iptables -S TANAGHOM_N8N_DB_INPUT
    iptables -S DOCKER-USER | grep TANAGHOM_N8N_DB_EGRESS
    iptables -S INPUT | grep TANAGHOM_N8N_DB_INPUT
  } > "$destination"
  chmod 0600 "$destination"
}

assert_dashboard_network_boundary() {
  networks=$(docker inspect -f '{{range $name,$value := .NetworkSettings.Networks}}{{$name}} {{end}}' "$DASHBOARD_CONTAINER")
  test "$networks" = 'tanaghom-dashboard-outbound ' || die 'dashboard network membership changed'
  binding=$(docker inspect -f '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostIp}}:{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' "$DASHBOARD_CONTAINER")
  test "$binding" = '127.0.0.1:3200' || die 'dashboard loopback binding changed'
}

assert_public_boundary() {
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$GATEWAY_URL/login")" = 200 ||
    die 'public login is unhealthy'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$GATEWAY_URL/api/operations")" = 401 ||
    die 'operations API authentication boundary changed'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$GATEWAY_URL/agents")" = 307 ||
    die 'Agents page authentication boundary changed'
}

assert_source_target_contract() {
  config=$(source_compose config)
  echo "$config" | grep -q 'POSTIZ_AUTOMATION_RUNTIME_READY: "true"' ||
    die 'target Postiz runtime flag is not true'
  echo "$config" | grep -q 'GHL_ACTION_RUNTIME_READY: "true"' ||
    die 'target GHL runtime flag is not true'
  echo "$config" | grep -q 'GHL_ACTION_RUNTIME_ENABLED: "false"' ||
    die 'target GHL action dispatch is not false'
  echo "$config" | grep -q 'GHL_CONTACT_SYNC_ENABLED: "false"' ||
    die 'target GHL contact sync is not false'
  echo "$config" | grep -q 'GHL_WEBHOOK_INGRESS_ENABLED: "false"' ||
    die 'target GHL webhook ingress is not false'
  echo "$config" | grep -q "TANAGHOM_INTEGRATION_GATEWAY_URL: $GATEWAY_URL" ||
    die 'target gateway URL is not exact'
}

assert_current_runtime_locked() {
  env=$(container_env)
  echo "$env" | grep -qx 'POSTIZ_AUTOMATION_RUNTIME_READY=false' || die 'current Postiz runtime is not false'
  echo "$env" | grep -qx 'GHL_ACTION_RUNTIME_READY=false' || die 'current GHL runtime is not false'
  echo "$env" | grep -qx 'GHL_ACTION_RUNTIME_ENABLED=false' || die 'current GHL action dispatch is not false'
  echo "$env" | grep -qx 'GHL_WEBHOOK_INGRESS_ENABLED=false' || die 'current webhook ingress is not false'
  echo "$env" | grep -qx 'TANAGHOM_INTEGRATION_GATEWAY_URL=' || die 'current dashboard gateway URL is not empty'
}

assert_target_runtime_ready() {
  env=$(container_env)
  echo "$env" | grep -qx 'POSTIZ_AUTOMATION_RUNTIME_READY=true' || die 'Postiz runtime flag is not true'
  echo "$env" | grep -qx 'GHL_ACTION_RUNTIME_READY=true' || die 'GHL runtime flag is not true'
  echo "$env" | grep -qx 'GHL_ACTION_RUNTIME_ENABLED=false' || die 'GHL action dispatch changed'
  echo "$env" | grep -qx 'GHL_CONTACT_SYNC_ENABLED=false' || die 'GHL contact sync changed'
  echo "$env" | grep -qx 'GHL_WEBHOOK_INGRESS_ENABLED=false' || die 'GHL webhook ingress changed'
  echo "$env" | grep -qx "TANAGHOM_INTEGRATION_GATEWAY_URL=$GATEWAY_URL" || die 'gateway URL is not exact'
}

validate_gateway_boundary() {
  test -x "$GATEWAY_VALIDATOR" || die 'gateway validator is missing'
  cat "$WORKER_TOKEN_SECRET" | "$GATEWAY_VALIDATOR"
}
