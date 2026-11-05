#!/bin/bash
# Takes a verified pre-upgrade snapshot of the isolated demo: PostgreSQL dump,
# RustFS object archive, per-table row counts and checksums. Read-only against
# the running stack. Never prints a secret.
set -euo pipefail
# shellcheck source=demo-lifecycle-lib.sh
. "$(dirname "$0")/demo-lifecycle-lib.sh"

require_postgres

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dir="$BACKUP_ROOT/$stamp"
mkdir -p "$dir"
chmod 0700 "$BACKUP_ROOT" "$dir"

ledger="$(ledger_tail)"
rows="$(ledger_count)"

# The dump goes to the host file through the container's stdout, so no secret
# and no password ever reaches the command line.
compose exec -T postgres pg_dump -U postgres -d tanaghom_demo -Fc --no-owner \
  --schema=public --schema=tanaghom > "$dir/database.dump"
compose exec -T postgres pg_restore -l < "$dir/database.dump" > "$dir/database.toc" ||
  refuse "the database dump cannot be listed"
grep -q 'TABLE DATA' "$dir/database.toc" || refuse "the database dump contains no table data"

table_counts > "$dir/counts.txt"
[ -s "$dir/counts.txt" ] || refuse "no table counts were captured"

docker run --rm --entrypoint sh -v "$BLOB_VOLUME":/data:ro -v "$dir":/out "$SNAPSHOT_IMAGE" \
  -c 'cd /data && tar -cf /out/rustfs.tar .'
tar -tf "$dir/rustfs.tar" > "$dir/rustfs.list"

blobs="$(blob_count)"
names="$(blob_names_hash)"

jq -n \
  --arg release "$TANAGHOM_DEMO_RELEASE" \
  --arg created "$(date -u +%FT%TZ)" \
  --arg ledger "$ledger" \
  --arg ledger_rows "$rows" \
  --arg dump "$(file_sha "$dir/database.dump")" \
  --arg rustfs "$(file_sha "$dir/rustfs.tar")" \
  --arg blobs "$blobs" \
  --arg names "$names" \
  '{release:$release,created_at:$created,ledger:$ledger,ledger_rows:($ledger_rows|tonumber),
    dump_sha256:$dump,rustfs_sha256:$rustfs,blob_count:($blobs|tonumber),blob_names_sha256:$names}' \
  > "$dir/manifest.json"

verify_backup "$dir" >/dev/null
ln -sfn "$dir" "$BACKUP_ROOT/latest"

echo "BACKUP_VERIFIED dir=$dir ledger=$ledger blobs=$blobs dump_sha256=$(file_sha "$dir/database.dump")"
