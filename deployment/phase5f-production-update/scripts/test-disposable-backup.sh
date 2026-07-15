#!/bin/sh
set -eu

POSTGRES_IMAGE='postgres:16.14-alpine3.24@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777'
source_url=${1:-${DATABASE_TEST_URL:-}}
expected_migration=${2:-0019_notification_monitoring_destinations}
test -n "$source_url" || { echo 'DATABASE_TEST_URL is required' >&2; exit 2; }

suffix="$$"
container="tanaghom-phase5f-restore-$suffix"
workdir=$(mktemp -d)
raw="$workdir/tanaghom.dump"
encrypted="$workdir/tanaghom.dump.enc"
decrypted="$workdir/tanaghom-restored.dump"
key="$workdir/archive.key"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf -- "$workdir"
}
trap cleanup EXIT HUP INT TERM

test "$(psql "$source_url" -X -v ON_ERROR_STOP=1 -At -c 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = "$expected_migration"
pg_dump "$source_url" --format=custom --no-owner --no-acl --schema=public --schema=tanaghom --file="$raw"
test -s "$raw"

openssl rand -hex 32 > "$key"
chmod 0600 "$key"
openssl enc -aes-256-cbc -pbkdf2 -salt -in "$raw" -out "$encrypted" -pass "file:$key"
test -s "$encrypted"
! cmp -s "$raw" "$encrypted"
sha256sum "$encrypted" > "$workdir/tanaghom.dump.enc.sha256"
(cd "$workdir" && sha256sum -c tanaghom.dump.enc.sha256)
openssl enc -d -aes-256-cbc -pbkdf2 -in "$encrypted" -out "$decrypted" -pass "file:$key"
cmp -s "$raw" "$decrypted"

docker pull "$POSTGRES_IMAGE" >/dev/null
docker run -d --network none --name "$container" \
  -e POSTGRES_PASSWORD=restore-only -e POSTGRES_DB=restore_test \
  "$POSTGRES_IMAGE" >/dev/null

i=0
until docker exec "$container" pg_isready -U postgres -d restore_test >/dev/null 2>&1; do
  i=$((i + 1))
  test "$i" -lt 30
  sleep 2
done

docker cp "$decrypted" "$container:/tmp/tanaghom.dump" >/dev/null
docker exec "$container" pg_restore -U postgres -d restore_test \
  --no-owner --no-acl --clean --if-exists --exit-on-error /tmp/tanaghom.dump
test "$(docker exec "$container" psql -U postgres -d restore_test -X -v ON_ERROR_STOP=1 -At \
  -c 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = "$expected_migration"
docker exec "$container" psql -U postgres -d restore_test -X -v ON_ERROR_STOP=1 -At \
  -c 'SELECT count(*) FROM tanaghom.organizations;' >/dev/null

echo 'PASS: encrypted disposable database archive was decrypted, actually restored, and content-verified.'
