#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
"$SCRIPT_DIR/preflight.sh"

evidence="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
rollback_image="tanaghom-dashboard-canary:rollback-$TANAGHOM_RELEASE_ID"
committed=false
migrated=false
image_saved=false
test ! -e "$evidence" || die 'release evidence directory already exists'
install -d -o root -g root -m 0700 "$evidence"
capture_n8n_ids "$evidence/n8n-ids.before"
sha256sum /etc/nginx/conf.d/tanaghom-public.conf > "$evidence/nginx.before.sha256"
iptables-save | sha256sum | awk '{print $1}' > "$evidence/firewall.before.sha256"
sha256sum "$PRODUCTION_ROOT/packages/database/migrations/$TARGET_MIGRATION.up.sql" > "$evidence/migration-up.sha256"
sha256sum "$PRODUCTION_ROOT/packages/database/migrations/$TARGET_MIGRATION.down.sql" > "$evidence/migration-down.sha256"
chmod 0600 "$evidence"/*

automatic_rollback() {
  test "$committed" = false || return 0
  set +e
  failed=0
  if test "$image_saved" = true; then
    docker image tag "$rollback_image" tanaghom-dashboard-canary:canary || failed=1
    compose up -d --no-deps --force-recreate --no-build dashboard || failed=1
  fi
  if test "$migrated" = true; then
    db_file "$PRODUCTION_ROOT/packages/database/migrations/$TARGET_MIGRATION.down.sql" || failed=1
  fi
  if test "$failed" -ne 0; then
    echo 'ROLLBACK_FAILED=YES' > "$evidence/ROLLBACK_FAILED"
    echo 'ERROR: automatic rollback was incomplete; preserve evidence and keep safety controls locked.' >&2
  fi
}
trap automatic_rollback EXIT
trap 'exit 70' HUP INT TERM

docker image tag tanaghom-dashboard-canary:canary "$rollback_image"
image_saved=true
db_file "$PRODUCTION_ROOT/packages/database/migrations/$TARGET_MIGRATION.up.sql"
migrated=true
compose build --pull dashboard
compose up -d --no-deps dashboard
attempt=0
until test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 36 || die 'dashboard health timeout'
  sleep 5
done
"$SCRIPT_DIR/validate-release.sh"
date -u +%Y-%m-%dT%H:%M:%SZ > "$evidence/COMMITTED_AT"
chmod 0600 "$evidence/COMMITTED_AT"
committed=true
trap - EXIT HUP INT TERM
echo "PASS: Phase 7C Agent Studio update committed. Evidence: $evidence"
