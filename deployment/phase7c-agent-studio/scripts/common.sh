#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)

# Reuse the established dashboard/protected-service primitives from the already
# reviewed Phase 7B package, then replace every release-specific boundary.
. "$ROOT/deployment/phase7b-skill-library/scripts/common.sh"

EXPECTED_START_MIGRATION=0028_strategy_cadence_integrity
TARGET_MIGRATION=0029_organization_agent_studio

require_release_environment() {
  test "${TANAGHOM_RELEASE_AUTHORIZATION:-}" = 'YES-I-AM-THE-AUTHORIZED-OWNER' ||
    die 'explicit owner authorization is absent'
  echo "${TANAGHOM_TARGET_COMMIT:-}" | grep -Eq '^[0-9a-f]{40}$' ||
    die 'TANAGHOM_TARGET_COMMIT must be a full lowercase Git SHA'
  case "${TANAGHOM_RELEASE_ID:-}" in
    phase7c-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_RELEASE_ID must use phase7c-YYYYMMDDTHHMMSSZ' ;;
  esac
}

assert_agent_studio_target() {
  test "$(db_scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;")" = "$TARGET_MIGRATION" ||
    die 'Agent Studio target migration is not applied'
  for table in agent_studio_templates organization_agent_definitions \
    organization_agent_versions organization_agent_skill_bindings \
    organization_agent_integration_bindings organization_agent_policies \
    organization_agent_test_scenarios organization_agent_audit_events; do
    test "$(db_scalar "SELECT to_regclass('tanaghom.$table') IS NOT NULL;")" = t ||
      die "missing Agent Studio table: $table"
  done
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_studio_templates;")" = 3 ||
    die 'Agent Studio template seed is incomplete'
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_api','tanaghom.organization_agent_versions','SELECT');")" = t ||
    die 'dashboard API cannot read Agent Studio versions'
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_api','tanaghom.organization_agent_versions','INSERT,UPDATE,DELETE');")" = f ||
    die 'dashboard API received direct Agent Studio DML'
  test "$(db_scalar "SELECT has_function_privilege('tanaghom_api','tanaghom.create_organization_agent_draft(uuid,uuid,jsonb,text,uuid)','EXECUTE');")" = t ||
    die 'dashboard API cannot call the governed Agent Studio mutation'
  test "$(db_scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.organization_agent_versions','SELECT,INSERT,UPDATE,DELETE');")" = f ||
    die 'n8n received Agent Studio table access'
  test "$(db_scalar "SELECT has_function_privilege('tanaghom_n8n_worker','tanaghom.create_organization_agent_draft(uuid,uuid,jsonb,text,uuid)','EXECUTE');")" = f ||
    die 'n8n received Agent Studio mutation authority'
}

agent_studio_data_summary() {
  db_scalar "SELECT string_agg(table_name||'='||rows,',') FROM (
    SELECT 'definitions' table_name,count(*) rows FROM tanaghom.organization_agent_definitions
    UNION ALL SELECT 'versions',count(*) FROM tanaghom.organization_agent_versions
    UNION ALL SELECT 'skills',count(*) FROM tanaghom.organization_agent_skill_bindings
    UNION ALL SELECT 'integrations',count(*) FROM tanaghom.organization_agent_integration_bindings
    UNION ALL SELECT 'policies',count(*) FROM tanaghom.organization_agent_policies
    UNION ALL SELECT 'scenarios',count(*) FROM tanaghom.organization_agent_test_scenarios
    UNION ALL SELECT 'audits',count(*) FROM tanaghom.organization_agent_audit_events
  ) counts WHERE rows<>0;"
}

assert_agent_studio_empty() {
  test -z "$(agent_studio_data_summary)" ||
    die 'organization Agent Studio data exists'
}
