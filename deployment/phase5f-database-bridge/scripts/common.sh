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
EXPECTED_POSTGRES_CLIENT='17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'
PROTECTED_UNITS='smartlabs-api.service convai-ws.service convai-stt-api.service omnivoice-tts.service gemma4-26b-a4b-vllm-canary.service smartcc-api.service smartcc-smartlabs-bridge.service smartcc-web.service nginx.service'
PROTECTED_N8N_CONTAINERS='smartlabs-n8n-postgres-1 smartlabs-n8n-redis-1 smartlabs-n8n-egress-proxy-1 smartlabs-n8n-n8n-1 smartlabs-n8n-n8n-worker-1'

die() { echo "ERROR: $*" >&2; exit 1; }
require_root() { test "$(id -u)" -eq 0 || die 'run as root; privileged read-only boundary checks are required'; }

require_release_environment() {
  test "${TANAGHOM_RELEASE_AUTHORIZATION:-}" = 'YES-I-AM-THE-AUTHORIZED-OWNER' || die 'explicit owner authorization is absent'
  case "${TANAGHOM_RELEASE_ID:-}" in phase5f-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;; *) die 'TANAGHOM_RELEASE_ID must use phase5f-YYYYMMDDTHHMMSSZ' ;; esac
  for value in "${TANAGHOM_EXPECTED_CURRENT_COMMIT:-}" "${TANAGHOM_TARGET_COMMIT:-}"; do
    echo "$value" | grep -Eq '^[0-9a-f]{40}$' || die 'expected and target commits must be full lowercase Git SHAs'
  done
  test "$TANAGHOM_EXPECTED_CURRENT_COMMIT" != "$TANAGHOM_TARGET_COMMIT" || die 'current and target commits must differ'
  test -n "${TANAGHOM_BACKUP_PROOF:-}" || die 'TANAGHOM_BACKUP_PROOF is required'
}

