#!/bin/sh
set -eu

CANARY_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_SOURCE_ROOT=${TANAGHOM_RELEASE_SOURCE_ROOT:-$(CDPATH= cd -- "$CANARY_SCRIPT_DIR/../../.." && pwd)}
TANAGHOM_RELEASE_SOURCE_ROOT=$RELEASE_SOURCE_ROOT
export TANAGHOM_RELEASE_SOURCE_ROOT
. "$RELEASE_SOURCE_ROOT/deployment/phase7d-runtime-production-update/scripts/common.sh"

SCRIPT_DIR=$CANARY_SCRIPT_DIR
PRODUCTION_ROOT=${TANAGHOM_PRODUCTION_ROOT:-/opt/tanaghom-dashboard}
EXPECTED_MIGRATION=0031_policy_runtime_executors_certification
RUNNER_ID=phase7dPolicyResolvedAgentRunnerV1
SIMULATION_ID=phase7dSimulationDispatcherV1
CANARY_WORKFLOW_IDS="$RUNNER_ID $SIMULATION_ID"
DATABASE_CA_CERT=${TANAGHOM_DATABASE_CA_CERT:-$RELEASE_SOURCE_ROOT/deployment/phase3-shadow-canary/certificates/supabase-root-2021-ca.pem}

require_canary_environment() {
  test "${TANAGHOM_PHASE7F_CANARY_AUTHORIZATION:-}" = \
    'GO-RUN-SIMULATION-ONLY-AGENT-CANARY' ||
    die 'explicit Phase 7F simulation-only canary authorization is absent'
  case "${TANAGHOM_PHASE7F_CANARY_ID:-}" in
    phase7f-canary-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_PHASE7F_CANARY_ID must use phase7f-canary-YYYYMMDDTHHMMSSZ' ;;
  esac
  TANAGHOM_RELEASE_ID=$TANAGHOM_PHASE7F_CANARY_ID
  export TANAGHOM_RELEASE_ID
  for value in \
    "${TANAGHOM_EXPECTED_PRODUCTION_COMMIT:-}" \
    "${TANAGHOM_PHASE7F_SOURCE_COMMIT:-}"
  do
    echo "$value" | grep -Eq '^[0-9a-f]{40}$' ||
      die 'production and source commits must be full lowercase Git SHAs'
  done
  for value in \
    "${TANAGHOM_CANARY_ORGANIZATION_ID:-}" \
    "${TANAGHOM_CANARY_OWNER_ID:-}" \
    "${TANAGHOM_CANARY_AGENT_VERSION_ID:-}"
  do
    echo "$value" | grep -Eqi \
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' ||
      die 'organization, owner and agent version must be UUIDs'
  done
}

canary_workflow_sql_ids() {
  quoted_list "$CANARY_WORKFLOW_IDS"
}

assert_canary_workflows_inactive() {
  ids=$(canary_workflow_sql_ids)
  test "$(n8n_db_scalar "
    SELECT count(*) FROM workflow_entity
     WHERE id IN ($ids) AND active IS FALSE AND \"isArchived\" IS FALSE;
  ")" = 2 || die 'the reviewed runner and simulation dispatcher are not inactive'
  test "$(n8n_db_scalar "
    SELECT count(*)
      FROM workflow_entity workflow
      CROSS JOIN LATERAL jsonb_array_elements(workflow.nodes::jsonb) node
     WHERE workflow.id IN ($ids)
       AND node->>'type'='n8n-nodes-base.scheduleTrigger'
       AND coalesce((node->>'disabled')::boolean,false)=false;
  ")" = 0 || die 'a canary workflow schedule trigger is enabled'
}

assert_canary_credential_bindings() {
  ids=$(canary_workflow_sql_ids)
  test "$(n8n_db_scalar "
    WITH bindings AS (
      SELECT workflow.id AS workflow_id,node->>'name' AS node_name,
        credential.key AS credential_type,
        credential.value->>'id' AS credential_id,
        credential.value->>'name' AS binding_name
      FROM workflow_entity workflow
      CROSS JOIN LATERAL jsonb_array_elements(workflow.nodes::jsonb) node
      CROSS JOIN LATERAL jsonb_each(
        coalesce(node->'credentials','{}'::jsonb)
      ) credential
      WHERE workflow.id IN ($ids)
    )
    SELECT count(*)||'|'||count(stored.id)
    FROM bindings
    LEFT JOIN credentials_entity stored
      ON stored.id=bindings.credential_id
     AND stored.name=bindings.binding_name
     AND stored.type=bindings.credential_type;
  ")" = '6|6' ||
    die 'a canary workflow credential binding does not resolve to its reviewed name and type'
}

