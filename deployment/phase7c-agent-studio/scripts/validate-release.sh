#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
evidence="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
test -s "$evidence/n8n-ids.before" || die 'protected n8n identity evidence is missing'
assert_agent_studio_target
assert_agent_studio_empty
assert_policy_locked
assert_n8n_ids_unchanged "$evidence/n8n-ids.before"
sha256sum -c "$evidence/nginx.before.sha256" >/dev/null ||
  die 'Nginx configuration changed'
current_firewall=$(mktemp)
trap 'rm -f "$current_firewall"' EXIT
capture_firewall_boundary "$current_firewall"
cmp -s "$evidence/firewall.before" "$current_firewall" ||
  die 'package-owned firewall state changed'
assert_firewall_boundary
rm -f "$current_firewall"
trap - EXIT
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy ||
  die 'dashboard is unhealthy'
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/settings/agents")" = 307 ||
  die 'Agent Studio page authentication boundary changed'
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/admin/agents")" = 401 ||
  die 'Agent Studio API authentication boundary changed'
health=$(curl -fsS --max-time 10 http://127.0.0.1:3200/api/health)
echo "$health" | grep -q '"database":"connected"' ||
  die 'dashboard database health failed'

echo 'PASS: Phase 7C Agent Studio release validation passed without provider, n8n, Gemma, firewall, or Nginx changes.'
