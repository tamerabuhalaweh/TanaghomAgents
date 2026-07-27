#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)

# Reuse only the established dashboard, database-secret and protected-service
# primitives. Every Phase 7D release-specific boundary is replaced below.
. "$ROOT/deployment/phase7b-skill-library/scripts/common.sh"

RELEASE_SOURCE_ROOT=${TANAGHOM_RELEASE_SOURCE_ROOT:-$ROOT}
EXPECTED_START_MIGRATION=0029_organization_agent_studio
PENDING_MIGRATIONS='0030_policy_resolved_agent_runtime 0031_policy_runtime_executors_certification'
TARGET_MIGRATION=0031_policy_runtime_executors_certification
N8N_MAIN_CONTAINER=smartlabs-n8n-n8n-1
N8N_DATABASE_CONTAINER=smartlabs-n8n-postgres-1
N8N_EXPECTED_VERSION=2.26.8
ALLOWED_PRODUCTION_FILE="$PRODUCTION_ROOT/deployment/phase4-postiz-activation/egress/squid.conf"

WORKFLOW_IDS='phase7dPolicyResolvedAgentRunnerV1 phase7dSimulationDispatcherV1 phase7dReadExecutorV1 phase7dProposalExecutorV1 phase7dActionExecutorV1 phase7dRuntimeFinalizerV1'
CREDENTIAL_IDS='7d000000-0000-4000-8000-000000000101 7d100000-0000-4000-8000-000000000301 7d100000-0000-4000-8000-000000000302 7d100000-0000-4000-8000-000000000303'
LOGIN_ROLES='tanaghom_phase7d_runtime_login tanaghom_phase7d_read_login tanaghom_phase7d_proposal_login tanaghom_phase7d_action_login'

require_release_environment() {
  test "${TANAGHOM_PHASE7D_RELEASE_AUTHORIZATION:-}" = \
    'GO-INSTALL-LOCKED-PHASE7D-RUNTIME' ||
    die 'explicit Phase 7D owner authorization is absent'
  case "${TANAGHOM_PHASE7D_RELEASE_ID:-}" in
    phase7d-runtime-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_PHASE7D_RELEASE_ID must use phase7d-runtime-YYYYMMDDTHHMMSSZ' ;;
  esac
  TANAGHOM_RELEASE_ID=$TANAGHOM_PHASE7D_RELEASE_ID
  export TANAGHOM_RELEASE_ID
  for value in \
    "${TANAGHOM_EXPECTED_CURRENT_COMMIT:-}" \
    "${TANAGHOM_TARGET_COMMIT:-}"
  do
    echo "$value" | grep -Eq '^[0-9a-f]{40}$' ||
      die 'current and target commits must be full lowercase Git SHAs'
  done
  test "$TANAGHOM_EXPECTED_CURRENT_COMMIT" != "$TANAGHOM_TARGET_COMMIT" ||
    die 'current and target commits must differ'
}

latest_migration() {
  db_scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;'
}

n8n_db_scalar() {
  docker exec "$N8N_DATABASE_CONTAINER" sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1"' \
    sh "$1"
}

n8n_db_exec() {
  docker exec "$N8N_DATABASE_CONTAINER" sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' \
    sh "$1" >/dev/null
}

quoted_list() {
  result=
  for value in $1; do
    if test -z "$result"; then result="'$value'"; else result="$result,'$value'"; fi
  done
  printf '%s\n' "$result"
}

workflow_sql_ids() { quoted_list "$WORKFLOW_IDS"; }
credential_sql_ids() { quoted_list "$CREDENTIAL_IDS"; }
login_role_sql_ids() { quoted_list "$LOGIN_ROLES"; }

