#!/bin/sh
set -eu

PACKAGE_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$PACKAGE_SCRIPT_DIR/../../phase6-uat-activation/scripts/common.sh"

EXPECTED_MIGRATION=0027_governed_skill_library
TARGET_MIGRATION=0028_strategy_cadence_integrity
EXPECTED_PRODUCTION_COMMIT=2779f4442153c18962b652f832e92d8bd6a3c7e8
STRATEGIST_ID=phase3StrategistV1
STRATEGIST_SOURCE="$RELEASE_SOURCE_ROOT/n8n/workflows/phase3/campaign-strategist.v1.json"
GEMMA_UNIT=gemma4-26b-a4b-vllm-canary.service
GEMMA_KEY=/etc/smartlabs/gemma4_canary_api_key
UAT_CAMPAIGNS="'.test English Core-Agent UAT 2026-07-23','.test Arabic Core-Agent UAT 2026-07-23'"
PREVIOUS_CORRECTION_ID=uatcorrection-20260723T050324Z
PREVIOUS_CORRECTION_EVIDENCE="/var/backups/tanaghom-$PREVIOUS_CORRECTION_ID"

require_bilingual_environment() {
  require_root
  test "${TANAGHOM_BILINGUAL_UAT_AUTHORIZATION:-}" = \
    'COMPLETE-REVIEWED-TANAGHOM-BILINGUAL-UAT' ||
    die 'explicit bilingual UAT authorization is absent'
  case "${TANAGHOM_BILINGUAL_UAT_ID:-}" in
    bilingualuat-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_BILINGUAL_UAT_ID must use bilingualuat-YYYYMMDDTHHMMSSZ' ;;
  esac
  echo "${TANAGHOM_EXPECTED_RELEASE_COMMIT:-}" |
    grep -Eq '^[0-9a-f]{40}$' ||
    die 'expected release commit must be a full lowercase Git SHA'
}

assert_previous_correction() {
  test -s "$PREVIOUS_CORRECTION_EVIDENCE/release.env" ||
    die 'previous UAT runtime correction evidence is missing'
  grep -q '^COMMITTED_AT=' "$PREVIOUS_CORRECTION_EVIDENCE/release.env" ||
    die 'previous UAT runtime correction did not commit'
  test ! -e "$PREVIOUS_CORRECTION_EVIDENCE/rollback-complete" ||
    die 'previous UAT runtime correction was rolled back'
}

assert_gemma_ready() {
  test "$(systemctl is-active "$GEMMA_UNIT")" = active ||
    die 'protected Gemma canary is not active'
  test "$(systemctl show "$GEMMA_UNIT" -p SubState --value)" = running ||
    die 'protected Gemma canary is not running'
  test -s "$GEMMA_KEY" || die 'Gemma API key file is missing'
  test "$(stat -c '%U' "$GEMMA_KEY")" = root ||
    die 'Gemma API key is not root-owned'
  case "$(stat -c '%a' "$GEMMA_KEY")" in
    600|640) ;;
    *) die 'Gemma API key mode is unsafe' ;;
  esac
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
    https://api.thesmartlabs.net/gemma4/v1/models)" = 401 ||
    die 'Gemma public authentication boundary changed'
}

assert_all_workflows_running() {
  for id in $ALL_IDS; do
    assert_workflow_active "$id"
    test "$(workflow_schedule_count "$id")" = 1 ||
      die "runtime schedule missing: $id"
    test "$(workflow_enabled_schedule_count "$id")" = 1 ||
      die "runtime schedule disabled: $id"
  done
}

assert_bilingual_jobs_quarantined() {
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.campaigns campaign
    JOIN tanaghom.agent_jobs job
      ON job.campaign_id=campaign.id
     AND job.job_type='campaign.strategy.generate'
    WHERE campaign.name IN ($UAT_CAMPAIGNS)
      AND campaign.status='draft'
      AND campaign.content_item_target=2
      AND job.status='failed'
      AND job.attempt=job.max_attempts
      AND job.error_code='gemma_http_error';
  ")" = 2 || die 'the two bilingual strategy jobs are not exactly quarantined'
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.campaign_strategies strategy
    JOIN tanaghom.campaigns campaign ON campaign.id=strategy.campaign_id
    WHERE campaign.name IN ($UAT_CAMPAIGNS);
  ")" = 0 || die 'a bilingual strategy already exists'
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.content_items content
    JOIN tanaghom.campaigns campaign ON campaign.id=content.campaign_id
    WHERE campaign.name IN ($UAT_CAMPAIGNS);
  ")" = 0 || die 'bilingual content already exists'
  assert_no_claimable_core_backlog
}

export_live_strategist() {
  destination=$1
  remote="/home/node/tanaghom-$TANAGHOM_BILINGUAL_UAT_ID-strategist.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -u node "$N8N_MAIN_CONTAINER" \
    n8n export:workflow --id="$STRATEGIST_ID" --pretty --output="$remote" >/dev/null
  docker cp "$N8N_MAIN_CONTAINER:$remote" "$destination" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
  chmod 0600 "$destination"
}

import_strategist_inactive() {
  source=$1
  label=$2
  remote="/home/node/tanaghom-$TANAGHOM_BILINGUAL_UAT_ID-$label.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -i -u node "$N8N_MAIN_CONTAINER" sh -ec \
    'umask 077; cat > "$1"' sh "$remote" <"$source"
  docker exec -u node "$N8N_MAIN_CONTAINER" \
    n8n import:workflow --input="$remote" --activeState=false >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
  assert_workflow_inactive "$STRATEGIST_ID"
}

assert_workflow_contract_matches() {
  live=$1
  reviewed=$2
  node "$PACKAGE_SCRIPT_DIR/workflow-contract.mjs" "$live" "$reviewed"
}
