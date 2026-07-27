#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_canary_environment
for command in docker git jq node psql curl iptables systemctl sha256sum openssl; do
  command -v "$command" >/dev/null 2>&1 ||
    die "required command is missing: $command"
done

test -d "$RELEASE_SOURCE_ROOT/.git" ||
  die 'reviewed Phase 7F release-source checkout is missing'
test "$(git -C "$RELEASE_SOURCE_ROOT" rev-parse HEAD)" = \
  "$TANAGHOM_PHASE7F_SOURCE_COMMIT" ||
  die 'release-source checkout is not at the authorized Phase 7F commit'
test -z "$(git -C "$RELEASE_SOURCE_ROOT" status --porcelain)" ||
  die 'release-source checkout is dirty'
test "$(
  git -C "$RELEASE_SOURCE_ROOT" ls-remote origin refs/heads/main | awk '{print $1}'
)" = "$TANAGHOM_PHASE7F_SOURCE_COMMIT" ||
  die 'authorized Phase 7F source is not current remote main'

test -d "$PRODUCTION_ROOT/.git" || die 'Tanaghom production checkout is missing'
test "$(
  git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD
)" = "$TANAGHOM_EXPECTED_PRODUCTION_COMMIT" ||
  die 'production checkout differs from the approved baseline'
test -z "$(production_unexpected_changes)" ||
  die 'production checkout contains an unreviewed change'
git -C "$RELEASE_SOURCE_ROOT" merge-base --is-ancestor \
  "$TANAGHOM_EXPECTED_PRODUCTION_COMMIT" "$TANAGHOM_PHASE7F_SOURCE_COMMIT" ||
  die 'Phase 7F source is not a descendant of deployed production'

test "$(docker exec -u node "$N8N_MAIN_CONTAINER" n8n --version)" = \
  "$N8N_EXPECTED_VERSION" || die 'unexpected n8n version'
test -s "$DATABASE_CA_CERT" || die 'reviewed database CA certificate is missing'
openssl x509 -in "$DATABASE_CA_CERT" -noout >/dev/null 2>&1 ||
  die 'reviewed database CA certificate is invalid'

assert_phase7f_baseline
operator check-database >/dev/null
assert_protected_units_active
assert_protected_containers_healthy
assert_dashboard_network_boundary
assert_public_boundary
assert_firewall_boundary

temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
export_all_workflows "$temporary/workflows.json"
node "$SCRIPT_DIR/workflow-contract.mjs" prepare-transition \
  "$temporary/workflows.json" \
  "$RELEASE_SOURCE_ROOT/n8n/workflows/phase7d" \
  "$temporary" >/dev/null

echo 'PASS: production is ready for the transactional dispatcher correction and two-execution English/Arabic Agent Studio canary; no state was changed.'
