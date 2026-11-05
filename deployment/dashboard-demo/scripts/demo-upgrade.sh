#!/bin/bash
# Data-preserving upgrade of the isolated demo from the 0047 baseline to 0048.
# Requires a verified snapshot first. It never deletes a volume, never resets
# the database, and refuses on any unexpected row-count change.
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
[ "$before_ledger" = "0047_smartlabs_audio" ] ||
  refuse "expected the 0047 baseline, found ledger '$before_ledger'"
table_counts > "$dir/counts-upgrade-before.txt"
before_profiles="$(psql_demo -c "SELECT count(*) FROM tanaghom.agent_runtime_profiles")"

# Quiesce the application; the database stays up and keeps all rows.
compose stop dashboard >/dev/null 2>&1 || true
compose --profile workspace stop workspace-worker >/dev/null 2>&1 || true

echo "Upgrade starting: baseline=$before_ledger backup=$dir"
compose run --rm -T migrate 2>&1 | tail -n 5

after_ledger="$(ledger_tail)"
[ "$after_ledger" = "0048_gemini_workspace_model" ] ||
  refuse "upgrade did not reach 0048 (ledger=$after_ledger); restore from $dir"
[ "$(profile_present)" = "1" ] || refuse "the Gemini workspace profile was not installed"

table_counts > "$dir/counts-upgrade-after.txt"
report="$(count_delta_report "$dir/counts-upgrade-before.txt" "$dir/counts-upgrade-after.txt")"
# count_delta_report prints "table before->after" with a space, and the ledger grows
# by exactly the migration that was just applied, whatever its number.
before_rows="$(ledger_count)"
unexpected="$(printf '%s\n' "$report" |
  grep -vE "^(public\.schema_migrations ${before_rows}->$((before_rows + 1))|tanaghom\.agent_runtime_profiles ${before_profiles}->[0-9]+)$" |
  grep -v '^$' || true)"
if [ -n "$unexpected" ]; then
  echo "ROW_COUNT_DRIFT:" >&2
  printf '%s\n' "$unexpected" >&2
  refuse "the upgrade changed rows it must not touch; restore from $dir"
fi

compose up -d dashboard >/dev/null
wait_healthy dashboard

echo "UPGRADE_COMPLETE baseline=$before_ledger ledger=$after_ledger backup=$dir"
echo "ROW_COUNT_DELTAS:"
printf '%s\n' "$report"