workflow_source() {
  case "$1" in
    phase7dPolicyResolvedAgentRunnerV1)
      echo "$RELEASE_SOURCE_ROOT/n8n/workflows/phase7d/policy-resolved-agent-runner.v1.json" ;;
    phase7dSimulationDispatcherV1)
      echo "$RELEASE_SOURCE_ROOT/n8n/workflows/phase7d/simulation-dispatcher.v1.json" ;;
    phase7dReadExecutorV1)
      echo "$RELEASE_SOURCE_ROOT/n8n/workflows/phase7d/read-executor.v1.json" ;;
    phase7dProposalExecutorV1)
      echo "$RELEASE_SOURCE_ROOT/n8n/workflows/phase7d/proposal-executor.v1.json" ;;
    phase7dActionExecutorV1)
      echo "$RELEASE_SOURCE_ROOT/n8n/workflows/phase7d/action-executor.v1.json" ;;
    phase7dRuntimeFinalizerV1)
      echo "$RELEASE_SOURCE_ROOT/n8n/workflows/phase7d/runtime-finalizer.v1.json" ;;
    *) die "unknown Phase 7D workflow ID: $1" ;;
  esac
}

credential_name() {
  case "$1" in
    7d000000-0000-4000-8000-000000000101)
      echo 'Tanaghom Agent Runtime PostgreSQL' ;;
    7d100000-0000-4000-8000-000000000301)
      echo 'Tanaghom Skill Read Executor PostgreSQL' ;;
    7d100000-0000-4000-8000-000000000302)
      echo 'Tanaghom Skill Proposal Executor PostgreSQL' ;;
    7d100000-0000-4000-8000-000000000303)
      echo 'Tanaghom Skill Action Executor PostgreSQL' ;;
    *) die "unknown Phase 7D credential ID: $1" ;;
  esac
}

login_capability_role() {
  case "$1" in
    tanaghom_phase7d_runtime_login) echo tanaghom_agent_runtime ;;
    tanaghom_phase7d_read_login) echo tanaghom_skill_read_executor ;;
    tanaghom_phase7d_proposal_login) echo tanaghom_skill_proposal_executor ;;
    tanaghom_phase7d_action_login) echo tanaghom_skill_action_executor ;;
    *) die "unknown Phase 7D login role: $1" ;;
  esac
}

assert_release_source() {
  test -d "$RELEASE_SOURCE_ROOT/.git" ||
    die 'reviewed release-source checkout is missing'
  test -z "$(git -C "$RELEASE_SOURCE_ROOT" status --porcelain)" ||
    die 'release-source checkout is dirty'
  test "$(git -C "$RELEASE_SOURCE_ROOT" rev-parse HEAD)" = "$TANAGHOM_TARGET_COMMIT" ||
    die 'release-source checkout is not the authorized target'
  remote_target=$(
    git -C "$RELEASE_SOURCE_ROOT" ls-remote origin refs/heads/main | awk '{print $1}'
  )
  test "$remote_target" = "$TANAGHOM_TARGET_COMMIT" ||
    die 'authorized target is not current remote main'
}

production_unexpected_changes() {
  git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" status --porcelain |
    grep -v '^ M deployment/phase4-postiz-activation/egress/squid.conf$' || true
}

assert_production_checkout() {
  test -d "$PRODUCTION_ROOT/.git" || die 'Tanaghom production checkout is missing'
  test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = \
    "$TANAGHOM_EXPECTED_CURRENT_COMMIT" ||
    die 'production checkout is not the reviewed current commit'
  test -z "$(production_unexpected_changes)" ||
    die 'production checkout contains an unreviewed change'
  git -C "$RELEASE_SOURCE_ROOT" merge-base --is-ancestor \
    "$TANAGHOM_EXPECTED_CURRENT_COMMIT" "$TANAGHOM_TARGET_COMMIT" ||
    die 'target is not a descendant of production'
  test -z "$(
    git -C "$RELEASE_SOURCE_ROOT" diff --name-only \
      "$TANAGHOM_EXPECTED_CURRENT_COMMIT..$TANAGHOM_TARGET_COMMIT" -- \
      deployment/phase4-postiz-activation/egress/squid.conf
  )" || die 'reviewed Squid configuration changed between commits'
}

assert_protected_units_active() {
  for unit in $PROTECTED_UNITS; do
    test "$(systemctl is-active "$unit")" = active ||
      die "protected unit is not active: $unit"
  done
}

assert_protected_containers_healthy() {
  for container in $PROTECTED_N8N_CONTAINERS; do
    test "$(container_health "$container")" = healthy ||
      die "protected n8n container is not healthy: $container"
  done
}

