#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM

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
  test "$(cat "$1")" = reviewed-n8n-identities
}
capture_firewall_boundary() {
  destination=$1
  printf 'reviewed-firewall\n' > "$destination"
}
sha256sum() {
  if test "${1:-}" = -c; then
    test -s "$2"
    return 0
  fi
  printf 'reviewed-sha256  %s\n' "$1"
}

capture_profile_release_state "$temporary/before"
for evidence in \
  before.worktree.status \
  before.worktree.diff \
  before.n8n-containers \
  before.firewall \
  before.nginx.sha256 \
  before.squid.sha256
do
  test -s "$temporary/$evidence" || {
    echo "state capture used an incorrect nested path: $evidence" >&2
    exit 1
  }
done

assert_profile_release_state_unchanged "$temporary/before"
echo 'PASS: nested state-capture helpers preserve the caller evidence prefix.'