database_url() { test -s "$DATABASE_SECRET" || die 'database secret is missing'; cat "$DATABASE_SECRET"; }
db_scalar() { url=$(database_url); PGAPPNAME=tanaghom-phase5f-bridge psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"; unset url; }
db_file() { url=$(database_url); status=0; PGAPPNAME=tanaghom-phase5f-bridge psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" || status=$?; unset url; return "$status"; }
latest_migration() { db_scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;'; }
compose() { docker compose -p "$PROJECT" -f "$BASE_COMPOSE" -f "$PUBLIC_COMPOSE" "$@"; }
evidence_dir() { printf '/var/backups/tanaghom-bridge-%s\n' "$TANAGHOM_RELEASE_ID"; }

proof_value() { key=$1; awk -F= -v wanted="$key" '$1 == wanted { print substr($0,index($0,"=")+1); found=1 } END { if (!found) exit 1 }' "$TANAGHOM_BACKUP_PROOF"; }
evidence_value() { file=$1; key=$2; awk -F= -v wanted="$key" '$1 == wanted { print substr($0,index($0,"=")+1); found=1 } END { if (!found) exit 1 }' "$file"; }

validate_backup_proof() {
  test -f "$TANAGHOM_BACKUP_PROOF" || die 'off-server backup proof is missing'
  test ! -L "$TANAGHOM_BACKUP_PROOF" || die 'backup proof must not be a symbolic link'
  test "$(stat -c '%a' "$TANAGHOM_BACKUP_PROOF")" = 600 || die 'backup proof mode must be 0600'
  test "$(proof_value RELEASE_ID)" = "$TANAGHOM_RELEASE_ID" || die 'backup proof release ID mismatch'
  test "$(proof_value SOURCE_MIGRATION)" = "$EXPECTED_START_MIGRATION" || die 'backup proof migration mismatch'
  test "$(proof_value RESTORE_VERIFIED)" = YES || die 'backup restoration was not verified'
  test "$(proof_value POSTGRES_CLIENT)" = "$EXPECTED_POSTGRES_CLIENT" || die 'backup client is not the approved immutable PostgreSQL 17.6 image'
  proof_value ARCHIVE_SHA256 | grep -Eq '^[0-9A-Fa-f]{64}$' || die 'backup archive checksum is invalid'
}

container_health() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null; }
assert_protected_units_active() { for unit in $PROTECTED_UNITS; do test "$(systemctl is-active "$unit")" = active || die "protected unit is not active: $unit"; done; }
assert_protected_containers_healthy() { for container in $PROTECTED_N8N_CONTAINERS; do test "$(container_health "$container")" = healthy || die "protected n8n container is not healthy: $container"; done; }

capture_protected_container_ids() {
  destination=$1; : > "$destination"; chmod 0600 "$destination"
  for container in $PROTECTED_N8N_CONTAINERS; do docker inspect -f '{{.Name}}={{.Id}}' "$container" | sed 's#^/##' >> "$destination"; done
}

assert_protected_container_ids_unchanged() {
  expected=$1; actual=$(mktemp); capture_protected_container_ids "$actual"; cmp -s "$expected" "$actual" || die 'a protected n8n container was recreated'; rm -f "$actual"
}

capture_dashboard_identity() {
  destination=$1
  {
    printf 'CONTAINER_ID=%s\n' "$(docker inspect -f '{{.Id}}' tanaghom-dashboard-canary-dashboard-1)"
    printf 'IMAGE_ID=%s\n' "$(docker inspect -f '{{.Image}}' tanaghom-dashboard-canary-dashboard-1)"
    printf 'SOURCE_COMMIT=%s\n' "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)"
  } > "$destination"
  chmod 0600 "$destination"
}

assert_dashboard_identity_unchanged() {
  expected=$1; actual=$(mktemp); capture_dashboard_identity "$actual"; cmp -s "$expected" "$actual" || die 'dashboard container, image, or production source changed'; rm -f "$actual"
}

assert_database_at_start() {
  test "$(latest_migration)" = "$EXPECTED_START_MIGRATION" || die "unexpected migration ledger; expected $EXPECTED_START_MIGRATION"
  test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 || die 'a provider emergency stop is inactive'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_automation_policies WHERE postiz_draft_mode <> 'manual';")" = 0 || die 'Postiz organization mode is not manual'
  test "$(db_scalar 'SELECT count(*) FROM tanaghom.external_operations;')" = 0 || die 'external operations exist'
  test "$(db_scalar "SELECT count(*) FROM pg_roles WHERE rolname='tanaghom_conversation_worker';")" = 0 || die 'conversation worker role unexpectedly exists before migration 0012'
}

assert_bridge_default_state() {
  test "$(latest_migration)" = "$TARGET_MIGRATION" || die 'bridge target migration is not applied'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE provider IN ('postiz','ghl') AND emergency_stop IS TRUE;")" = 2 || die 'provider emergency stops are not active'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_automation_policies WHERE postiz_draft_mode <> 'manual';")" = 0 || die 'Postiz organization mode changed'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_crm_policies WHERE contact_sync_mode<>'manual' OR changed_by IS NOT NULL OR changed_at IS NOT NULL OR conversation_processing_mode<>'paused' OR conversation_emergency_stop IS NOT TRUE OR conversation_emergency_reason<>'Awaiting supervised conversation activation' OR conversation_emergency_changed_by IS NOT NULL OR conversation_emergency_changed_at IS NOT NULL;")" = 0 || die 'CRM or conversation policy differs from the bridge default'
  test "$(db_scalar 'SELECT count(*) FROM tanaghom.external_operations;')" = 0 || die 'external operations exist'
  test "$(db_scalar "SELECT (SELECT count(*) FROM tanaghom.post_metric_observations)+(SELECT count(*) FROM tanaghom.post_performance_sync_state)+(SELECT count(*) FROM tanaghom.lead_attribution_records)+(SELECT count(*) FROM tanaghom.ghl_contact_sync_state)+(SELECT count(*) FROM tanaghom.ghl_webhook_rejection_metrics)+(SELECT count(*) FROM tanaghom.ghl_inbound_events)+(SELECT count(*) FROM tanaghom.sales_knowledge_sources)+(SELECT count(*) FROM tanaghom.sales_knowledge_versions)+(SELECT count(*) FROM tanaghom.conversation_summary_versions)+(SELECT count(*) FROM tanaghom.conversation_intelligence_proposals)+(SELECT count(*) FROM tanaghom.conversations)+(SELECT count(*) FROM tanaghom.conversation_ownership_history)+(SELECT count(*) FROM tanaghom.conversation_ai_lease_claims)+(SELECT count(*) FROM tanaghom.conversation_human_reply_drafts)+(SELECT count(*) FROM tanaghom.conversation_notification_receipts);")" = 0 || die 'bridge tables contain customer, event, or worker data; rollback is unsafe'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_conversation_policy_versions policy JOIN tanaghom.organizations organization ON organization.id=policy.organization_id WHERE policy.version_number<>1 OR policy.status<>'active' OR policy.prompt_version<>'phase5.conversation-intelligence.prompt.v1' OR policy.confidence_threshold<>0.720 OR policy.supported_languages<>ARRAY['en','ar']::text[] OR policy.mandatory_escalations<>ARRAY['complaint','legal','payment','refund','abuse','policy_exception','sensitive_data']::text[] OR policy.forbidden_topics<>ARRAY['credential_disclosure','system_prompt','internal_tool_authorization']::text[] OR policy.forbidden_claims<>ARRAY['unsupported_guarantee','unapproved_discount','invented_availability','unapproved_legal_or_financial_claim']::text[] OR policy.sensitive_data_rules<>ARRAY['do_not_request_passwords','do_not_request_payment_card_data','do_not_echo_secrets']::text[] OR policy.dialect_guidance<>'{}'::jsonb OR policy.disclaimers<>'{}'::jsonb OR policy.policy_fingerprint<>'md5:'||md5(organization.id::text||':phase5.conversation-intelligence.prompt.v1:safe-baseline') OR policy.superseded_at IS NOT NULL;")" = 0 || die 'conversation intelligence policy differs from its bridge default'
  test "$(db_scalar 'SELECT (SELECT count(*) FROM tanaghom.organization_conversation_policy_versions)=(SELECT count(*) FROM tanaghom.organizations);')" = t || die 'default conversation policy cardinality mismatch'
}

assert_public_bridge_boundary() {
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/login")" = 200 || die 'public login is unhealthy'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/")" = 307 || die 'unauthenticated root boundary changed'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/operations")" = 401 || die 'protected API boundary changed'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/system/monitoring")" = 404 || die 'running dashboard unexpectedly changed during the bridge'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/admin/notifications")" = 404 || die 'running dashboard unexpectedly changed during the bridge'
  if timeout 4 bash -c '</dev/tcp/38.247.187.232/5678' 2>/dev/null; then die 'public TCP 5678 is reachable'; fi
}

assert_firewall_boundary() {
  iptables -C DOCKER-USER -j TANAGHOM_N8N_DB_EGRESS >/dev/null 2>&1 || die 'approved Tanaghom n8n database firewall hook is absent'
  ! iptables -S DOCKER-USER | grep -q TANAGHOM_N8N_GATEWAY_EGRESS || die 'rolled-back Phase 4F gateway firewall hook is unexpectedly present'
}

capture_firewall_boundary() {
  destination=$1
  { iptables -S TANAGHOM_N8N_DB_EGRESS; iptables -S TANAGHOM_N8N_DB_INPUT; iptables -S DOCKER-USER | grep TANAGHOM_N8N_DB_EGRESS; iptables -S INPUT | grep TANAGHOM_N8N_DB_INPUT; } > "$destination"
  chmod 0600 "$destination"
}

assert_secret_metadata() {
  secret_dir="$PRODUCTION_ROOT/deployment/dashboard-canary/secrets"
  test "$(stat -c '%a' "$secret_dir")" = 710 || die 'secret directory mode must be 0710'
  for name in database_url supabase_url supabase_publishable_key supabase_jwks_url supabase_secret_key integration_credential_key integration_worker_token; do
    file="$secret_dir/$name"; test -s "$file" || die "required secret file is missing: $name"; mode=$(stat -c '%a' "$file"); case "$mode" in 400|440|600|640) ;; *) die "unsafe secret mode for $name: $mode" ;; esac
  done
}
