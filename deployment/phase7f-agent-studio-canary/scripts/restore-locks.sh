#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_canary_environment
evidence=${1:-"/var/backups/tanaghom-$TANAGHOM_PHASE7F_CANARY_ID"}
test "$evidence" = "/var/backups/tanaghom-$TANAGHOM_PHASE7F_CANARY_ID" ||
  die 'restoration evidence path does not match the authorized canary ID'
test -s "$evidence/controls.before.json" ||
  die 'original runtime-stop evidence is missing'
reason=$(jq -er '.reason_base64' "$evidence/controls.before.json")
operator quarantine "$reason"
assert_canary_workflows_inactive
assert_safety_locks
assert_running_gateway_locked
echo 'PASS: the original runtime stop is restored and only unfinished Phase 7F canary work is quarantined.'
