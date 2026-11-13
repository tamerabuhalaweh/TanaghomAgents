#!/bin/bash
# Data-preserving upgrade of the isolated demo to the current reviewed migration
# chain. Requires a verified snapshot first. It never deletes a volume, never
# resets the database, and refuses on any unexpected row-count change.
set -euo pipefail
# shellcheck source=demo-lifecycle-lib.sh
. "$(dirname "$0")/demo-lifecycle-lib.sh"

test "${TANAGHOM_DEMO_UPGRADE_AUTHORIZATION:-}" = "GO-UPGRADE-TANAGHOM-259-DEMO" ||
  refuse "set TANAGHOM_DEMO_UPGRADE_AUTHORIZATION=GO-UPGRADE-TANAGHOM-259-DEMO"

require_postgres

dir="${1:-$(latest_backup)}"
[ -n "$dir" ] || refuse "no verified backup found; run demo-backup.sh first"
verify_backup "$dir" >/dev/null

before_ledger="$(ledger_tail)"
before_count="$(ledger_count)"
total="$(migration_total)"
[ "$before_count" -lt "$total" ] ||
  refuse "already at the current ledger ($before_ledger); nothing to upgrade"

table_counts > "$dir/counts-upgrade-before.txt"

# Quiesce the application; the database stays up and keeps all rows.
compose stop dashboard >/dev/null 2>&1 || true
compose --profile workspace stop workspace-worker >/dev/null 2>&1 || true

rollback() {
  echo "Upgrade failed: $1" >&2
  echo "Restoring the verified snapshot $dir" >&2
  if restore_verified_backup "$dir"; then
    echo "ROLLBACK_RESTORED ledger=$(ledger_tail) dir=$dir" >&2
  else
    echo "ROLLBACK_FAILED: restore from $dir before serving traffic" >&2
  fi
  refuse "$1"
}

echo "Upgrade starting: baseline=$before_ledger pending=$((total - before_count)) backup=$dir"
if ! compose run --rm -T migrate </dev/null 2>&1 | tail -n 20; then
  rollback "the migration service failed"
fi

if ! ( verify_ledger_advanced "$before_count" ); then
  rollback "the ledger did not advance to the reviewed chain"
fi
after_ledger="$(ledger_tail)"

table_counts > "$dir/counts-upgrade-after.txt"
if ! ( verify_no_row_drift "$dir/counts-upgrade-before.txt" "$dir/counts-upgrade-after.txt" ); then
  rollback "row counts drifted during the upgrade"
fi

if ! compose up -d dashboard >/dev/null; then
  rollback "the dashboard did not start"
fi
if ! ( wait_healthy dashboard ); then
  rollback "the dashboard did not become healthy"
fi
# The worker was stopped above to quiesce the run; restore it when the host
# contract keeps the workspace enabled, otherwise the upgrade silently disables it.
if ! start_workspace_worker; then
  rollback "the workspace worker did not start"
fi

echo "UPGRADE_COMPLETE baseline=$before_ledger ledger=$after_ledger backup=$dir"
