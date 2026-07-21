#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_environment
test "${TANAGHOM_HUMAN_APPROVAL_VERIFICATION:-}" = 'YES-VERIFY-AUTHENTICATED-HUMAN-APPROVAL' || die 'separate human-approval verification authorization is absent'
evidence=${1:-/var/backups/tanaghom-$TANAGHOM_CANARY_ID}
test -s "$evidence/canary.env" || die 'canary evidence is missing'
for expected in \
  "CAMPAIGN_ID=$TANAGHOM_CANARY_CAMPAIGN_ID" \
  "STRATEGY_JOB_ID=$TANAGHOM_CANARY_STRATEGY_JOB_ID" \
  "CAMPAIGN=$TANAGHOM_CANARY_CAMPAIGN" \
  "EXPECTED_CONTENT_ITEMS=$TANAGHOM_EXPECTED_CONTENT_ITEMS" \
  "PRODUCTION_COMMIT=$TANAGHOM_EXPECTED_PRODUCTION_COMMIT" \
  "SOURCE_COMMIT=$TANAGHOM_CANARY_SOURCE_COMMIT"; do
  grep -Fx "$expected" "$evidence/canary.env" >/dev/null || die "evidence mismatch: $expected"
done
grep -q '^READY_FOR_HUMAN_APPROVAL_AT=' "$evidence/canary.env" || die 'canary did not reach the human gate'
content_job_id=$(sed -n 's/^CONTENT_JOB_ID=//p' "$evidence/canary.env")
is_uuid "$content_job_id" || die 'content job evidence is missing or invalid'
assert_business_locks
assert_workflow_inactive "$STRATEGIST_ID"
assert_workflow_inactive "$PRODUCER_ID"
export_all_workflows "$evidence/workflows.human-approval-verification.json"
node "$WORKFLOW_CONTRACT" verify "$evidence/workflows.human-approval-verification.json" "$evidence/workflow-manifest.json" original
operator verify-approved "$TANAGHOM_CANARY_CAMPAIGN_ID" "$TANAGHOM_CANARY_STRATEGY_JOB_ID" "$TANAGHOM_CANARY_CAMPAIGN" "$TANAGHOM_EXPECTED_CONTENT_ITEMS" "$content_job_id" >"$evidence/human-approval.json"
cat "$evidence/human-approval.json"
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_jobs WHERE campaign_id='$TANAGHOM_CANARY_CAMPAIGN_ID' AND job_type IN ('content.postiz.draft','lead.ghl.contact_upsert','ghl.action.execute');")" = 0 || die 'a provider job was queued'
assert_protected_health
assert_public_boundary
assert_firewall_boundary
docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit >"$evidence/n8n-audit.after-human-approval.txt"
echo "HUMAN_APPROVAL_VERIFIED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$evidence/canary.env"
find "$evidence" -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >"$evidence/SHA256SUMS"
echo 'PASS: every generated draft has an authenticated active-human approval and no publishing or CRM action occurred.'