assert_firewall_boundary() {
  iptables -C DOCKER-USER -j TANAGHOM_N8N_DB_EGRESS >/dev/null 2>&1 ||
    die 'approved Tanaghom n8n database firewall hook is absent'
  iptables -C INPUT -j TANAGHOM_N8N_DB_INPUT >/dev/null 2>&1 ||
    die 'approved Tanaghom n8n database input hook is absent'
  ! iptables -S DOCKER-USER | grep -q TANAGHOM_N8N_GATEWAY_EGRESS ||
    die 'rolled-back Phase 4F gateway firewall hook is unexpectedly present'
}

capture_firewall_boundary() {
  destination=$1
  {
    iptables -S TANAGHOM_N8N_DB_EGRESS
    iptables -S TANAGHOM_N8N_DB_INPUT
    iptables -S DOCKER-USER | grep TANAGHOM_N8N_DB_EGRESS
    iptables -S INPUT | grep TANAGHOM_N8N_DB_INPUT
  } > "$destination"
  chmod 0600 "$destination"
}

capture_production_worktree() {
  prefix=$1
  git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" \
    status --porcelain=v1 > "$prefix.status"
  git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" \
    diff --binary --no-ext-diff > "$prefix.diff"
  chmod 0600 "$prefix.status" "$prefix.diff"
}

assert_dashboard_network_boundary() {
  container=tanaghom-dashboard-canary-dashboard-1
  test "$(container_health "$container")" = healthy ||
    die 'Tanaghom dashboard is unhealthy'
  networks=$(
    docker inspect -f \
      '{{range $name,$value := .NetworkSettings.Networks}}{{$name}} {{end}}' \
      "$container"
  )
  test "$networks" = 'tanaghom-dashboard-outbound ' ||
    die 'dashboard network membership changed'
  binding=$(
    docker inspect -f \
      '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostIp}}:{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' \
      "$container"
  )
  test "$binding" = '127.0.0.1:3200' ||
    die 'dashboard loopback binding changed'
}

assert_public_boundary() {
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
    "https://$PUBLIC_HOST/login")" = 200 ||
    die 'public login is unhealthy'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
    "https://$PUBLIC_HOST/agents")" = 307 ||
    die 'Agents page authentication boundary changed'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
    "https://$PUBLIC_HOST/api/operations")" = 401 ||
    die 'operations API authentication boundary changed'
}

assert_secret_metadata() {
  secret_dir="$PRODUCTION_ROOT/deployment/dashboard-canary/secrets"
  test "$(stat -c '%a' "$secret_dir")" = 710 ||
    die 'dashboard secret directory mode must be 0710'
  for name in database_url integration_credential_key integration_worker_token; do
    file="$secret_dir/$name"
    test -s "$file" || die "required dashboard secret is missing: $name"
    case "$(stat -c '%a' "$file")" in
      400|440|600|640) ;;
      *) die "unsafe secret mode for $name" ;;
    esac
  done
}

assert_safety_locks() {
  test "$(db_scalar "
    SELECT count(*) FROM tanaghom.automation_platform_controls
     WHERE emergency_stop IS NOT TRUE;
  ")" = 0 || die 'a provider platform stop is open'
  test "$(db_scalar "
    SELECT count(*) FROM tanaghom.organization_automation_policies
     WHERE postiz_draft_mode<>'manual';
  ")" = 0 || die 'Postiz policy is not manual'
  test "$(db_scalar "
    SELECT count(*) FROM tanaghom.organization_crm_policies
     WHERE contact_sync_mode<>'manual'
        OR conversation_processing_mode<>'paused'
        OR conversation_emergency_stop IS NOT TRUE
        OR action_mode<>'manual'
        OR proactive_message_mode<>'disabled'
        OR action_emergency_stop IS NOT TRUE;
  ")" = 0 || die 'CRM or conversation policy is not fail-closed'
  test "$(db_scalar 'SELECT count(*) FROM tanaghom.external_operations;')" = 0 ||
    die 'external provider operations exist'
  if test "$(db_scalar "
    SELECT to_regclass('tanaghom.agent_runtime_controls') IS NOT NULL;
  ")" = t; then
    test "$(db_scalar "
      SELECT count(*) FROM tanaghom.agent_runtime_controls
       WHERE emergency_stop IS NOT TRUE;
    ")" = 0 || die 'shared agent runtime emergency stop is open'
  fi
  if test "$(db_scalar "
    SELECT to_regclass('tanaghom.agent_runtime_executor_adapters') IS NOT NULL;
  ")" = t; then
    test "$(db_scalar "
      SELECT count(*) FROM tanaghom.agent_runtime_executor_adapters WHERE enabled;
    ")" = 0 || die 'an executor adapter is enabled'
  fi
}

