#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_environment
evidence=${1:-/var/backups/tanaghom-$TANAGHOM_CANARY_ID}
test -d "$evidence" || die "canary evidence directory is missing: $evidence"
test -s "$evidence/$STRATEGIST_ID.original.json" || die 'strategist original export is missing'
test -s "$evidence/$PRODUCER_ID.original.json" || die 'producer original export is missing'

unpublish_workflow "$STRATEGIST_ID"
unpublish_workflow "$PRODUCER_ID"
import_workflow_inactive "$evidence/$STRATEGIST_ID.original.json" strategist-restore
import_workflow_inactive "$evidence/$PRODUCER_ID.original.json" producer-restore
set_registry_inactive "$STRATEGIST_REGISTRY"
set_registry_inactive "$PRODUCER_REGISTRY"
assert_workflow_inactive "$STRATEGIST_ID"
assert_workflow_inactive "$PRODUCER_ID"
export_all_workflows "$evidence/workflows-restored-$(date -u +%Y%m%dT%H%M%SZ).json"
latest=$(ls -1t "$evidence"/workflows-restored-*.json | head -n1)
node "$WORKFLOW_CONTRACT" verify "$latest" "$evidence/workflow-manifest.json" original
echo "WORKFLOWS_RESTORED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$evidence/canary.env"
echo 'PASS: both core workflows are restored to their reviewed inactive operational definitions.'
