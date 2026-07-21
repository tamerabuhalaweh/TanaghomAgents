#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_SOURCE_ROOT=${TANAGHOM_RELEASE_SOURCE_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)}
PRODUCTION_ROOT=${TANAGHOM_PRODUCTION_ROOT:-/opt/tanaghom-dashboard}
DATABASE_SECRET="$PRODUCTION_ROOT/deployment/dashboard-canary/secrets/database_url"
DATABASE_CA_CERT=${TANAGHOM_DATABASE_CA_CERT:-$RELEASE_SOURCE_ROOT/deployment/phase3-shadow-canary/certificates/supabase-root-2021-ca.pem}
CORE_CANARY_PACKAGE="$RELEASE_SOURCE_ROOT/deployment/phase6-core-agent-canary"
CANARY_EVIDENCE=${TANAGHOM_CANARY_EVIDENCE_DIR:-/var/backups/tanaghom-${TANAGHOM_CANARY_ID:-unset}}
PUBLIC_HOST=tanaghom.38-247-187-232.sslip.io
N8N_MAIN_CONTAINER=smartlabs-n8n-n8n-1
N8N_DATABASE_CONTAINER=smartlabs-n8n-postgres-1
N8N_EXPECTED_VERSION=2.26.8
STRATEGIST_ID=phase3StrategistV1
PRODUCER_ID=phase3ContentProducerV1
EXPECTED_MIGRATION=0023_campaign_lifecycle
PROTECTED_N8N_CONTAINERS='smartlabs-n8n-postgres-1 smartlabs-n8n-redis-1 smartlabs-n8n-egress-proxy-1 smartlabs-n8n-n8n-1 smartlabs-n8n-n8n-worker-1'
PROTECTED_UNITS='smartlabs-api.service convai-ws.service convai-stt-api.service omnivoice-tts.service gemma4-26b-a4b-vllm-canary.service smartcc-api.service smartcc-smartlabs-bridge.service smartcc-web.service nginx.service'

die() { echo "ERROR: $*" >&2; exit 1; }
require_root() { test "$(id -u)" -eq 0 || die 'privileged reconciliation operator access is required'; }

require_environment() {
  test "${TANAGHOM_JOB_RECONCILIATION_AUTHORIZATION:-}" = 'YES-I-AM-THE-AUTHORIZED-OWNER' || die 'explicit owner reconciliation authorization is absent'
  case "${TANAGHOM_JOB_RECONCILIATION_ID:-}" in
    jobreconcile-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_JOB_RECONCILIATION_ID must use jobreconcile-YYYYMMDDTHHMMSSZ' ;;
  esac
  case "${TANAGHOM_CANARY_ID:-}" in corecanary-*) ;; *) die 'a core canary ID is required' ;; esac
  case "${TANAGHOM_CANARY_CAMPAIGN:-}" in *.test) ;; *) die 'canary campaign must end in .test' ;; esac
  echo "${TANAGHOM_CONTENT_JOB_ID:-}" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' || die 'content job ID must be a lowercase UUID'
  for value in "${TANAGHOM_EXPECTED_PRODUCTION_COMMIT:-}" "${TANAGHOM_RECONCILIATION_SOURCE_COMMIT:-}" "${TANAGHOM_CANARY_SOURCE_COMMIT:-}"; do
    echo "$value" | grep -Eq '^[0-9a-f]{40}$' || die 'all expected commits must be full lowercase Git SHAs'
  done
}

