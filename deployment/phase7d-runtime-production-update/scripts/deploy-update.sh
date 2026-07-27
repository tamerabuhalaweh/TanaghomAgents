#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
"$SCRIPT_DIR/preflight.sh"

evidence="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
rollback_image="tanaghom-dashboard-canary:rollback-$TANAGHOM_RELEASE_ID"
applied_file="$evidence/applied-migrations"
role_sql=$(mktemp)
credential_json=$(mktemp)
pgpass_file=$(mktemp)
connection_tsv=$(mktemp)
credential_remote="/home/node/tanaghom-phase7d-credentials-$TANAGHOM_RELEASE_ID.json"
committed=false
source_changed=false
image_saved=false
dashboard_restored=false

test ! -e "$evidence" || die 'release evidence directory already exists'
install -d -o root -g root -m 0700 "$evidence"
: > "$applied_file"
chmod 0600 "$applied_file" "$role_sql" "$credential_json" "$pgpass_file" "$connection_tsv"

cleanup_plaintext() {
  rm -f "$role_sql" "$credential_json" "$pgpass_file" "$connection_tsv"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f \
    "$credential_remote" /home/node/tanaghom-phase7d-workflow-*.json \
    >/dev/null 2>&1 || true
}

restore_dashboard() {
  if test "$source_changed" = true; then
    git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" \
      checkout --detach "$TANAGHOM_EXPECTED_CURRENT_COMMIT" >/dev/null || return 1
  fi
  if test "$image_saved" = true; then
    docker image tag "$rollback_image" tanaghom-dashboard-canary:canary >/dev/null ||
      return 1
    compose up -d --no-deps --force-recreate --no-build dashboard >/dev/null ||
      return 1
    attempt=0
    until test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy; do
      attempt=$((attempt + 1))
      test "$attempt" -lt 36 || return 1
      sleep 5
    done
  fi
  dashboard_restored=true
}

delete_partial_workflows() {
  ids=$(workflow_sql_ids)
  test "$(n8n_db_scalar "
    SELECT count(*) FROM workflow_entity
     WHERE id IN ($ids) AND active IS TRUE;
  ")" = 0 || return 1
  test "$(n8n_db_scalar "
    SELECT count(*) FROM execution_entity WHERE \"workflowId\" IN ($ids);
  ")" = 0 || return 1
  n8n_db_exec "
    BEGIN;
    DELETE FROM workflow_entity WHERE id IN ($ids) AND active IS FALSE;
    COMMIT;
  "
}

delete_partial_credentials() {
  ids=$(credential_sql_ids)
  n8n_db_exec "
    BEGIN;
    DELETE FROM shared_credentials WHERE \"credentialsId\" IN ($ids);
    DELETE FROM credentials_entity WHERE id IN ($ids);
    COMMIT;
  "
}

rollback_applied_migrations() {
  reversed=$(mktemp)
  awk '{ lines[NR]=$0 } END { for (i=NR; i>=1; i--) print lines[i] }' \
    "$applied_file" > "$reversed"
  while IFS= read -r version; do
    test -n "$version" || continue
    test "$(latest_migration)" = "$version" || {
      rm -f "$reversed"
      return 1
    }
    db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.down.sql" || {
      rm -f "$reversed"
      return 1
    }
  done < "$reversed"
  rm -f "$reversed"
}

automatic_rollback() {
  test "$committed" = false || return 0
  set +e
  failed=0
  cleanup_plaintext
  restore_dashboard || failed=1
  delete_partial_workflows || failed=1
  delete_partial_credentials || failed=1
  drop_login_roles || failed=1
  if test -s "$applied_file"; then
    test "$dashboard_restored" = true || failed=1
    if test "$failed" -eq 0; then rollback_applied_migrations || failed=1; fi
  fi
  printf 'AUTOMATIC_ROLLBACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    >> "$evidence/release.env"
  if test "$failed" -ne 0; then
    echo 'ROLLBACK_FAILED=YES' > "$evidence/ROLLBACK_FAILED"
    echo 'ERROR: automatic rollback was incomplete; preserve evidence and keep all safety controls locked.' >&2
  fi
}
trap automatic_rollback EXIT
trap 'exit 70' HUP INT TERM

capture_n8n_ids "$evidence/n8n-container-ids.before"
capture_production_worktree "$evidence/production-worktree.before"
capture_firewall_boundary "$evidence/firewall.before"
sha256sum /etc/nginx/conf.d/tanaghom-public.conf > "$evidence/nginx.before.sha256"
sha256sum "$ALLOWED_PRODUCTION_FILE" > "$evidence/squid.before.sha256"
export_all_workflows "$evidence/n8n-workflows.before.json"
capture_credential_inventory "$evidence/n8n-credentials.before.txt"
docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit > "$evidence/n8n-audit.before.txt"

before_image=$(docker image inspect tanaghom-dashboard-canary:canary --format '{{.Id}}')
before_container=$(
  docker inspect tanaghom-dashboard-canary-dashboard-1 --format '{{.Id}}'
)
cat > "$evidence/release.env" <<EOF
RELEASE_ID=$TANAGHOM_RELEASE_ID
EXPECTED_CURRENT_COMMIT=$TANAGHOM_EXPECTED_CURRENT_COMMIT
TARGET_COMMIT=$TANAGHOM_TARGET_COMMIT
EXPECTED_START_MIGRATION=$EXPECTED_START_MIGRATION
TARGET_MIGRATION=$TARGET_MIGRATION
ROLLBACK_IMAGE=$rollback_image
PREVIOUS_IMAGE_ID=$before_image
PREVIOUS_DASHBOARD_CONTAINER_ID=$before_container
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

