#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
test -d "$RELEASE_SOURCE_ROOT/.git" || die 'reviewed release-source checkout is missing'
test -z "$(git -C "$RELEASE_SOURCE_ROOT" status --porcelain)" || die 'release-source checkout is dirty'
test "$(git -C "$RELEASE_SOURCE_ROOT" rev-parse HEAD)" = "$TANAGHOM_TARGET_COMMIT" ||
  die 'release-source checkout is not the authorized target'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_EXPECTED_CURRENT_COMMIT" ||
  die 'production checkout is not the reviewed current commit'
test -z "$(production_unexpected_changes)" || die 'production checkout has an unreviewed change'
test -f "$ALLOWED_PRODUCTION_FILE" || die 'reviewed Squid configuration is missing'
remote_target=$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" ls-remote origin refs/heads/main | awk '{print $1}')
test "$remote_target" = "$TANAGHOM_TARGET_COMMIT" || die 'target is not current remote main'
git -C "$RELEASE_SOURCE_ROOT" merge-base --is-ancestor "$TANAGHOM_EXPECTED_CURRENT_COMMIT" "$TANAGHOM_TARGET_COMMIT" ||
  die 'target is not a descendant of production'
test -z "$(git -C "$RELEASE_SOURCE_ROOT" diff --name-only "$TANAGHOM_EXPECTED_CURRENT_COMMIT..$TANAGHOM_TARGET_COMMIT" -- deployment/phase4-postiz-activation/egress/squid.conf)" ||
  die 'reviewed Squid configuration changed between commits'
test "$(df --output=avail -BG / | tail -1 | tr -dc '0-9')" -ge 15 || die 'less than 15 GiB is free'
test "$(db_scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = "$EXPECTED_MIGRATION" ||
  die 'database migration baseline changed'
assert_secret_metadata
assert_gateway_credential_metadata
assert_safety_locks
assert_no_reconciliation_blocker
assert_protected_n8n_healthy
test "$(container_health "$DASHBOARD_CONTAINER")" = healthy || die 'dashboard is unhealthy'
assert_dashboard_network_boundary
assert_current_runtime_locked
assert_source_target_contract
source_compose config --quiet
assert_public_boundary
validate_gateway_boundary
echo "PASS: provider-runtime preflight passed for $TANAGHOM_PROVIDER_RUNTIME_ID."
