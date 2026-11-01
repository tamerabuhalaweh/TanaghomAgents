#!/bin/bash
set -euo pipefail

test "${TANAGHOM_DEMO_ROLLBACK_AUTHORIZATION:-}" = "ROLLBACK-TANAGHOM-243-DEMO"
: "${TANAGHOM_DEMO_SECRETS_DIR:?set TANAGHOM_DEMO_SECRETS_DIR}"
export TANAGHOM_DEMO_SECRETS_DIR
cd "$(dirname "$0")/.."

compose=(docker compose -p tanaghom-dashboard-demo -f compose.yml)
echo "ROLLBACK_BLOCKED: stopping containers is not a data-preserving release rollback; use the reviewed recovery procedure" >&2
exit 1
