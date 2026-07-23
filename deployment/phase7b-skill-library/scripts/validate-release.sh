#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
evidence="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
test -s "$evidence/n8n-ids.before" || die 'protected n8n identity evidence is missing'
assert_skill_library_target
assert_policy_locked
test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_skill_definitions;")" = 0 ||
  die 'unexpected customer Skill Library data appeared during deployment'
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_skill_bindings WHERE organization_id IS NOT NULL;")" = 0 ||
  die 'an organization agent binding changed during deployment'
assert_n8n_ids_unchanged "$evidence/n8n-ids.before"
sha256sum -c "$evidence/nginx.before.sha256" >/dev/null || die 'Nginx configuration changed'
test "$(iptables-save | sha256sum | awk '{print $1}')" = "$(cat "$evidence/firewall.before.sha256")" ||
  die 'firewall state changed'
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy || die 'dashboard is unhealthy'
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/settings/skills")" = 307 ||
  die 'Skill Library page authentication boundary changed'
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/admin/skills")" = 401 ||
  die 'Skill Library API authentication boundary changed'
health=$(curl -fsS --max-time 10 http://127.0.0.1:3200/api/health)
echo "$health" | grep -q '"database":"connected"' || die 'dashboard database health failed'

echo 'PASS: Phase 7B Skill Library release validation passed without agent, provider, n8n, firewall, or Nginx changes.'
