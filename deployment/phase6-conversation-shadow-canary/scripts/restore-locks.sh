#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_canary_environment
evidence=${1:-/var/backups/tanaghom-$TANAGHOM_CONVERSATION_CANARY_ID}
test -d "$evidence" || die "canary evidence directory is missing: $evidence"
test -s "$evidence/$WORKFLOW_ID.original.json" || die 'captured original workflow is missing'
test -s "$evidence/controls.before.json" || die 'captured GHL control state is missing'
reason=$(jq -er '.reason_base64' "$evidence/controls.before.json")

unpublish_workflow
import_workflow_inactive "$evidence/$WORKFLOW_ID.original.json" restore
operator restore-locks "$TANAGHOM_CONVERSATION_CANARY_ID" "$reason" > "$evidence/restore-locks-$(date -u +%Y%m%dT%H%M%SZ).json"
operator quarantine "$TANAGHOM_CONVERSATION_CANARY_ID" "$reason" > "$evidence/quarantine-$(date -u +%Y%m%dT%H%M%SZ).json"
assert_workflow_inactive
export_all_workflows "$evidence/workflows-restored-$(date -u +%Y%m%dT%H%M%SZ).json"
latest=$(ls -1t "$evidence"/workflows-restored-*.json | head -n1)
node "$SCRIPT_DIR/workflow-contract.mjs" verify "$latest" "$evidence/workflow-manifest.json"
echo "RESTORED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/canary.env"
echo 'PASS: Conversation Intelligence workflow, registry, GHL platform stop, and synthetic failure boundary are restored.'
