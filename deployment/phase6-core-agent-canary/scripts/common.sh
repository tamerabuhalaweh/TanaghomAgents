#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_SOURCE_ROOT=${TANAGHOM_RELEASE_SOURCE_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)}
PRODUCTION_ROOT=${TANAGHOM_PRODUCTION_ROOT:-/opt/tanaghom-dashboard}
DATABASE_SECRET="$PRODUCTION_ROOT/deployment/dashboard-canary/secrets/database_url"
PUBLIC_HOST=tanaghom.38-247-187-232.sslip.io
N8N_MAIN_CONTAINER=smartlabs-n8n-n8n-1
N8N_DATABASE_CONTAINER=smartlabs-n8n-postgres-1
N8N_EXPECTED_VERSION=2.26.8
STRATEGIST_ID=phase3StrategistV1
PRODUCER_ID=phase3ContentProducerV1
STRATEGIST_REGISTRY=campaign_strategy_generator
PRODUCER_REGISTRY=campaign_content_generator
EXPECTED_MIGRATION=0022_agent_registry
PROTECTED_N8N_CONTAINERS='smartlabs-n8n-postgres-1 smartlabs-n8n-redis-1 smartlabs-n8n-egress-proxy-1 smartlabs-n8n-n8n-1 smartlabs-n8n-n8n-worker-1'
PROTECTED_UNITS='smartlabs-api.service convai-ws.service convai-stt-api.service omnivoice-tts.service gemma4-26b-a4b-vllm-canary.service smartcc-api.service smartcc-smartlabs-bridge.service smartcc-web.service nginx.service'

die() { echo "ERROR: $*" >&2; exit 1; }
require_root() { test "$(id -u)" -eq 0 || die 'privileged canary operator access is required'; }

require_environment() {
  test "${TANAGHOM_CANARY_AUTHORIZATION:-}" = 'YES-I-AM-THE-AUTHORIZED-OWNER' || die 'explicit owner canary authorization is absent'
  case "${TANAGHOM_CANARY_ID:-}" in
    corecanary-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_CANARY_ID must use corecanary-YYYYMMDDTHHMMSSZ' ;;
  esac
  case "${TANAGHOM_CANARY_CAMPAIGN:-}" in *.test) ;; *) die 'TANAGHOM_CANARY_CAMPAIGN must end in .test' ;; esac
  echo "${TANAGHOM_EXPECTED_PRODUCTION_COMMIT:-}" | grep -Eq '^[0-9a-f]{40}$' || die 'expected production commit must be a full lowercase Git SHA'
  echo "${TANAGHOM_CANARY_SOURCE_COMMIT:-}" | grep -Eq '^[0-9a-f]{40}$' || die 'canary source commit must be a full lowercase Git SHA'
}

