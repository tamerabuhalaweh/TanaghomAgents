#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_runtime_agent_environment
"$SCRIPT_DIR/preflight.sh"
evidence="/var/backups/tanaghom-$TANAGHOM_RUNTIME_AGENT_RELEASE_ID"
test ! -e "$evidence" || die "evidence path already exists: $evidence"
install -d -m 0700 "$evidence"
committed=false
migration_applied=false

automatic_rollback() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$committed" = false; then
    set +e
    rollback_failed=0
    if test "$migration_applied" = true && test "$(latest_migration 2>/dev/null)" = "$TARGET_MIGRATION"; then
      assert_new_agents_unused || rollback_failed=1
      if test "$rollback_failed" -eq 0; then db_file "$MIGRATION_DOWN" >/dev/null || rollback_failed=1; fi
    fi
    echo "ROLLED_BACK_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/release.env"
    if test "$rollback_failed" -ne 0; then echo 'ROLLBACK_FAILED=YES' >> "$evidence/release.env"; fi
    set -e
  fi
  exit "$status"
}
trap automatic_rollback EXIT HUP INT TERM

capture_agents "$evidence/agents.before.txt"
capture_protected_container_ids "$evidence/protected-container-ids.before"
capture_dashboard_id "$evidence/dashboard-container-id.before"
capture_production_worktree_state "$evidence/production-worktree.before"
capture_firewall_boundary "$evidence/firewall.before"
sha256sum /etc/nginx/conf.d/tanaghom-public.conf > "$evidence/nginx.before.sha256"
export_all_workflows "$evidence/n8n-workflows.before.json"
capture_credential_inventory "$evidence/n8n-credentials.before.txt"
cat > "$evidence/release.env" <<EOF
RELEASE_ID=$TANAGHOM_RUNTIME_AGENT_RELEASE_ID
PRODUCTION_COMMIT=$TANAGHOM_EXPECTED_PRODUCTION_COMMIT
SOURCE_COMMIT=$TANAGHOM_RUNTIME_AGENT_SOURCE_COMMIT
EXPECTED_START_MIGRATION=$EXPECTED_START_MIGRATION
TARGET_MIGRATION=$TARGET_MIGRATION
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
sha256sum "$MIGRATION_UP" > "$evidence/migration-up.sha256"
sha256sum "$MIGRATION_DOWN" > "$evidence/migration-down.sha256"
chmod 0600 "$evidence"/*

db_file "$MIGRATION_UP" >/dev/null
migration_applied=true
"$SCRIPT_DIR/validate-release.sh"
echo "COMMITTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/release.env"
find "$evidence" -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > "$evidence/SHA256SUMS"
committed=true
trap - EXIT HUP INT TERM
echo "PASS: migration 0025 reconciled Publisher and Sales runtime agents only. Evidence: $evidence"
