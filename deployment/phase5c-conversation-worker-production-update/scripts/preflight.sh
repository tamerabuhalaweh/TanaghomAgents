#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment

test -d "$RELEASE_SOURCE_ROOT/.git" || die 'reviewed release-source checkout is missing'
test -z "$(git -C "$RELEASE_SOURCE_ROOT" status --porcelain)" || die 'release-source checkout is dirty'
test "$(git -C "$RELEASE_SOURCE_ROOT" rev-parse HEAD)" = "$TANAGHOM_TARGET_COMMIT" || die 'release-source checkout is not the authorized target'
test -d "$PRODUCTION_ROOT/.git" || die 'production Git checkout is missing'
assert_production_worktree_reviewed
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_EXPECTED_CURRENT_COMMIT" || die 'production commit does not match the reviewed current commit'
remote_target=$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" ls-remote origin refs/heads/main | awk '{print $1}')
test "$remote_target" = "$TANAGHOM_TARGET_COMMIT" || die 'target commit is not current remote main'

available_gib=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
test "$available_gib" -ge 15 || die 'less than 15 GiB is available on the root filesystem'
test -s /var/lib/tanaghom-public/deployed || die 'public deployment marker is missing'
assert_secret_metadata
docker info >/dev/null
compose config --quiet
assert_protected_units_active
assert_protected_containers_healthy
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy || die 'dashboard container is not healthy'
assert_firewall_boundary
assert_database_at_start
assert_public_boundary
validate_workflow_source
test "$(docker exec -u node "$N8N_MAIN_CONTAINER" n8n --version)" = "$N8N_EXPECTED_VERSION" || die 'n8n version differs from the reviewed runtime'
docker exec "$N8N_DATABASE_CONTAINER" sh -c 'test -n "$POSTGRES_USER" && test -n "$POSTGRES_DB"' || die 'n8n database metadata is unavailable'
test "$(n8n_db_scalar "SELECT count(*) FROM credentials_entity WHERE id='62000000-0000-4000-8000-000000000002' AND type='httpHeaderAuth';")" = 1 || die 'reviewed Gemma credential is unavailable'
assert_credential_absent
assert_workflow_absent

echo "PASS: Conversation Intelligence production preflight passed for $TANAGHOM_RELEASE_ID."
