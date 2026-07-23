#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
for script in "$SCRIPT_DIR"/*.sh; do sh -n "$script"; done
node "$ROOT/scripts/validate-vllm-structured-output-schemas.mjs"
node --test "$ROOT/tests/vllm-structured-output.test.mjs"
test -s "$ROOT/packages/database/migrations/0028_strategy_cadence_integrity.up.sql"
test -s "$ROOT/packages/database/migrations/0028_strategy_cadence_integrity.down.sql"
grep -q 'do not return a separate channel list' \
  "$ROOT/prompts/campaign-strategist/v2.md"
grep -q 'EXTERNAL_PROVIDER_OPERATIONS=0' "$SCRIPT_DIR/run-bilingual-uat.sh"
if grep -R -E 'systemctl (start|stop|restart)|docker compose (up|down)|iptables|nginx' \
  "$SCRIPT_DIR" --include='*.sh' --exclude='validate-package.sh'
then
  echo 'ERROR: package contains a prohibited service/network mutation' >&2
  exit 1
fi
echo 'PASS: bilingual UAT completion package is syntax- and boundary-valid.'
