#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment

test -d "$RELEASE_SOURCE_ROOT/.git" || die 'reviewed release-source checkout is missing'
test -z "$(git -C "$RELEASE_SOURCE_ROOT" status --porcelain)" ||
  die 'release-source checkout is dirty'
test "$(git -C "$RELEASE_SOURCE_ROOT" rev-parse HEAD)" = "$TANAGHOM_TARGET_COMMIT" ||
  die 'release-source checkout is not the authorized target'

test -d "$PRODUCTION_ROOT/.git" || die 'Tanaghom production checkout is missing'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_EXPECTED_CURRENT_COMMIT" ||
  die 'production checkout is not the reviewed current commit'
test -z "$(production_unexpected_changes)" ||
  die 'production checkout contains an unreviewed change'
test -f "$ALLOWED_PRODUCTION_FILE" || die 'the reviewed Squid configuration file is missing'

remote_target=$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" ls-remote origin refs/heads/main | awk '{print $1}')
test "$remote_target" = "$TANAGHOM_TARGET_COMMIT" ||
  die 'target commit is not the current remote main commit'
git -C "$RELEASE_SOURCE_ROOT" merge-base --is-ancestor "$TANAGHOM_EXPECTED_CURRENT_COMMIT" "$TANAGHOM_TARGET_COMMIT" ||
  die 'target commit is not a descendant of the production commit'
test -z "$(git -C "$RELEASE_SOURCE_ROOT" diff --name-only "$TANAGHOM_EXPECTED_CURRENT_COMMIT..$TANAGHOM_TARGET_COMMIT" -- deployment/phase4-postiz-activation/egress/squid.conf)" ||
  die 'the tolerated production Squid file changed between reviewed commits'

test "$(df --output=avail -BG / | tail -1 | tr -dc '0-9')" -ge 20 ||
  die 'less than 20 GiB is free'
assert_database_at_start
assert_secret_metadata
docker info >/dev/null
compose config --quiet
assert_protected_units_active
assert_protected_containers_healthy
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy ||
  die 'Tanaghom dashboard is unhealthy'
assert_firewall_boundary
assert_public_preupdate_boundary

echo "PASS: Phase 7A+7B read-only preflight passed for $TANAGHOM_RELEASE_ID."