assert_database_at_start() {
  test "$(latest_migration)" = "$EXPECTED_START_MIGRATION" ||
    die "database is not at $EXPECTED_START_MIGRATION"
  for table in \
    agent_runtime_controls organization_agent_jobs organization_agent_runs \
    organization_agent_invocations agent_runtime_executor_adapters
  do
    test "$(db_scalar "SELECT to_regclass('tanaghom.$table') IS NULL;")" = t ||
      die "unexpected pre-existing Phase 7D table: $table"
  done
  for role in \
    tanaghom_agent_runtime tanaghom_skill_read_executor \
    tanaghom_skill_proposal_executor tanaghom_skill_action_executor \
    $LOGIN_ROLES
  do
    test "$(db_scalar "
      SELECT count(*) FROM pg_roles WHERE rolname='$role';
    ")" = 0 || die "unexpected pre-existing Phase 7D role: $role"
  done
  assert_safety_locks
}

runtime_evidence_count() {
  db_scalar "
    SELECT
      (SELECT count(*) FROM tanaghom.organization_agent_jobs)
      +(SELECT count(*) FROM tanaghom.organization_agent_runs)
      +(SELECT count(*) FROM tanaghom.organization_agent_invocations)
      +(SELECT count(*) FROM tanaghom.organization_agent_invocation_approvals)
      +(SELECT count(*) FROM tanaghom.organization_agent_dependency_blocks)
      +(SELECT count(*) FROM tanaghom.organization_agent_runtime_events)
      +(SELECT count(*) FROM tanaghom.organization_agent_runtime_certifications)
      +(SELECT count(*) FROM tanaghom.agent_runtime_executor_adapter_events
          WHERE operator_ref<>'migration_0031');
  "
}

assert_target_database() {
  test "$(latest_migration)" = "$TARGET_MIGRATION" ||
    die 'Phase 7D target migration is not applied'
  test "$(db_scalar "
    SELECT count(*) FROM tanaghom.agent_runtime_controls
     WHERE singleton AND emergency_stop IS TRUE;
  ")" = 1 || die 'shared runtime does not default stopped'
  test "$(db_scalar "
    SELECT count(*) FROM tanaghom.agent_runtime_executor_adapters
     WHERE enabled IS FALSE;
  ")" = 3 || die 'the three reviewed adapters are not all disabled'
  test "$(db_scalar "
    SELECT count(*) FROM tanaghom.agent_runtime_executor_adapter_events
     WHERE enabled IS FALSE AND operator_ref='migration_0031';
  ")" = 3 || die 'adapter seed audit evidence differs from review'
  test "$(runtime_evidence_count)" = 0 ||
    die 'runtime evidence exists before activation'
  test "$(db_scalar "
    SELECT count(*) FROM tanaghom.agent_runtime_executor_adapters
     WHERE (code='phase7d_read_executor_v1'
             AND workflow_sha256='fa59952fcb99468a26b03c951dc8c6123527835fcc75fe555ab9b31e86b886f2')
        OR (code='phase7d_proposal_executor_v1'
             AND workflow_sha256='00e231e1c6ea263855e81d57ec484d9caf8da8632c9e3c3c871e31461edba797')
        OR (code='phase7d_action_executor_v1'
             AND workflow_sha256='027d588f8268ee72a87183cfff13dedc9fdd77e40af432136853d9f56698b19b');
  ")" = 3 || die 'reviewed adapter workflow hashes differ'
  for role in \
    tanaghom_agent_runtime tanaghom_skill_read_executor \
    tanaghom_skill_proposal_executor tanaghom_skill_action_executor
  do
    test "$(db_scalar "
      SELECT count(*) FROM pg_roles
       WHERE rolname='$role' AND rolcanlogin IS FALSE
         AND rolsuper IS FALSE AND rolcreaterole IS FALSE
         AND rolcreatedb IS FALSE AND rolbypassrls IS FALSE;
    ")" = 1 || die "capability role is absent or over-privileged: $role"
  done
  test "$(db_scalar "
    SELECT has_function_privilege(
      'tanaghom_n8n_worker',
      'tanaghom.claim_organization_agent_job(text)',
      'EXECUTE'
    );
  ")" = f || die 'legacy n8n worker can claim shared runtime work'
  assert_safety_locks
}

