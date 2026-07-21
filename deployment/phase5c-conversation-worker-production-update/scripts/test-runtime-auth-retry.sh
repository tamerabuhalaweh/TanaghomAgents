#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export TANAGHOM_WORKER_COMMON_DIR=$SCRIPT_DIR
. "$SCRIPT_DIR/common.sh"

temporary=$(mktemp -d)
cleanup() { rm -rf -- "$temporary"; }
trap cleanup EXIT HUP INT TERM

pgpass_file="$temporary/pgpass"
output="$temporary/output"
errors="$temporary/errors"
attempts="$temporary/attempts"
counter="$temporary/counter"
printf 'not-a-real-secret\n' > "$pgpass_file"
printf '0\n' > "$counter"

sleep() { :; }
psql() {
  current=$(cat "$counter")
  current=$((current + 1))
  printf '%s\n' "$current" > "$counter"
  if test "$current" -lt 3; then
    echo 'simulated Supavisor propagation delay' >&2
    return 1
  fi
  echo AUTHENTICATED
}

TANAGHOM_RUNTIME_AUTH_ATTEMPTS=4 TANAGHOM_RUNTIME_AUTH_RETRY_DELAY_SECONDS=0 \
  authenticate_runtime_role_with_retry "$pgpass_file" "$output" "$errors" "$attempts"
test "$(cat "$output")" = AUTHENTICATED
test "$(cat "$attempts")" = 3
test "$(grep -c 'simulated Supavisor propagation delay' "$errors")" = 2

printf '0\n' > "$counter"
psql() {
  current=$(cat "$counter")
  current=$((current + 1))
  printf '%s\n' "$current" > "$counter"
  echo 'simulated persistent authentication failure' >&2
  return 1
}

if TANAGHOM_RUNTIME_AUTH_ATTEMPTS=2 TANAGHOM_RUNTIME_AUTH_RETRY_DELAY_SECONDS=0 \
  authenticate_runtime_role_with_retry "$pgpass_file" "$output" "$errors" "$attempts"; then
  echo 'bounded authentication retry unexpectedly accepted persistent failure' >&2
  exit 1
fi
test "$(cat "$attempts")" = 2
test "$(cat "$counter")" = 2

echo 'PASS: runtime authentication retries recover from propagation delay and stop at the exact bound.'
