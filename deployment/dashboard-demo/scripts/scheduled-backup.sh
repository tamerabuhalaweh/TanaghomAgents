#!/bin/bash
# Bounded-retention backup for the Phase 1 production host (#265).
#
# Runs the verified demo backup (PostgreSQL + RustFS + row counts + manifest),
# snapshots the Postiz database beside it, then prunes old snapshots. Retention
# keeps the newest N of each kind and never removes a directory that a `latest`
# symlink still points at. It prints markers and file sizes, never a secret.
#
#   TANAGHOM_DEMO_ROOT=/home/ubuntu/tanaghom-demo \
#   POSTIZ_SECRETS_DIR=/home/ubuntu/tanaghom-demo/runtime/secrets \
#     bash deployment/dashboard-demo/scripts/scheduled-backup.sh
#
# Suggested cron entry (operator-installed, see RUNBOOK.md):
#   15 3 * * * TANAGHOM_DEMO_ROOT=/home/ubuntu/tanaghom-demo bash /home/ubuntu/tanaghom-demo/source/deployment/dashboard-demo/scripts/scheduled-backup.sh >> /home/ubuntu/tanaghom-demo/runtime/backups/scheduled.log 2>&1
set -euo pipefail

_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=demo-lifecycle-lib.sh
. "$_lib_dir/demo-lifecycle-lib.sh"

retention="${TANAGHOM_BACKUP_RETENTION:-7}"
postiz_container="${POSTIZ_DB_CONTAINER:-postiz-postiz-postgres-1}"
postiz_user="${POSTIZ_DB_USER:-postiz}"
postiz_db="${POSTIZ_DB_NAME:-postiz}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

case "$retention" in
  ''|*[!0-9]*) refuse "TANAGHOM_BACKUP_RETENTION must be a positive integer" ;;
esac
[ "$retention" -ge 2 ] || refuse "TANAGHOM_BACKUP_RETENTION must keep at least 2 snapshots"

echo "SCHEDULED_BACKUP_START stamp=$stamp retention=$retention"
bash "$_lib_dir/demo-backup.sh"

# --- Postiz database ----------------------------------------------------------
if docker ps --format '{{.Names}}' | grep -Fxq "$postiz_container"; then
  postiz_dir="$BACKUP_ROOT/postiz-$stamp"
  mkdir -p "$postiz_dir"
  chmod 0700 "$postiz_dir"
  docker exec "$postiz_container" pg_dump -U "$postiz_user" -d "$postiz_db" -Fc --no-owner > "$postiz_dir/postiz.dump"
  chmod 0600 "$postiz_dir/postiz.dump"
  ( cd "$postiz_dir" && sha256sum postiz.dump > postiz.dump.sha256 )
  chmod 0600 "$postiz_dir/postiz.dump.sha256"
  # -i is required: without it docker exec does not attach stdin and pg_restore
  # reads an empty stream, which reports "input file is too short".
  docker exec -i "$postiz_container" pg_restore -l < "$postiz_dir/postiz.dump" > "$postiz_dir/postiz.toc" ||
    refuse "the Postiz dump cannot be listed"
  chmod 0600 "$postiz_dir/postiz.toc"
  ln -sfn "$postiz_dir" "$BACKUP_ROOT/postiz-latest"
  echo "POSTIZ_BACKUP_VERIFIED dir=$postiz_dir bytes=$(stat -c%s "$postiz_dir/postiz.dump") sha256=$(cut -d' ' -f1 "$postiz_dir/postiz.dump.sha256")"
else
  echo "POSTIZ_BACKUP_SKIPPED container=$postiz_container not running"
fi

# --- bounded retention --------------------------------------------------------
prune_kind() {
  local prefix="$1" link="$2" keep="$retention" dir target removed=0
  target="$(readlink -f "$BACKUP_ROOT/$link" 2>/dev/null || true)"
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    [ "$dir" = "$target" ] && continue
    rm -rf "${BACKUP_ROOT:?}/$dir"
    echo "PRUNED $prefix/$dir"
    removed=$((removed + 1))
  done < <(cd "$BACKUP_ROOT" && ls -1dt "$prefix"/*/ 2>/dev/null | sed "s|^$prefix/||; s|/$||" | tail -n +"$((keep + 1))")
  echo "RETENTION_KEPT $prefix count=$keep pruned=$removed"
}

prune_kind 20 latest
prune_kind postiz-20 postiz-latest

echo "SCHEDULED_BACKUP_COMPLETE stamp=$stamp root=$BACKUP_ROOT"