assert_login_roles_absent() {
  for role in $LOGIN_ROLES; do
    test "$(db_scalar "
      SELECT count(*) FROM pg_roles WHERE rolname='$role';
    ")" = 0 || die "Phase 7D login already exists: $role"
  done
}

assert_login_roles_least_privilege() {
  for role in $LOGIN_ROLES; do
    capability=$(login_capability_role "$role")
    test "$(db_scalar "
      SELECT count(*) FROM pg_roles
       WHERE rolname='$role' AND rolcanlogin IS TRUE
         AND rolsuper IS FALSE AND rolcreaterole IS FALSE
         AND rolcreatedb IS FALSE AND rolreplication IS FALSE
         AND rolbypassrls IS FALSE;
    ")" = 1 || die "login is absent or over-privileged: $role"
    test "$(db_scalar "
      SELECT pg_has_role('$role','$capability','MEMBER');
    ")" = t || die "$role lacks $capability membership"
    for other in \
      tanaghom_agent_runtime tanaghom_skill_read_executor \
      tanaghom_skill_proposal_executor tanaghom_skill_action_executor
    do
      if test "$other" != "$capability"; then
        test "$(db_scalar "
          SELECT pg_has_role('$role','$other','MEMBER');
        ")" = f || die "$role crossed into $other"
      fi
    done
  done
  test "$(db_scalar "
    SELECT has_function_privilege(
      'tanaghom_phase7d_read_login',
      'tanaghom.claim_agent_read_invocation(text)','EXECUTE'
    );
  ")" = t || die 'read login lacks the fixed read claim'
  test "$(db_scalar "
    SELECT has_function_privilege(
      'tanaghom_phase7d_read_login',
      'tanaghom.claim_agent_action_invocation(text)','EXECUTE'
    );
  ")" = f || die 'read login can claim action work'
  test "$(db_scalar "
    SELECT has_function_privilege(
      'tanaghom_phase7d_proposal_login',
      'tanaghom.claim_agent_proposal_invocation(text)','EXECUTE'
    );
  ")" = t || die 'proposal login lacks the fixed proposal claim'
  test "$(db_scalar "
    SELECT has_function_privilege(
      'tanaghom_phase7d_action_login',
      'tanaghom.claim_agent_action_invocation(text)','EXECUTE'
    );
  ")" = t || die 'action login lacks the fixed action claim'
  test "$(db_scalar "
    SELECT has_function_privilege(
      'tanaghom_phase7d_runtime_login',
      'tanaghom.claim_organization_agent_job(text)','EXECUTE'
    );
  ")" = t || die 'runtime login lacks the shared runtime claim'
}

assert_shared_credentials() {
  test "$(n8n_db_scalar "
    SELECT count(*) FROM credentials_entity
     WHERE (id='62000000-0000-4000-8000-000000000002'
              AND name='Tanaghom Gemma API' AND type='httpHeaderAuth')
        OR (id='62000000-0000-4000-8000-000000000004'
              AND name='Tanaghom Integration Gateway' AND type='httpHeaderAuth');
  ")" = 2 || die 'reviewed Gemma or private gateway credential is unavailable'
}

assert_package_credentials_absent() {
  ids=$(credential_sql_ids)
  test "$(n8n_db_scalar "
    SELECT count(*) FROM credentials_entity WHERE id IN ($ids);
  ")" = 0 || die 'a package-owned Phase 7D credential already exists'
}

