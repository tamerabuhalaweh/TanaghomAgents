#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
assert_release_source
assert_production_checkout

test "$(df --output=avail -BG / | tail -1 | tr -dc '0-9')" -ge 15 ||
  die 'less than 15 GiB is free'
test -f "$ALLOWED_PRODUCTION_FILE" ||
  die 'reviewed operational Squid configuration is missing'

assert_database_at_start
assert_secret_metadata
assert_package_workflows_absent
assert_package_credentials_absent
assert_login_roles_absent
assert_shared_credentials
validate_workflow_sources

docker info >/dev/null
compose config --quiet
assert_target_compose_locked
test "$(docker exec "$N8N_MAIN_CONTAINER" n8n --version)" = "$N8N_EXPECTED_VERSION" ||
  die 'n8n version changed'
assert_protected_units_active
assert_protected_containers_healthy
assert_dashboard_network_boundary
assert_firewall_boundary
assert_public_boundary

echo "PASS: locked Phase 7D production preflight passed for $TANAGHOM_RELEASE_ID."
