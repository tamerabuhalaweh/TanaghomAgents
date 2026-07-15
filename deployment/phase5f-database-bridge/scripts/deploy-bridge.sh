#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
"$SCRIPT_DIR/preflight.sh"

evidence_dir=$(evidence_dir)
applied_file="$evidence_dir/applied-migrations"
committed=false

test ! -e "$evidence_dir" || die 'bridge evidence directory already exists'
install -d -o root -g root -m 0700 "$evidence_dir"
: > "$applied_file"
chmod 0600 "$applied_file"

capture_protected_container_ids "$evidence_dir/n8n-container-ids.before"
capture_dashboard_identity "$evidence_dir/dashboard-identity.before"
capture_firewall_boundary "$evidence_dir/firewall.before"
sha256sum /etc/nginx/conf.d/tanaghom-public.conf > "$evidence_dir/nginx.before.sha256"
chmod 0600 "$evidence_dir/nginx.before.sha256"
cat > "$evidence_dir/release.env" <<EOF
RELEASE_ID=$TANAGHOM_RELEASE_ID
EXPECTED_CURRENT_COMMIT=$TANAGHOM_EXPECTED_CURRENT_COMMIT
TARGET_COMMIT=$TANAGHOM_TARGET_COMMIT
EXPECTED_START_MIGRATION=$EXPECTED_START_MIGRATION
TARGET_MIGRATION=$TARGET_MIGRATION
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chmod 0600 "$evidence_dir/release.env"
: > "$evidence_dir/up-migrations.sha256"
: > "$evidence_dir/down-migrations.sha256"
for version in $PENDING_MIGRATIONS; do
  sha256sum "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.up.sql" >> "$evidence_dir/up-migrations.sha256"
  sha256sum "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.down.sql" >> "$evidence_dir/down-migrations.sha256"
done
cp "$TANAGHOM_BACKUP_PROOF" "$evidence_dir/offserver-backup-proof.env"
chmod 0600 "$evidence_dir/up-migrations.sha256" "$evidence_dir/down-migrations.sha256" "$evidence_dir/offserver-backup-proof.env"

rollback_applied_migrations() {
  reversed=$(mktemp)
  awk '{ lines[NR]=$0 } END { for (i=NR; i>=1; i--) print lines[i] }' "$applied_file" > "$reversed"
  while IFS= read -r version; do
    test -n "$version" || continue
    current=$(latest_migration)
    if test "$current" != "$version"; then echo "ERROR: automatic rollback ledger mismatch: expected $version, found $current" >&2; rm -f "$reversed"; return 1; fi
    if ! db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.down.sql"; then echo "ERROR: automatic rollback failed for $version" >&2; rm -f "$reversed"; return 1; fi
  done < "$reversed"
  rm -f "$reversed"
}

automatic_rollback() {
  test "$committed" = false || return 0
  set +e
  rollback_failed=0
  echo 'Bridge did not commit; reversing only ledger-recorded database migrations.' >&2
  if test "$(latest_migration 2>/dev/null)" = "$TARGET_MIGRATION"; then assert_bridge_default_state >/dev/null 2>&1 || rollback_failed=1; fi
  if test "$rollback_failed" -eq 0; then rollback_applied_migrations || rollback_failed=1; fi
  echo "ROLLED_BACK_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence_dir/release.env"
  if test "$rollback_failed" -ne 0; then echo 'ROLLBACK_FAILED=YES' >> "$evidence_dir/release.env"; echo 'ERROR: automatic bridge rollback was incomplete; keep emergency stops active.' >&2; fi
}
trap automatic_rollback EXIT
trap 'exit 70' HUP INT TERM

expected_previous=$EXPECTED_START_MIGRATION
for version in $PENDING_MIGRATIONS; do
  test "$(latest_migration)" = "$expected_previous" || die "migration predecessor mismatch before $version"
  migration_file="$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.up.sql"
  test -s "$migration_file" || die "reviewed migration file is missing: $version"
  db_file "$migration_file"
  echo "$version" >> "$applied_file"
  expected_previous=$version
done
test "$(latest_migration)" = "$TARGET_MIGRATION" || die 'bridge migration target was not reached'

"$SCRIPT_DIR/validate-release.sh"
echo "COMMITTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence_dir/release.env"
committed=true
trap - EXIT HUP INT TERM
echo "PASS: database-only bridge committed. No dashboard/source/container action occurred. Evidence: $evidence_dir"