assert_package_credentials_encrypted() {
  ids=$(credential_sql_ids)
  test "$(n8n_db_scalar "
    SELECT count(*) FROM credentials_entity
     WHERE id IN ($ids) AND type='postgres' AND length(data)>40;
  ")" = 4 || die 'the four encrypted Phase 7D credentials are incomplete'
  for id in $CREDENTIAL_IDS; do
    name=$(credential_name "$id")
    test "$(n8n_db_scalar "
      SELECT count(*) FROM credentials_entity
       WHERE id='$id' AND name='$name' AND type='postgres';
    ")" = 1 || die "credential identity differs from review: $id"
  done
}

workflow_execution_count() {
  n8n_db_scalar "
    SELECT count(*) FROM execution_entity WHERE \"workflowId\"='$1';
  "
}

assert_package_workflows_absent() {
  ids=$(workflow_sql_ids)
  test "$(n8n_db_scalar "
    SELECT count(*) FROM workflow_entity WHERE id IN ($ids);
  ")" = 0 || die 'a package-owned Phase 7D workflow already exists'
  for id in $WORKFLOW_IDS; do
    test "$(workflow_execution_count "$id")" = 0 ||
      die "execution history already exists for $id"
  done
}

assert_package_workflows_inactive() {
  ids=$(workflow_sql_ids)
  test "$(n8n_db_scalar "
    SELECT count(*) FROM workflow_entity
     WHERE id IN ($ids) AND active IS FALSE AND \"isArchived\" IS FALSE;
  ")" = 6 || die 'the six Phase 7D workflows are not all inactive'
  test "$(n8n_db_scalar "
    SELECT count(*)
      FROM workflow_entity workflow
      CROSS JOIN LATERAL jsonb_array_elements(workflow.nodes::jsonb) node
     WHERE workflow.id IN ($ids)
       AND node->>'type'='n8n-nodes-base.scheduleTrigger'
       AND coalesce((node->>'disabled')::boolean,false)=false;
  ")" = 0 || die 'a Phase 7D schedule trigger is enabled'
  for id in $WORKFLOW_IDS; do
    test "$(workflow_execution_count "$id")" = 0 ||
      die "Phase 7D workflow unexpectedly executed: $id"
  done
}

validate_workflow_sources() {
  command -v jq >/dev/null 2>&1 || die 'jq is required'
  for id in $WORKFLOW_IDS; do
    source=$(workflow_source "$id")
    test -s "$source" || die "workflow source is missing: $id"
    jq -e --arg id "$id" '
      .id==$id and .active==false and
      ([.nodes[] | select(
        .type=="n8n-nodes-base.scheduleTrigger"
        and (.disabled != true)
      )] | length)==0 and
      ([.nodes[] | select(
        .type=="n8n-nodes-base.executeCommand"
        or .type=="n8n-nodes-base.readWriteFile"
        or .type=="n8n-nodes-base.ssh"
      )] | length)==0 and
      .settings.saveDataErrorExecution=="none" and
      .settings.saveDataSuccessExecution=="none" and
      .settings.saveManualExecutions==false
    ' "$source" >/dev/null ||
      die "workflow is not inactive, disabled and retention-safe: $id"
  done
  grep -q 'phase7dSimulationDispatcherV1' \
    "$(workflow_source phase7dPolicyResolvedAgentRunnerV1)" ||
    die 'runner does not target the exact simulation dispatcher'
  for id in $CREDENTIAL_IDS \
    62000000-0000-4000-8000-000000000002 \
    62000000-0000-4000-8000-000000000004
  do
    grep -R -q "$id" "$RELEASE_SOURCE_ROOT/n8n/workflows/phase7d" ||
      die "reviewed Phase 7D credential is unreferenced: $id"
  done
  ! grep -R -Eq \
    '7d000000-0000-4000-8000-000000000102|7d100000-0000-4000-8000-00000000030[4-6]' \
    "$RELEASE_SOURCE_ROOT/n8n/workflows/phase7d" ||
    die 'obsolete duplicate Phase 7D credential IDs remain'
}

capture_credential_inventory() {
  destination=$1
  n8n_db_scalar "
    SELECT id||'|'||name||'|'||type FROM credentials_entity ORDER BY id;
  " > "$destination"
  chmod 0600 "$destination"
}