database_url() { test -s "$DATABASE_SECRET" || die 'dashboard database secret is missing'; cat "$DATABASE_SECRET"; }
db_scalar() { url=$(database_url); PGAPPNAME=tanaghom-core-canary psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"; unset url; }
db_exec() { url=$(database_url); PGAPPNAME=tanaghom-core-canary psql "$url" -X -v ON_ERROR_STOP=1 -c "$1" >/dev/null; unset url; }
latest_migration() { db_scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;"; }
n8n_db_scalar() { docker exec "$N8N_DATABASE_CONTAINER" sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1"' sh "$1"; }

container_health() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null; }
assert_protected_health() {
  for unit in $PROTECTED_UNITS; do test "$(systemctl is-active "$unit")" = active || die "protected unit is not active: $unit"; done
  for container in $PROTECTED_N8N_CONTAINERS; do test "$(container_health "$container")" = healthy || die "protected container is not healthy: $container"; done
}
capture_container_ids() {
  destination=$1; : >"$destination"; chmod 0600 "$destination"
  for container in $PROTECTED_N8N_CONTAINERS; do docker inspect -f '{{.Name}}={{.Id}}' "$container" | sed 's#^/##' >>"$destination"; done
}
assert_container_ids_unchanged() { actual=$(mktemp); capture_container_ids "$actual"; cmp -s "$1" "$actual" || die 'a protected n8n container was recreated'; rm -f "$actual"; }

assert_public_boundary() {
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/login")" = 200 || die 'public login is unhealthy'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/operations")" = 401 || die 'protected API boundary changed'
}
assert_firewall_boundary() { iptables -C DOCKER-USER -j TANAGHOM_N8N_DB_EGRESS >/dev/null 2>&1 || die 'approved n8n database firewall hook is absent'; }

workflow_count() { n8n_db_scalar "SELECT count(*) FROM workflow_entity WHERE id='$1';"; }
workflow_active() { n8n_db_scalar "SELECT count(*) FROM workflow_entity WHERE id='$1' AND active IS TRUE AND \"isArchived\" IS FALSE;"; }
workflow_execution_count() { n8n_db_scalar "SELECT count(*) FROM execution_entity WHERE \"workflowId\"='$1';"; }
assert_workflow_inactive() { test "$(workflow_count "$1")" = 1 || die "workflow missing or duplicated: $1"; test "$(workflow_active "$1")" = 0 || die "workflow is active: $1"; }

export_all_workflows() {
  destination=$1; remote="/home/node/tanaghom-core-canary-export-$$.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -u node "$N8N_MAIN_CONTAINER" n8n export:workflow --all --pretty --output="$remote" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" test -s "$remote"
  docker cp "$N8N_MAIN_CONTAINER:$remote" "$destination" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
  chmod 0600 "$destination"
}

import_workflow_inactive() {
  source=$1; label=$2; remote="/home/node/tanaghom-$TANAGHOM_CANARY_ID-$label-$$.json"
  docker cp "$source" "$N8N_MAIN_CONTAINER:$remote" >/dev/null
  docker exec -u root "$N8N_MAIN_CONTAINER" chmod 0444 "$remote"
  status=0
  docker exec -u node "$N8N_MAIN_CONTAINER" n8n import:workflow --input="$remote" --activeState=false >/dev/null || status=$?
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  return "$status"
}

publish_workflow() { docker exec -u node "$N8N_MAIN_CONTAINER" n8n publish:workflow --id="$1" >/dev/null; }
unpublish_workflow() { docker exec -u node "$N8N_MAIN_CONTAINER" n8n unpublish:workflow --id="$1" >/dev/null 2>&1 || true; }
execute_workflow_once() { docker exec -u node "$N8N_MAIN_CONTAINER" n8n execute --id="$1" --rawOutput; }

registry_state() { db_scalar "SELECT runtime_state||'|'||trigger_state||'|'||runtime_evidence FROM tanaghom.agent_workflow_registry WHERE code='$1';"; }
set_registry_active_disabled() {
  db_exec "UPDATE tanaghom.agent_workflow_registry SET runtime_state='active',trigger_state='disabled',runtime_verified_at=now(),runtime_evidence='$TANAGHOM_CANARY_ID-running' WHERE code='$1' AND runtime_state='imported_inactive';"
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code='$1' AND runtime_state='active' AND trigger_state='disabled' AND runtime_evidence='$TANAGHOM_CANARY_ID-running';")" = 1 || die "registry did not enter active/disabled state: $1"
}
set_registry_inactive() {
  db_exec "UPDATE tanaghom.agent_workflow_registry SET runtime_state='imported_inactive',trigger_state='workflow_inactive_only',runtime_verified_at=now(),runtime_evidence='$TANAGHOM_CANARY_ID-restored' WHERE code='$1';"
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code='$1' AND runtime_state='imported_inactive' AND trigger_state='workflow_inactive_only';")" = 1 || die "registry did not return inactive: $1"
}

assert_no_claimable_core_backlog() {
  count=$(db_scalar "SELECT count(*) FROM tanaghom.agent_jobs WHERE job_type IN ('campaign.strategy.generate','campaign.content.generate') AND status='queued' AND available_at<=now() AND attempt<max_attempts;")
  test "$count" = 0 || die "claimable core-agent backlog exists: $count"
}
assert_business_locks() {
  test "$(latest_migration)" = "$EXPECTED_MIGRATION" || die "database is not at $EXPECTED_MIGRATION"
  test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 || die 'provider emergency stop is not active'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_automation_policies WHERE postiz_draft_mode<>'manual';")" = 0 || die 'Postiz is not manual'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_crm_policies WHERE contact_sync_mode<>'manual' OR conversation_processing_mode<>'paused' OR conversation_emergency_stop IS NOT TRUE OR action_mode<>'manual' OR proactive_message_mode<>'disabled' OR action_emergency_stop IS NOT TRUE;")" = 0 || die 'CRM safety policy is not locked'
}

operator() { DATABASE_URL=$(database_url) node "$SCRIPT_DIR/canary-operator.mjs" "$@"; }
