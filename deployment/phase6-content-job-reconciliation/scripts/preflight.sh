#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_environment
for command in docker git node psql curl iptables systemctl sha256sum openssl; do
  command -v "$command" >/dev/null 2>&1 || die "required command is missing: $command"
done
test "$(git -C "$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_EXPECTED_PRODUCTION_COMMIT" || die 'production dashboard commit differs from the approved baseline'
test "$(git -C "$RELEASE_SOURCE_ROOT" rev-parse HEAD)" = "$TANAGHOM_RECONCILIATION_SOURCE_COMMIT" || die 'reconciliation package checkout differs from the approved source commit'
test -z "$(git -C "$RELEASE_SOURCE_ROOT" status --porcelain --untracked-files=no)" || die 'reconciliation package checkout has tracked modifications'
test "$(docker exec -u node "$N8N_MAIN_CONTAINER" n8n --version)" = "$N8N_EXPECTED_VERSION" || die 'unexpected n8n version'
test -s "$DATABASE_CA_CERT" || die 'reviewed database CA certificate is missing'
openssl x509 -in "$DATABASE_CA_CERT" -noout >/dev/null 2>&1 || die 'reviewed database CA certificate is invalid'

assert_canary_evidence
assert_business_locks
assert_protected_health
assert_public_boundary
assert_firewall_boundary
assert_workflow_inactive "$STRATEGIST_ID"
assert_workflow_inactive "$PRODUCER_ID"

temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
operator preflight >"$temporary/job-preflight.json"
export_all_workflows "$temporary/workflows.json"
node "$CORE_CANARY_PACKAGE/scripts/workflow-contract.mjs" verify "$temporary/workflows.json" "$CANARY_EVIDENCE/workflow-manifest.json" original
cat "$temporary/job-preflight.json"
echo 'PASS: the reviewed content job is ready for least-privilege reconciliation; no state was changed.'
