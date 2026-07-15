#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
validate_backup_proof

test -d "$RELEASE_SOURCE_ROOT/.git" || die 'reviewed release-source checkout is missing'
test -z "$(git -C "$RELEASE_SOURCE_ROOT" status --porcelain)" || die 'release-source checkout is dirty'
test "$(git -C "$RELEASE_SOURCE_ROOT" rev-parse HEAD)" = "$TANAGHOM_TARGET_COMMIT" || die 'release-source checkout is not the authorized target'
test -d "$PRODUCTION_ROOT/.git" || die 'production Git checkout is missing'
test -z "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" status --porcelain)" || die 'production checkout is dirty'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_EXPECTED_CURRENT_COMMIT" || die 'production commit does not match the reviewed current commit'
remote_target=$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" ls-remote origin refs/heads/main | awk '{print $1}')
test "$remote_target" = "$TANAGHOM_TARGET_COMMIT" || die 'target commit is not the current remote main commit'

available_gib=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
test "$available_gib" -ge 20 || die 'less than 20 GiB is available on the root filesystem'
test -s /var/lib/tanaghom-public/deployed || die 'public deployment marker is missing'

assert_secret_metadata
docker info >/dev/null
compose config --quiet
assert_protected_units_active
assert_protected_containers_healthy
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy || die 'dashboard container is not healthy'
assert_firewall_boundary
assert_database_locked "$EXPECTED_START_MIGRATION"
assert_public_boundary

echo "PASS: Phase 5D production update preflight passed for $TANAGHOM_RELEASE_ID."