database_url() { test -s "$DATABASE_SECRET" || die 'dashboard database secret is missing'; cat "$DATABASE_SECRET"; }
db_scalar() { url=$(database_url); PGAPPNAME=tanaghom-content-job-reconciliation psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"; unset url; }
latest_migration() { db_scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;'; }
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
normalize_firewall_snapshot() {
  source_snapshot=$1; destination_snapshot=$2
  test -s "$source_snapshot" || die "firewall snapshot is missing or empty: $source_snapshot"
  sed -E '/^#/d; s/\[[0-9]+:[0-9]+\]/[COUNTERS]/g' "$source_snapshot" >"$destination_snapshot"
  test -s "$destination_snapshot" || die "normalized firewall snapshot is empty: $destination_snapshot"
  chmod 0600 "$destination_snapshot"
}

workflow_count() { n8n_db_scalar "SELECT count(*) FROM workflow_entity WHERE id='$1';"; }
workflow_active() { n8n_db_scalar "SELECT count(*) FROM workflow_entity WHERE id='$1' AND active IS TRUE AND \"isArchived\" IS FALSE;"; }
workflow_execution_count() { n8n_db_scalar "SELECT count(*) FROM execution_entity WHERE \"workflowId\"='$1';"; }
assert_workflow_inactive() { test "$(workflow_count "$1")" = 1 || die "workflow missing or duplicated: $1"; test "$(workflow_active "$1")" = 0 || die "workflow is active: $1"; }
export_all_workflows() {
  destination=$1; remote="/home/node/tanaghom-job-reconciliation-export-$$.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -u node "$N8N_MAIN_CONTAINER" n8n export:workflow --all --pretty --output="$remote" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" test -s "$remote"
  docker cp "$N8N_MAIN_CONTAINER:$remote" "$destination" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
  chmod 0600 "$destination"
}

assert_business_locks() {
  test "$(latest_migration)" = "$EXPECTED_MIGRATION" || die "database is not at $EXPECTED_MIGRATION"
  test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 || die 'provider emergency stop is not active'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_automation_policies WHERE postiz_draft_mode<>'manual';")" = 0 || die 'Postiz is not manual'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_crm_policies WHERE contact_sync_mode<>'manual' OR conversation_processing_mode<>'paused' OR conversation_emergency_stop IS NOT TRUE OR action_mode<>'manual' OR proactive_message_mode<>'disabled' OR action_emergency_stop IS NOT TRUE;")" = 0 || die 'CRM safety policy is not locked'
}

canary_evidence_value() { sed -n "s/^$1=//p" "$CANARY_EVIDENCE/canary.env"; }
assert_canary_evidence() {
  test -s "$CANARY_EVIDENCE/canary.env" || die 'canary environment evidence is missing'
  test -s "$CANARY_EVIDENCE/SHA256SUMS" || die 'canary evidence checksums are missing'
  test "$(canary_evidence_value CANARY_ID)" = "$TANAGHOM_CANARY_ID" || die 'canary ID evidence mismatch'
  test "$(canary_evidence_value CAMPAIGN)" = "$TANAGHOM_CANARY_CAMPAIGN" || die 'canary campaign evidence mismatch'
  test "$(canary_evidence_value PRODUCTION_COMMIT)" = "$TANAGHOM_EXPECTED_PRODUCTION_COMMIT" || die 'canary production commit evidence mismatch'
  test "$(canary_evidence_value SOURCE_COMMIT)" = "$TANAGHOM_CANARY_SOURCE_COMMIT" || die 'canary source commit evidence mismatch'
  test "$(grep -c '^HUMAN_APPROVAL_VERIFIED_AT=' "$CANARY_EVIDENCE/canary.env")" -eq 1 || die 'human approval verification evidence is absent or duplicated'
  (cd "$CANARY_EVIDENCE" && sha256sum --quiet -c SHA256SUMS) || die 'canary evidence checksum validation failed'
}

operator() {
  test -s "$DATABASE_CA_CERT" || die "reviewed database CA certificate is missing: $DATABASE_CA_CERT"
  DATABASE_URL=$(database_url) NODE_EXTRA_CA_CERTS="$DATABASE_CA_CERT" TANAGHOM_DATABASE_SSL_MODE=verify-full \
    node "$SCRIPT_DIR/reconcile-operator.mjs" "$1" "$TANAGHOM_CANARY_CAMPAIGN" "$TANAGHOM_CONTENT_JOB_ID"
}
