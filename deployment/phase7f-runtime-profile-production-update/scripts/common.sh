#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
. "$ROOT/deployment/phase7d-runtime-production-update/scripts/common.sh"

RELEASE_SOURCE_ROOT=${TANAGHOM_RELEASE_SOURCE_ROOT:-$ROOT}
EXPECTED_START_MIGRATION=0031_policy_runtime_executors_certification
TARGET_MIGRATION=0032_gemma_served_model_profile
PROFILE_ID=7d000000-0000-4000-8000-000000000002
MIGRATION_UP="$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.up.sql"
MIGRATION_DOWN="$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.down.sql"

require_release_environment() {
  test "${TANAGHOM_PROFILE_RELEASE_AUTHORIZATION:-}" = \
    'GO-INSTALL-IMMUTABLE-GEMMA-PROFILE' ||
    die 'explicit served-model profile authorization is absent'
  case "${TANAGHOM_PROFILE_RELEASE_ID:-}" in
    phase7f-profile-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_PROFILE_RELEASE_ID must use phase7f-profile-YYYYMMDDTHHMMSSZ' ;;
  esac
  for value in \
    "${TANAGHOM_EXPECTED_CURRENT_COMMIT:-}" \
    "${TANAGHOM_TARGET_COMMIT:-}"
  do
    echo "$value" | grep -Eq '^[0-9a-f]{40}$' ||
      die 'production and source commits must be full lowercase Git SHAs'
  done
}

assert_profile_absent() {
  test "$(latest_migration)" = "$EXPECTED_START_MIGRATION" ||
    die "database is not at $EXPECTED_START_MIGRATION"
  test "$(db_scalar "
    SELECT count(*) FROM tanaghom.agent_runtime_profiles
     WHERE id='$PROFILE_ID'
        OR code='gemma4_26b_a4b_canary_strict_v1';
  ")" = 0 || die 'served-model profile already exists'
  test "$(db_scalar "
    SELECT count(*) FROM tanaghom.agent_runtime_profiles
     WHERE id='7d000000-0000-4000-8000-000000000001'
       AND code='gemma4_vllm_strict_v1'
       AND model_name='gemma4-vllm'
       AND lifecycle_state='validated';
  ")" = 1 || die 'historical runtime profile changed'
}

assert_profile_target() {
  test "$(latest_migration)" = "$TARGET_MIGRATION" ||
    die "database is not at $TARGET_MIGRATION"
  test "$(db_scalar "
    SELECT count(*) FROM tanaghom.agent_runtime_profiles
     WHERE id='$PROFILE_ID'
       AND code='gemma4_26b_a4b_canary_strict_v1'
       AND model_name='gemma4-26b-a4b-canary'
       AND planner_contract_version='phase7.agent-runtime-plan.v1'
       AND planner_schema_ref='packages/contracts/schemas/phase7/agent-runtime-plan.v1.schema.json'
       AND planner_schema_hash='cc0e96f25505bf4251fc66e317a22e1a4a7e417cf08b5827aa270268f89b5178'
       AND prompt_version='policy-resolved-agent.v1'
       AND prompt_hash='ea65fca6fc3759a89c140a73e01057d90d25475b891e0473ee0fa721c6382485'
       AND parser_version='tanaghom.strict-json.v1'
       AND lifecycle_state='validated';
  ")" = 1 || die 'served-model profile differs from review'
}

assert_runtime_quiescent() {
  test "$(db_scalar "
    SELECT count(*) FROM tanaghom.organization_agent_jobs
     WHERE status IN ('queued','running','waiting_approval');
  ")" = 0 || die 'unfinished shared-runtime jobs require reconciliation'
  test "$(db_scalar "
    SELECT count(*) FROM tanaghom.agent_runtime_controls
     WHERE singleton AND emergency_stop=true;
  ")" = 1 || die 'shared runtime emergency stop is open'
  test "$(db_scalar "
    SELECT count(*) FROM tanaghom.agent_runtime_executor_adapters WHERE enabled;
  ")" = 0 || die 'an executor adapter is enabled'
}

capture_profile_release_state() {
  prefix=$1
  capture_production_worktree "$prefix.worktree"
  capture_n8n_ids "$prefix.n8n-containers"
  capture_firewall_boundary "$prefix.firewall"
  sha256sum /etc/nginx/conf.d/tanaghom-public.conf > "$prefix.nginx.sha256"
  sha256sum "$ALLOWED_PRODUCTION_FILE" > "$prefix.squid.sha256"
  chmod 0600 "$prefix".*
}

assert_profile_release_state_unchanged() {
  prefix=$1
  current=$(mktemp -d)
  capture_production_worktree "$current/worktree"
  cmp -s "$prefix.worktree.status" "$current/worktree.status" ||
    die 'production worktree status changed'
  cmp -s "$prefix.worktree.diff" "$current/worktree.diff" ||
    die 'production worktree diff changed'
  assert_n8n_ids_unchanged "$prefix.n8n-containers"
  capture_firewall_boundary "$current/firewall"
  cmp -s "$prefix.firewall" "$current/firewall" ||
    die 'firewall boundary changed'
  sha256sum -c "$prefix.nginx.sha256" >/dev/null ||
    die 'Nginx configuration changed'
  sha256sum -c "$prefix.squid.sha256" >/dev/null ||
    die 'reviewed Squid configuration changed'
  rm -rf -- "$current"
}
