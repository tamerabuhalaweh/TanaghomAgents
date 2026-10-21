#!/bin/bash
set -euo pipefail

test "${TANAGHOM_DEMO_ROLLBACK_AUTHORIZATION:-}" = "ROLLBACK-TANAGHOM-243-DEMO"
: "${TANAGHOM_DEMO_SECRETS_DIR:?set TANAGHOM_DEMO_SECRETS_DIR}"
export TANAGHOM_DEMO_SECRETS_DIR
cd "$(dirname "$0")/.."

compose=(docker compose -p tanaghom-dashboard-demo -f compose.yml)
if [ "${TANAGHOM_DEMO_REMOVE_VOLUMES:-0}" = "1" ]; then
  "${compose[@]}" down --remove-orphans --volumes
else
  "${compose[@]}" down --remove-orphans
fi
echo "DEMO_ROLLBACK_COMPLETE canary=untouched"
