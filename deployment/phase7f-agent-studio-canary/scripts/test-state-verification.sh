#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
expected_n8n_evidence="$temporary/before.n8n-containers"

capture_production_worktree() {
  prefix=$1
  printf 'reviewed-status\n' > "$prefix.status"
  printf 'reviewed-diff\n' > "$prefix.diff"
}
capture_n8n_ids() {
  destination=$1
  printf 'reviewed-n8n-identities\n' > "$destination"
}
assert_n8n_ids_unchanged() {
  test "$1" = "$expected_n8n_evidence"
  test "$(cat "$1")" = reviewed-n8n-identities
}
capture_firewall_boundary() {
  destination=$1
  printf 'reviewed-firewall\n' > "$destination"
}

capture_production_state "$temporary/before"
for evidence in \
  before.status \
  before.diff \
  before.n8n-containers \
  before.firewall
do
  test -s "$temporary/$evidence" || {
    echo "canary state capture used an incorrect evidence path: $evidence" >&2
    exit 1
  }
done

assert_production_state_unchanged "$temporary/before"
echo 'PASS: canary state verification compares current evidence with the original reviewed snapshot.'