: > "$evidence/up-migrations.sha256"
: > "$evidence/down-migrations.sha256"
for version in $PENDING_MIGRATIONS; do
  sha256sum \
    "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.up.sql" \
    >> "$evidence/up-migrations.sha256"
  sha256sum \
    "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.down.sql" \
    >> "$evidence/down-migrations.sha256"
done
: > "$evidence/workflows.sha256"
for id in $WORKFLOW_IDS; do
  sha256sum "$(workflow_source "$id")" >> "$evidence/workflows.sha256"
done
git -C "$RELEASE_SOURCE_ROOT" show --no-patch --format='%H %cI %s' \
  "$TANAGHOM_TARGET_COMMIT" > "$evidence/target-commit.txt"
chmod 0600 "$evidence"/*

docker image tag tanaghom-dashboard-canary:canary "$rollback_image"
image_saved=true
git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" \
  fetch --no-tags origin main
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" \
  rev-parse FETCH_HEAD)" = "$TANAGHOM_TARGET_COMMIT" ||
  die 'fetched production target does not match authorization'
git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" \
  checkout --detach "$TANAGHOM_TARGET_COMMIT"
source_changed=true
test -z "$(production_unexpected_changes)" ||
  die 'production checkout contains an unreviewed change after target checkout'
sha256sum -c "$evidence/squid.before.sha256" >/dev/null ||
  die 'reviewed Squid configuration changed during checkout'

compose build --pull dashboard

expected_previous=$EXPECTED_START_MIGRATION
for version in $PENDING_MIGRATIONS; do
  test "$(latest_migration)" = "$expected_previous" ||
    die "migration predecessor mismatch before $version"
  db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.up.sql"
  echo "$version" >> "$applied_file"
  expected_previous=$version
done
assert_target_database

python3 "$SCRIPT_DIR/build-credential-package.py" \
  "$DATABASE_SECRET" "$role_sql" "$credential_json" "$pgpass_file" "$connection_tsv"
db_file "$role_sql"
assert_login_roles_least_privilege

auth_evidence="$evidence/runtime-authentication.txt"
: > "$auth_evidence"
tab=$(printf '\t')
while IFS="$tab" read -r role host port database pooler_user; do
  attempt=1
  authenticated=false
  while test "$attempt" -le 12; do
    if PGPASSFILE="$pgpass_file" PGCONNECT_TIMEOUT=10 PGSSLMODE=require \
      PGHOST="$host" PGPORT="$port" PGDATABASE="$database" PGUSER="$pooler_user" \
      psql -X -v ON_ERROR_STOP=1 -At \
      -c "SELECT CASE WHEN current_user='$role' THEN 'AUTHENTICATED' ELSE 'WRONG_ROLE' END;" \
      2>/dev/null | grep -qx AUTHENTICATED
    then
      authenticated=true
      break
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
  test "$authenticated" = true ||
    die "database login did not authenticate after bounded retries: $role"
  printf '%s=AUTHENTICATED attempt=%s\n' "$role" "$attempt" >> "$auth_evidence"
done < "$connection_tsv"
chmod 0600 "$auth_evidence"

docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$credential_remote" \
  >/dev/null 2>&1 || true
docker exec -i -u node "$N8N_MAIN_CONTAINER" sh -ec \
  'umask 077; cat > "$1"' sh "$credential_remote" < "$credential_json"
docker exec -u node "$N8N_MAIN_CONTAINER" \
  n8n import:credentials --input="$credential_remote"
docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$credential_remote"
rm -f "$role_sql" "$credential_json" "$pgpass_file" "$connection_tsv"
assert_package_credentials_encrypted
assert_shared_credentials

for id in $WORKFLOW_IDS; do
  source=$(workflow_source "$id")
  remote="/home/node/tanaghom-phase7d-workflow-$id.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -i -u node "$N8N_MAIN_CONTAINER" sh -ec \
    'umask 077; cat > "$1"' sh "$remote" < "$source"
  docker exec -u node "$N8N_MAIN_CONTAINER" \
    n8n import:workflow --input="$remote" --activeState=false
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
done
assert_package_workflows_inactive

compose up -d --no-deps dashboard
attempt=0
until test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 36 || die 'dashboard health timeout'
  sleep 5
done

export_all_workflows "$evidence/n8n-workflows.after.json"
capture_credential_inventory "$evidence/n8n-credentials.after.txt"
assert_existing_workflows_unchanged \
  "$evidence/n8n-workflows.before.json" "$evidence/n8n-workflows.after.json"
assert_existing_credentials_unchanged \
  "$evidence/n8n-credentials.before.txt" "$evidence/n8n-credentials.after.txt"
docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit > "$evidence/n8n-audit.after.txt"
chmod 0600 "$evidence"/*

"$SCRIPT_DIR/validate-release.sh"
printf 'COMMITTED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >> "$evidence/release.env"
chmod 0600 "$evidence/release.env"
committed=true
trap - EXIT HUP INT TERM
cleanup_plaintext
echo "PASS: locked Phase 7D runtime update committed. Evidence: $evidence"
