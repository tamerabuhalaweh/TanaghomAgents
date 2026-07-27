#!/bin/sh
set -eu

CANARY_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_SOURCE_ROOT=${TANAGHOM_RELEASE_SOURCE_ROOT:-$(CDPATH= cd -- "$CANARY_SCRIPT_DIR/../../.." && pwd)}
TANAGHOM_RELEASE_SOURCE_ROOT=$RELEASE_SOURCE_ROOT
export TANAGHOM_RELEASE_SOURCE_ROOT
. "$RELEASE_SOURCE_ROOT/deployment/phase7d-runtime-production-update/scripts/common.sh"

SCRIPT_DIR=$CANARY_SCRIPT_DIR
PRODUCTION_ROOT=${TANAGHOM_PRODUCTION_ROOT:-/opt/tanaghom-dashboard}
EXPECTED_MIGRATION=0032_gemma_served_model_profile
RUNNER_ID=phase7dPolicyResolvedAgentRunnerV1
SIMULATION_ID=phase7dSimulationDispatcherV1
CANARY_WORKFLOW_IDS="$RUNNER_ID $SIMULATION_ID"
DATABASE_CA_CERT=${TANAGHOM_DATABASE_CA_CERT:-$RELEASE_SOURCE_ROOT/deployment/phase3-shadow-canary/certificates/supabase-root-2021-ca.pem}

require_canary_environment() {
  test "${TANAGHOM_PHASE7F_CANARY_AUTHORIZATION:-}" = \
    'GO-INSTALL-DISPATCHER-AND-RUN-SIMULATION-ONLY-CANARY' ||
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
    "${TANAGHOM_CANARY_AGENT_VERSION_ID:-}" \
    "${TANAGHOM_CANARY_RUNTIME_PROFILE_ID:-}"
  do
    echo "$value" | grep -Eqi \
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' ||
      die 'organization, owner, agent version and runtime profile must be UUIDs'
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

publish_simulation_dispatcher() {
  docker exec -u node "$N8N_MAIN_CONTAINER" \
    n8n publish:workflow --id="$SIMULATION_ID"
}

unpublish_simulation_dispatcher() {
  docker exec -u node "$N8N_MAIN_CONTAINER" \
    n8n unpublish:workflow --id="$SIMULATION_ID"
}

export_simulation_dispatcher() {
  destination=$1
  remote="/home/node/tanaghom-$TANAGHOM_PHASE7F_CANARY_ID-dispatcher-export.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" \
    >/dev/null 2>&1 || true
  docker exec -u node "$N8N_MAIN_CONTAINER" \
    n8n export:workflow --id="$SIMULATION_ID" \
    --pretty --output="$remote" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" test -s "$remote"
  docker cp "$N8N_MAIN_CONTAINER:$remote" "$destination" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
  chmod 0600 "$destination"
}

import_simulation_dispatcher_inactive() {
  source=$1
  label=$2
  remote="/home/node/tanaghom-$TANAGHOM_PHASE7F_CANARY_ID-dispatcher-$label.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" \
    >/dev/null 2>&1 || true
  docker exec -i -u node "$N8N_MAIN_CONTAINER" sh -ec \
    'umask 077; cat > "$1"' sh "$remote" < "$source"
  docker exec -u node "$N8N_MAIN_CONTAINER" \
    n8n import:workflow --input="$remote" --activeState=false >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
  assert_canary_workflows_inactive
}

assert_simulation_dispatch_window() {
  test "$(n8n_db_scalar "
    SELECT count(*) FROM workflow_entity
     WHERE id='$RUNNER_ID' AND active IS FALSE AND \"isArchived\" IS FALSE;
  ")" = 1 || die 'the parent runner became active'
  test "$(n8n_db_scalar "
    SELECT count(*) FROM workflow_entity
     WHERE id='$SIMULATION_ID' AND active IS TRUE AND \"isArchived\" IS FALSE;
  ")" = 1 || die 'the fixed simulation dispatcher is not temporarily published'
  test "$(n8n_db_scalar "
    SELECT count(*)
      FROM workflow_entity workflow
      CROSS JOIN LATERAL jsonb_array_elements(workflow.nodes::jsonb) node
     WHERE workflow.id='$SIMULATION_ID'
       AND node->>'type'='n8n-nodes-base.scheduleTrigger'
       AND coalesce((node->>'disabled')::boolean,false)=false;
  ")" = 0 || die 'the simulation dispatcher gained an enabled schedule'
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
    TANAGHOM_CANARY_RUNTIME_PROFILE_ID="$TANAGHOM_CANARY_RUNTIME_PROFILE_ID" \
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
  canary_capture_prefix=$1
  capture_production_worktree "$canary_capture_prefix"
  capture_n8n_ids "$canary_capture_prefix.n8n-containers"
  capture_firewall_boundary "$canary_capture_prefix.firewall"
}

assert_production_state_unchanged() {
  canary_expected_prefix=$1
  canary_current_state=$(mktemp -d)
  capture_production_worktree "$canary_current_state/worktree"
  cmp -s "$canary_expected_prefix.status" "$canary_current_state/worktree.status" ||
    die 'production worktree status changed'
  cmp -s "$canary_expected_prefix.diff" "$canary_current_state/worktree.diff" ||
    die 'production worktree diff changed'
  assert_n8n_ids_unchanged "$canary_expected_prefix.n8n-containers"
  capture_firewall_boundary "$canary_current_state/firewall"
  cmp -s "$canary_expected_prefix.firewall" "$canary_current_state/firewall" ||
    die 'host firewall boundary changed'
  rm -rf -- "$canary_current_state"
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
