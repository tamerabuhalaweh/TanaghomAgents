#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_release_environment
for command in git psql docker curl iptables systemctl sha256sum; do
  command -v "$command" >/dev/null 2>&1 ||
    die "required command is missing: $command"
done

assert_release_source
assert_production_checkout
test -s "$MIGRATION_UP" && test -s "$MIGRATION_DOWN" ||
  die 'reviewed 0032 migration pair is missing'
assert_profile_absent
assert_runtime_quiescent
assert_safety_locks
assert_running_gateway_locked
assert_protected_units_active
assert_protected_containers_healthy
assert_dashboard_network_boundary
assert_public_boundary
assert_firewall_boundary

echo 'PASS: production is ready for the database-only immutable Gemma served-model profile; no state was changed.'
