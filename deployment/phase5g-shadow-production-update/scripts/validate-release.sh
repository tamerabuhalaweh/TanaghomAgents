#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
evidence_dir="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
test -d "$evidence_dir" || die 'release evidence directory is missing'
test -s "$evidence_dir/n8n-container-ids.before" || die 'protected-container baseline is missing'
test -s "$evidence_dir/n8n-workflows.before.json" || die 'pre-import workflow evidence is missing'
test -s "$evidence_dir/n8n-workflows.after.json" || die 'post-import workflow evidence is missing'
test -s "$evidence_dir/n8n-audit.txt" || die 'post-import n8n audit evidence is missing'

test "$(latest_migration)" = "$TARGET_MIGRATION" || die 'target migration is not applied'
test "$(db_scalar "SELECT count(*) FROM tanaghom.quality_metric_program_versions;")" = 0 || die 'metric evidence was unexpectedly created'
test "$(db_scalar "SELECT (SELECT count(*) FROM tanaghom.quality_evaluation_datasets)+(SELECT count(*) FROM tanaghom.quality_shadow_jobs)+(SELECT count(*) FROM tanaghom.quality_shadow_results);")" = 0 || die 'baseline or shadow evidence was unexpectedly created'
test "$(db_scalar "SELECT count(*) FROM tanaghom.quality_rollout_policies WHERE current_stage<>'baseline';")" = 0 || die 'quality stage changed'
test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 || die 'external operations were created'
test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 || die 'a provider emergency stop is inactive'
test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_crm_policies WHERE contact_sync_mode<>'manual' OR conversation_processing_mode<>'paused' OR conversation_emergency_stop IS NOT TRUE OR action_mode<>'manual' OR proactive_message_mode<>'disabled' OR action_emergency_stop IS NOT TRUE;")" = 0 || die 'CRM or conversation policy changed'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.quality_shadow_jobs','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'n8n received direct quality-job table access'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.quality_shadow_results','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'n8n received direct quality-result table access'
test "$(db_scalar "SELECT has_function_privilege('tanaghom_n8n_worker','tanaghom.claim_quality_shadow_job()','EXECUTE');")" = t || die 'restricted shadow claim function is unavailable'
test "$(db_scalar "SELECT has_function_privilege('tanaghom_n8n_worker','tanaghom.persist_quality_shadow_result(uuid,jsonb)','EXECUTE');")" = t || die 'restricted shadow persistence function is unavailable'
test "$(db_scalar "SELECT has_function_privilege('tanaghom_conversation_worker','tanaghom.claim_quality_shadow_job()','EXECUTE');")" = f || die 'conversation worker received shadow claim authority'

assert_workflow_inactive
assert_existing_workflows_unchanged "$evidence_dir/n8n-workflows.before.json" "$evidence_dir/n8n-workflows.after.json"
test "$(jq -r --arg id "$WORKFLOW_ID" '[.[] | select(.id==$id and .active==false)] | length' "$evidence_dir/n8n-workflows.after.json")" = 1 || die 'exported workflow is not uniquely inactive'

assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
current_firewall=$(mktemp)
capture_firewall_boundary "$current_firewall"
cmp -s "$evidence_dir/firewall.before" "$current_firewall" || die 'package-owned firewall state changed'
rm -f "$current_firewall"
sha256sum -c "$evidence_dir/nginx.before.sha256" >/dev/null || die 'Tanaghom Nginx configuration changed'
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy || die 'dashboard is not healthy'
assert_firewall_boundary
assert_public_boundary
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/quality")" = 401 || die 'quality API authentication boundary changed'
health=$(curl -fsS --max-time 10 http://127.0.0.1:3200/api/health)
echo "$health" | grep -q '"database":"connected"' || die 'dashboard database health failed'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_TARGET_COMMIT" || die 'production source is not target commit'

echo 'PASS: migration 0021, dashboard, and exactly one inactive zero-execution shadow workflow validated without changing protected services.'