export_all_workflows() {
  destination=$1
  remote="/home/node/tanaghom-phase7d-workflows-$TANAGHOM_RELEASE_ID-$$.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -u node "$N8N_MAIN_CONTAINER" n8n export:workflow \
    --all --pretty --output="$remote" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" test -s "$remote"
  docker cp "$N8N_MAIN_CONTAINER:$remote" "$destination" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
  chmod 0600 "$destination"
}

assert_existing_credentials_unchanged() {
  before=$1
  after=$2
  filtered=$(mktemp)
  pattern=$(printf '%s\n' $CREDENTIAL_IDS | paste -sd'|' -)
  grep -Ev "^($pattern)\\|" "$after" > "$filtered" || true
  cmp -s "$before" "$filtered" || {
    rm -f "$filtered"
    die 'an existing n8n credential changed'
  }
  rm -f "$filtered"
}

assert_existing_workflows_unchanged() {
  before=$1
  after=$2
  before_normalized=$(mktemp)
  after_normalized=$(mktemp)
  ids=$(printf '%s\n' $WORKFLOW_IDS | jq -R . | jq -s .)
  jq -S --argjson ids "$ids" \
    'map(select(.id as $id | ($ids | index($id) | not))) | sort_by(.id)' \
    "$before" > "$before_normalized"
  jq -S --argjson ids "$ids" \
    'map(select(.id as $id | ($ids | index($id) | not))) | sort_by(.id)' \
    "$after" > "$after_normalized"
  cmp -s "$before_normalized" "$after_normalized" || {
    rm -f "$before_normalized" "$after_normalized"
    die 'an existing n8n workflow changed'
  }
  rm -f "$before_normalized" "$after_normalized"
}

delete_package_workflows() {
  assert_package_workflows_inactive
  ids=$(workflow_sql_ids)
  n8n_db_exec "
    BEGIN;
    DELETE FROM workflow_entity
     WHERE id IN ($ids) AND active IS FALSE;
    COMMIT;
  "
  assert_package_workflows_absent
}

delete_package_credentials() {
  assert_package_credentials_encrypted
  ids=$(credential_sql_ids)
  n8n_db_exec "
    BEGIN;
    DELETE FROM shared_credentials WHERE \"credentialsId\" IN ($ids);
    DELETE FROM credentials_entity WHERE id IN ($ids);
    COMMIT;
  "
  assert_package_credentials_absent
}

drop_login_roles() {
  for role in $LOGIN_ROLES; do
    if test "$(db_scalar "
      SELECT count(*) FROM pg_roles WHERE rolname='$role';
    ")" = 1; then
      db_scalar "DROP ROLE $role;" >/dev/null
    fi
  done
  assert_login_roles_absent
}

assert_target_compose_locked() {
  config=$(
    docker compose -p "$PROJECT" \
      -f "$RELEASE_SOURCE_ROOT/deployment/dashboard-canary/docker-compose.yml" \
      -f "$RELEASE_SOURCE_ROOT/deployment/dashboard-public/docker-compose.yml" \
      config
  )
  echo "$config" | grep -q 'AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED: "false"' ||
    die 'target dashboard does not explicitly disable Phase 7D provider execution'
}

assert_running_gateway_locked() {
  env=$(
    docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' \
      tanaghom-dashboard-canary-dashboard-1
  )
  echo "$env" | grep -qx 'AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED=false' ||
    die 'running dashboard provider execution is not explicitly false'
  unauthorized=$(
    curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
      -H 'Content-Type: application/json' --data '{}' \
      http://127.0.0.1:3200/api/internal/agent-runtime/provider
  )
  test "$unauthorized" = 401 ||
    die 'private Phase 7D gateway authentication boundary changed'

  config=$(mktemp)
  umask 077
  token=$(cat "$PRODUCTION_ROOT/deployment/dashboard-canary/secrets/integration_worker_token")
  printf 'header = "Authorization: Bearer %s"\n' "$token" > "$config"
  unset token
  locked=$(
    curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
      -K "$config" -H 'Content-Type: application/json' --data '{}' \
      http://127.0.0.1:3200/api/internal/agent-runtime/provider
  )
  rm -f "$config"
  test "$locked" = 503 ||
    die 'authenticated Phase 7D gateway is not fail-closed'
}