execute_runner_once() {
  docker exec -u node "$N8N_MAIN_CONTAINER" \
    n8n execute --id="$RUNNER_ID" --rawOutput
}

operator() {
  action=$1
  shift
  test -s "$DATABASE_CA_CERT" ||
    die "reviewed database CA certificate is missing: $DATABASE_CA_CERT"
  DATABASE_URL=$(database_url) \
    NODE_EXTRA_CA_CERTS="$DATABASE_CA_CERT" \
    TANAGHOM_DATABASE_SSL_MODE=verify-full \
    TANAGHOM_CANARY_ORGANIZATION_ID="$TANAGHOM_CANARY_ORGANIZATION_ID" \
    TANAGHOM_CANARY_OWNER_ID="$TANAGHOM_CANARY_OWNER_ID" \
    TANAGHOM_CANARY_AGENT_VERSION_ID="$TANAGHOM_CANARY_AGENT_VERSION_ID" \
    node "$SCRIPT_DIR/canary-operator.mjs" \
      "$action" "$TANAGHOM_PHASE7F_CANARY_ID" "$@"
}

capture_side_effect_counts() {
  destination=$1
  {
    echo "external_operations=$(db_scalar 'SELECT count(*) FROM tanaghom.external_operations;')"
    echo "posts=$(db_scalar 'SELECT count(*) FROM tanaghom.posts;')"
    echo "leads=$(db_scalar 'SELECT count(*) FROM tanaghom.leads;')"
    echo "provider_dispatches=$(db_scalar 'SELECT count(*) FROM tanaghom.organization_agent_invocations WHERE provider_dispatch_id IS NOT NULL;')"
    echo "provider_references=$(db_scalar 'SELECT count(*) FROM tanaghom.organization_agent_invocations WHERE provider_reference IS NOT NULL;')"
    echo "actual_cost=$(db_scalar 'SELECT coalesce(sum(actual_cost),0) FROM tanaghom.organization_agent_invocations;')"
  } > "$destination"
  chmod 0600 "$destination"
}

count_value() {
  file=$1
  key=$2
  awk -F= -v wanted="$key" \
    '$1==wanted {print substr($0,index($0,"=")+1); found=1} END {if(!found) exit 1}' \
    "$file"
}

assert_side_effect_counts_unchanged() {
  before=$1
  after=$2
  for key in \
    external_operations posts leads provider_dispatches provider_references actual_cost
  do
    test "$(count_value "$before" "$key")" = "$(count_value "$after" "$key")" ||
      die "$key changed during the simulation-only canary"
  done
}

capture_production_state() {
  prefix=$1
  capture_production_worktree "$prefix"
  capture_n8n_ids "$prefix.n8n-containers"
  capture_firewall_boundary "$prefix.firewall"
}

assert_production_state_unchanged() {
  prefix=$1
  current=$(mktemp -d)
  capture_production_worktree "$current/worktree"
  cmp -s "$prefix.status" "$current/worktree.status" ||
    die 'production worktree status changed'
  cmp -s "$prefix.diff" "$current/worktree.diff" ||
    die 'production worktree diff changed'
  assert_n8n_ids_unchanged "$prefix.n8n-containers"
  capture_firewall_boundary "$current/firewall"
  cmp -s "$prefix.firewall" "$current/firewall" ||
    die 'host firewall boundary changed'
  rm -rf -- "$current"
}

assert_phase7f_baseline() {
  test "$(latest_migration)" = "$EXPECTED_MIGRATION" ||
    die "database is not at $EXPECTED_MIGRATION"
  assert_login_roles_least_privilege
  assert_package_credentials_encrypted
  assert_shared_credentials
  assert_canary_workflows_inactive
  assert_canary_credential_bindings
  assert_safety_locks
  assert_running_gateway_locked
}
