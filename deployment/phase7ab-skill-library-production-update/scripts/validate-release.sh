#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
evidence="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
test -d "$evidence" || die 'release evidence directory is missing'
test -s "$evidence/n8n-container-ids.before" ||
  die 'protected n8n identity evidence is missing'

test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_TARGET_COMMIT" ||
  die 'production source is not the authorized target'
test -z "$(production_unexpected_changes)" ||
  die 'production checkout contains an unreviewed change after update'
assert_skill_library_target
assert_policy_locked
assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence/n8n-container-ids.before"

current_firewall=$(mktemp)
capture_firewall_boundary "$current_firewall"
cmp -s "$evidence/firewall.before" "$current_firewall" ||
  die 'package-owned firewall state changed'
rm -f "$current_firewall"
sha256sum -c "$evidence/nginx.before.sha256" >/dev/null ||
  die 'Nginx configuration changed'
sha256sum -c "$evidence/squid.before.sha256" >/dev/null ||
  die 'the tolerated Squid configuration changed'

test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy ||
  die 'dashboard is unhealthy'
assert_firewall_boundary
assert_public_target_boundary
health=$(curl -fsS --max-time 10 http://127.0.0.1:3200/api/health)
echo "$health" | grep -q '"database":"connected"' ||
  die 'dashboard database health failed'

echo 'PASS: Phase 7A+7B release validation passed with exact Skill registries and unchanged protected boundaries.'
