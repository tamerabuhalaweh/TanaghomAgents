#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
"$SCRIPT_DIR/preflight.sh"

evidence_dir="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
workflow_remote="/home/node/$WORKFLOW_ID-$TANAGHOM_RELEASE_ID.json"
credential_remote="/home/node/$CREDENTIAL_ID-$TANAGHOM_RELEASE_ID.json"
secret_file=$(mktemp)
role_sql=$(mktemp)
credential_json=$(mktemp)
connection_env=$(mktemp)
pgpass_file=$(mktemp)
committed=false
migration_applied=false
role_created=false

test ! -e "$evidence_dir" || die 'release evidence directory already exists'
install -d -o root -g root -m 0700 "$evidence_dir"
chmod 0600 "$secret_file" "$role_sql" "$credential_json" "$connection_env" "$pgpass_file"

cleanup_plaintext() {
  rm -f "$secret_file" "$role_sql" "$credential_json" "$connection_env" "$pgpass_file"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$workflow_remote" "$credential_remote" >/dev/null 2>&1 || true
}

automatic_rollback() {
  test "$committed" = false || return 0
  set +e
  rollback_failed=0
  cleanup_plaintext
  if test "$(workflow_count 2>/dev/null)" = 1; then delete_conversation_workflow || rollback_failed=1; fi
  if test "$(credential_count 2>/dev/null)" = 1; then delete_conversation_credential || rollback_failed=1; fi
  if test "$(runtime_role_count 2>/dev/null)" = 1; then db_scalar "DROP ROLE $RUNTIME_ROLE;" >/dev/null || rollback_failed=1; fi
  if test "$migration_applied" = true && test "$(latest_migration 2>/dev/null)" = "$TARGET_MIGRATION"; then
    db_scalar "UPDATE tanaghom.agent_workflow_registry SET runtime_state='available_not_imported',trigger_state='disabled',runtime_evidence='automatic-rollback-before-import' WHERE code='$WORKFLOW_REGISTRY_CODE';" >/dev/null || rollback_failed=1
    if test "$rollback_failed" -eq 0; then db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.down.sql" || rollback_failed=1; fi
  fi
  echo "ROLLED_BACK_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence_dir/release.env"
  if test "$rollback_failed" -ne 0; then
    echo 'ROLLBACK_FAILED=YES' >> "$evidence_dir/release.env"
    echo 'ERROR: automatic rollback was incomplete; keep every emergency stop active.' >&2
  fi
}
trap automatic_rollback EXIT
trap 'exit 70' HUP INT TERM

