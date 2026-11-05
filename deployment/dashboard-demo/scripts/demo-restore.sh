#!/bin/bash
# Restores the isolated demo from a verified snapshot: PostgreSQL dump and the
# RustFS object archive, then proves row counts and object inventory match the
# snapshot manifest. Runs on the same disposable host; it never deletes a volume.
set -euo pipefail
# shellcheck source=demo-lifecycle-lib.sh
. "$(dirname "$0")/demo-lifecycle-lib.sh"

test "${TANAGHOM_DEMO_RESTORE_AUTHORIZATION:-}" = "GO-RESTORE-TANAGHOM-259-DEMO" ||
  refuse "set TANAGHOM_DEMO_RESTORE_AUTHORIZATION=GO-RESTORE-TANAGHOM-259-DEMO"

require_postgres

dir="${1:-$(latest_backup)}"
[ -n "$dir" ] || refuse "no verified backup found"
verify_backup "$dir" >/dev/null
want_ledger="$(jq -r .ledger "$dir/manifest.json")"
want_blobs="$(jq -r .blob_count "$dir/manifest.json")"
want_names="$(jq -r .blob_names_sha256 "$dir/manifest.json")"

compose stop dashboard >/dev/null 2>&1 || true
compose --profile workspace stop workspace-worker >/dev/null 2>&1 || true
compose stop storage >/dev/null 2>&1 || true

echo "Restoring database from $dir"
# --clean cannot drop a schema that a later migration's function depends on, so
# the two demo schemas are reset first and the dump is restored into them. This
# replaces all rows by construction: nothing of the current state survives.
compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d tanaghom_demo \
  -c "DROP SCHEMA IF EXISTS tanaghom CASCADE; DROP SCHEMA IF EXISTS public CASCADE;"
compose exec -T postgres pg_restore -U postgres -d tanaghom_demo \
  --no-owner --exit-on-error < "$dir/database.dump"

echo "Restoring object store from $dir"
docker run --rm --entrypoint sh -v "$BLOB_VOLUME":/data "$SNAPSHOT_IMAGE" -c 'rm -rf /data/*'
docker run --rm --entrypoint sh -v "$BLOB_VOLUME":/data -v "$dir":/in:ro "$SNAPSHOT_IMAGE" \
  -c 'cd /data && tar -xf /in/rustfs.tar'

table_counts > "$dir/counts-restore-after.txt"
if ! diff -u "$dir/counts.txt" "$dir/counts-restore-after.txt" > "$dir/counts-restore.diff"; then
  cat "$dir/counts-restore.diff" >&2
  refuse "restored row counts differ from the snapshot manifest"
fi
[ "$(ledger_tail)" = "$want_ledger" ] || refuse "restored ledger is $(ledger_tail), expected $want_ledger"
[ "$(blob_count)" = "$want_blobs" ] || refuse "restored object count is $(blob_count), expected $want_blobs"
[ "$(blob_names_hash)" = "$want_names" ] || refuse "restored object inventory differs from the snapshot"

compose up -d >/dev/null
wait_healthy dashboard

echo "RESTORE_COMPLETE ledger=$want_ledger blobs=$want_blobs tables=$(wc -l < "$dir/counts.txt") dir=$dir"
