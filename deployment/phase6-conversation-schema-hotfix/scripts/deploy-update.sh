#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_hotfix_environment
"$SCRIPT_DIR/preflight.sh"
evidence="/var/backups/tanaghom-$TANAGHOM_CONVERSATION_HOTFIX_ID"
test ! -e "$evidence" || die "evidence path already exists: $evidence"
install -d -m 0700 "$evidence"
prepared=false
committed=false

automatic_rollback() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$committed" = false; then
    set +e
    if test "$prepared" = true && test -s "$evidence/$WORKFLOW_ID.original.json"; then
      unpublish_workflow
      import_hotfix_workflow_inactive "$evidence/$WORKFLOW_ID.original.json" automatic-rollback
      export_all_workflows "$evidence/workflows.automatic-rollback.json"
      node "$SCRIPT_DIR/hotfix-contract.mjs" verify-original "$evidence/workflows.automatic-rollback.json" "$evidence/workflow-hotfix-manifest.json"
      rollback_status=$?
      if test "$rollback_status" -ne 0; then echo 'ROLLBACK_FAILED=YES' >> "$evidence/release.env"; fi
    fi
    echo "ROLLED_BACK_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/release.env"
    set -e
  fi
  exit "$status"
}
trap automatic_rollback EXIT HUP INT TERM

capture_protected_container_ids "$evidence/protected-container-ids.before"
capture_dashboard_id "$evidence/dashboard-container-id.before"
capture_production_worktree_state "$evidence/production-worktree.before"
capture_firewall_boundary "$evidence/firewall.before"
sha256sum /etc/nginx/conf.d/tanaghom-public.conf > "$evidence/nginx.before.sha256"
export_all_workflows "$evidence/workflows.before.json"
capture_credential_inventory "$evidence/n8n-credentials.before.txt"
printf '%s\n' "$(active_workflow_count)" > "$evidence/active-workflows.before"
printf '%s\n' "$(workflow_execution_count)" > "$evidence/conversation-executions.before"
node "$SCRIPT_DIR/hotfix-contract.mjs" prepare "$evidence/workflows.before.json" "$TARGET_WORKFLOW_SOURCE" "$evidence" "$EXPECTED_OLD_OPERATIONAL_SHA"
prepared=true
cat > "$evidence/release.env" <<EOF
HOTFIX_ID=$TANAGHOM_CONVERSATION_HOTFIX_ID
PRODUCTION_COMMIT=$TANAGHOM_EXPECTED_PRODUCTION_COMMIT
SOURCE_COMMIT=$TANAGHOM_CONVERSATION_HOTFIX_SOURCE_COMMIT
OLD_OPERATIONAL_SHA=$EXPECTED_OLD_OPERATIONAL_SHA
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chmod 0600 "$evidence"/*

import_hotfix_workflow_inactive "$TARGET_WORKFLOW_SOURCE" reviewed-target
"$SCRIPT_DIR/validate-release.sh"
echo "COMMITTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/release.env"
find "$evidence" -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > "$evidence/SHA256SUMS"
committed=true
trap - EXIT HUP INT TERM
echo "PASS: corrected Conversation Intelligence workflow imported inactive only. Evidence: $evidence"