capture_protected_container_ids "$evidence_dir/n8n-container-ids.before"
capture_production_worktree_state "$evidence_dir/production-worktree.before"
capture_firewall_boundary "$evidence_dir/firewall.before"
sha256sum /etc/nginx/conf.d/tanaghom-public.conf > "$evidence_dir/nginx.before.sha256"
export_all_workflows "$evidence_dir/n8n-workflows.before.json"
capture_credential_inventory "$evidence_dir/n8n-credentials.before.txt"
cat > "$evidence_dir/release.env" <<EOF
RELEASE_ID=$TANAGHOM_RELEASE_ID
EXPECTED_CURRENT_COMMIT=$TANAGHOM_EXPECTED_CURRENT_COMMIT
TARGET_COMMIT=$TANAGHOM_TARGET_COMMIT
EXPECTED_START_MIGRATION=$EXPECTED_START_MIGRATION
TARGET_MIGRATION=$TARGET_MIGRATION
WORKFLOW_ID=$WORKFLOW_ID
CREDENTIAL_ID=$CREDENTIAL_ID
RUNTIME_ROLE=$RUNTIME_ROLE
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
sha256sum "$WORKFLOW_SOURCE" > "$evidence_dir/workflow-source.sha256"
sha256sum "$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.up.sql" > "$evidence_dir/migration-up.sha256"
sha256sum "$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.down.sql" > "$evidence_dir/migration-down.sha256"
chmod 0600 "$evidence_dir"/*

db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.up.sql"
migration_applied=true
test "$(latest_migration)" = "$TARGET_MIGRATION" || die 'migration target was not reached'

openssl rand -hex 32 > "$secret_file"
runtime_password=$(tr -d '\r\n' < "$secret_file")
test "${#runtime_password}" -eq 64 || die 'runtime password generation failed'
printf "CREATE ROLE %s LOGIN PASSWORD '%s' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS IN ROLE tanaghom_conversation_worker;\n" "$RUNTIME_ROLE" "$runtime_password" > "$role_sql"
unset runtime_password
db_file "$role_sql"
role_created=true
assert_runtime_role_least_privilege

python3 - "$credential_json" "$connection_env" "$pgpass_file" "$secret_file" "$DATABASE_SECRET" "$RUNTIME_ROLE" "$CREDENTIAL_ID" "$CREDENTIAL_NAME" <<'PY'
import json, pathlib, shlex, sys
from urllib.parse import unquote, urlsplit

output, env_path, pgpass_path, password_path, url_path, role, credential_id, credential_name = sys.argv[1:]
password = pathlib.Path(password_path).read_text().strip()
database_url = pathlib.Path(url_path).read_text().strip()
parsed = urlsplit(database_url)
owner_user = unquote(parsed.username or '')
project_suffix = owner_user.split('.', 1)[1] if '.' in owner_user else ''
runtime_user = f'{role}.{project_suffix}' if project_suffix else role
if not password or not parsed.hostname or not parsed.path.lstrip('/'):
    raise SystemExit('database credential source is incomplete')
credential = [{
    'id': credential_id,
    'name': credential_name,
    'type': 'postgres',
    'data': {
        'host': parsed.hostname,
        'database': parsed.path.lstrip('/'),
        'user': runtime_user,
        'password': password,
        'port': parsed.port or 5432,
        'maxConnections': 4,
        'allowUnauthorizedCerts': False,
        'ssl': 'require',
    },
}]
pathlib.Path(output).write_text(json.dumps(credential), encoding='utf-8')
port = parsed.port or 5432
database = parsed.path.lstrip('/')
pathlib.Path(env_path).write_text(
    '\n'.join([
        f'PGHOST={shlex.quote(parsed.hostname)}',
        f'PGPORT={shlex.quote(str(port))}',
        f'PGDATABASE={shlex.quote(database)}',
        f'PGUSER={shlex.quote(runtime_user)}',
        'PGSSLMODE=require',
    ]) + '\n', encoding='utf-8')
pathlib.Path(pgpass_path).write_text(
    f'{parsed.hostname}:{port}:{database}:{runtime_user}:{password}\n', encoding='utf-8')
PY

set -a
. "$connection_env"
set +a
authenticate_runtime_role_with_retry \
  "$pgpass_file" \
  "$evidence_dir/runtime-authentication.txt" \
  "$evidence_dir/runtime-authentication-errors.txt" \
  "$evidence_dir/runtime-authentication-attempts.txt" \
  || die 'runtime role could not authenticate through the production database endpoint after bounded retries'
unset PGHOST PGPORT PGDATABASE PGUSER PGSSLMODE

docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$credential_remote" >/dev/null 2>&1 || true
docker exec -i -u node "$N8N_MAIN_CONTAINER" sh -ec 'umask 077; cat > "$1"' sh "$credential_remote" < "$credential_json"
docker exec -u node "$N8N_MAIN_CONTAINER" test -r "$credential_remote"
docker exec -u node "$N8N_MAIN_CONTAINER" n8n import:credentials --input="$credential_remote"
docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$credential_remote"
rm -f "$secret_file" "$role_sql" "$credential_json" "$connection_env" "$pgpass_file"
assert_credential_encrypted

docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$workflow_remote" >/dev/null 2>&1 || true
docker exec -i -u node "$N8N_MAIN_CONTAINER" sh -ec 'umask 077; cat > "$1"' sh "$workflow_remote" < "$WORKFLOW_SOURCE"
docker exec -u node "$N8N_MAIN_CONTAINER" test -r "$workflow_remote"
docker exec -u node "$N8N_MAIN_CONTAINER" n8n import:workflow --input="$workflow_remote" --activeState=false
docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$workflow_remote"
assert_workflow_inactive

test "$(db_scalar "UPDATE tanaghom.agent_workflow_registry SET runtime_state='imported_inactive',trigger_state='disabled',runtime_verified_at=statement_timestamp(),runtime_evidence='$TANAGHOM_RELEASE_ID-inactive-zero-execution' WHERE code='$WORKFLOW_REGISTRY_CODE' AND runtime_state='available_not_imported' RETURNING 1;")" = 1 || die 'worker registry did not enter the imported-inactive state'

export_all_workflows "$evidence_dir/n8n-workflows.after.json"
capture_credential_inventory "$evidence_dir/n8n-credentials.after.txt"
assert_existing_workflows_unchanged "$evidence_dir/n8n-workflows.before.json" "$evidence_dir/n8n-workflows.after.json"
assert_existing_credentials_unchanged "$evidence_dir/n8n-credentials.before.txt" "$evidence_dir/n8n-credentials.after.txt"
docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit > "$evidence_dir/n8n-audit.txt"
chmod 0600 "$evidence_dir"/*

"$SCRIPT_DIR/validate-release.sh"
echo "COMMITTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence_dir/release.env"
committed=true
trap - EXIT HUP INT TERM
cleanup_plaintext
echo "PASS: Conversation Intelligence worker imported inactive with zero executions. Evidence: $evidence_dir"
