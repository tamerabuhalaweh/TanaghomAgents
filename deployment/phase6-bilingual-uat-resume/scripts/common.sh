#!/bin/sh
set -eu

RESUME_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$RESUME_SCRIPT_DIR/../../phase6-uat-activation/scripts/common.sh"

EXPECTED_MIGRATION=0028_strategy_cadence_integrity
EXPECTED_PRODUCTION_COMMIT=2779f4442153c18962b652f832e92d8bd6a3c7e8
STRATEGIST_ID=phase3StrategistV1
STRATEGIST_SOURCE="$RELEASE_SOURCE_ROOT/n8n/workflows/phase3/campaign-strategist.v1.json"
GEMMA_UNIT=gemma4-26b-a4b-vllm-canary.service
GEMMA_KEY=/etc/smartlabs/gemma4_canary_api_key
PRIOR_RELEASE_ROOT=/opt/tanaghom-release-bilingual-uat-40b81a8
PRIOR_RELEASE_COMMIT=40b81a81c340d585a2bf36459f7e9ad6325acd18
ORIGINAL_UAT_ID=bilingualuat-20260723T115634Z
ORIGINAL_EVIDENCE="/var/backups/tanaghom-$ORIGINAL_UAT_ID"
UAT_CAMPAIGNS="'.test English Core-Agent UAT 2026-07-23','.test Arabic Core-Agent UAT 2026-07-23'"

require_resume_environment() {
  require_root
  test "${TANAGHOM_BILINGUAL_RESUME_AUTHORIZATION:-}" = \
    'RESUME-REVIEWED-TANAGHOM-BILINGUAL-UAT' ||
    die 'explicit bilingual resume authorization is absent'
  case "${TANAGHOM_BILINGUAL_RESUME_ID:-}" in
    bilingualresume-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_BILINGUAL_RESUME_ID must use bilingualresume-YYYYMMDDTHHMMSSZ' ;;
  esac
  echo "${TANAGHOM_EXPECTED_RELEASE_COMMIT:-}" |
    grep -Eq '^[0-9a-f]{40}$' ||
    die 'expected release commit must be a full lowercase Git SHA'
}

assert_prior_release_and_evidence() {
  test "$(git -C "$PRIOR_RELEASE_ROOT" rev-parse HEAD)" = "$PRIOR_RELEASE_COMMIT" ||
    die 'prior bilingual release commit changed'
  test -z "$(git -C "$PRIOR_RELEASE_ROOT" status --short)" ||
    die 'prior bilingual release is dirty'
  test -s "$ORIGINAL_EVIDENCE/release.env" ||
    die 'original bilingual correction evidence is missing'
  grep -q '^COMMITTED_AT=' "$ORIGINAL_EVIDENCE/release.env" ||
    die 'original bilingual correction did not commit'
  test ! -e "$ORIGINAL_EVIDENCE/uat-result.env" ||
    die 'original bilingual UAT already completed'
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

assert_migration_0028() {
  test "$(latest_migration)" = "$EXPECTED_MIGRATION" ||
    die "database is not at $EXPECTED_MIGRATION"
  test "$(db_scalar "
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid='tanaghom.campaign_strategies'::regclass
      AND conname='campaign_strategies_cadence_integrity_check'
      AND contype='c' AND convalidated;
  ")" = 1 || die 'validated strategy cadence constraint is missing'
  test "$(db_scalar "
    SELECT count(*) FROM tanaghom.strategy_cadence_0028_legacy_backup;
  ")" = 3 || die 'three preserved legacy cadence sources are unavailable'
}

assert_partial_bilingual_state() {
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.agent_jobs job
    JOIN tanaghom.campaigns campaign ON campaign.id=job.campaign_id
    WHERE job.job_type='campaign.strategy.generate'
      AND (
        (campaign.name='.test English Core-Agent UAT 2026-07-23'
          AND campaign.status='strategy_ready'
          AND job.status='succeeded')
        OR
        (campaign.name='.test Arabic Core-Agent UAT 2026-07-23'
          AND campaign.status='draft'
          AND job.status='failed'
          AND job.attempt=job.max_attempts
          AND job.error_code='gemma_invalid_json')
      );
  ")" = 2 || die 'partial bilingual strategy-job state is not exact'
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.campaign_strategies strategy
    JOIN tanaghom.campaigns campaign ON campaign.id=strategy.campaign_id
    WHERE campaign.name='.test English Core-Agent UAT 2026-07-23'
      AND tanaghom.campaign_strategy_cadence_is_valid(
        strategy.channels,strategy.posting_cadence
      );
  ")" = 1 || die 'successful English strategy is unavailable or invalid'
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.campaign_strategies strategy
    JOIN tanaghom.campaigns campaign ON campaign.id=strategy.campaign_id
    WHERE campaign.name='.test Arabic Core-Agent UAT 2026-07-23';
  ")" = 0 || die 'an Arabic strategy was unexpectedly persisted'
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.content_items content
    JOIN tanaghom.campaigns campaign ON campaign.id=content.campaign_id
    WHERE campaign.name IN ($UAT_CAMPAIGNS);
  ")" = 0 || die 'bilingual content exists before the resume'
}

export_live_strategist() {
  destination=$1
  remote="/home/node/tanaghom-$TANAGHOM_BILINGUAL_RESUME_ID-strategist.json"
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
  remote="/home/node/tanaghom-$TANAGHOM_BILINGUAL_RESUME_ID-$label.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -i -u node "$N8N_MAIN_CONTAINER" sh -ec \
    'umask 077; cat > "$1"' sh "$remote" <"$source"
  docker exec -u node "$N8N_MAIN_CONTAINER" \
    n8n import:workflow --input="$remote" --activeState=false >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
  assert_workflow_inactive "$STRATEGIST_ID"
}

assert_workflow_contract_matches() {
  node \
    "$RELEASE_SOURCE_ROOT/deployment/phase6-bilingual-uat-completion/scripts/workflow-contract.mjs" \
    "$1" "$2"
}
