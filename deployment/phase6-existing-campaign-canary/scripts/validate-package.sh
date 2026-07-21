#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase6-existing-campaign-canary"

for file in README.md RUNBOOK.md scripts/common.sh scripts/preflight.sh scripts/run-canary.sh scripts/resume-preflight.sh scripts/resume-after-strategy.sh scripts/restore-workflows.sh scripts/verify-human-approval.sh scripts/validate-package.sh scripts/test-refusal-paths.sh scripts/test-disposable-lifecycle.sh scripts/existing-campaign-operator.mjs; do
  test -s "$package/$file" || { echo "missing package file: $file" >&2; exit 1; }
done
sh -n "$package"/scripts/*.sh
node --check "$package/scripts/existing-campaign-operator.mjs"

grep -q 'operator verify-authorized' "$package/scripts/preflight.sh"
grep -q 'TANAGHOM_CANARY_CAMPAIGN_ID' "$package/scripts/common.sh"
grep -q 'TANAGHOM_CANARY_STRATEGY_JOB_ID' "$package/scripts/common.sh"
grep -q 'TANAGHOM_CANARY_ALLOW_OWNER_FUNCTION_CALL' "$package/scripts/common.sh"
grep -q 'SELECT \* FROM tanaghom.queue_campaign_content' "$package/scripts/existing-campaign-operator.mjs"
grep -q 'privileged governed-function invocation boundary' "$package/scripts/existing-campaign-operator.mjs"
grep -q "procedure.proowner = role.oid" "$package/scripts/existing-campaign-operator.mjs"
grep -q "has_function_privilege('tanaghom_n8n_worker'" "$package/scripts/existing-campaign-operator.mjs"
if grep -q 'SET LOCAL ROLE tanaghom_api' "$package/scripts/existing-campaign-operator.mjs"; then echo 'canary must not claim unavailable tanaghom_api membership' >&2; exit 1; fi
grep -q 'claimable_core_jobs !== 1' "$package/scripts/existing-campaign-operator.mjs"
grep -q 'operator verify-content-ready' "$package/scripts/run-canary.sh"
grep -q 'operator verify-resume-authorized' "$package/scripts/resume-preflight.sh"
grep -q 'RESUME_MODE=CONTENT_PRODUCER_ONLY' "$package/scripts/resume-after-strategy.sh"
grep -q 'strategist execution delta is not exactly one' "$package/scripts/run-canary.sh"
grep -q 'resume unexpectedly executed Campaign Strategist' "$package/scripts/resume-after-strategy.sh"
grep -q 'content_succeeded' "$package/scripts/existing-campaign-operator.mjs"
grep -q 'content.review_completed' "$package/scripts/existing-campaign-operator.mjs"
grep -q 'reconcile_campaign_content_jobs' "$package/scripts/test-disposable-lifecycle.sh"
grep -q 'publish_workflow "$STRATEGIST_ID"' "$package/scripts/run-canary.sh"
grep -q 'unpublish_workflow "$STRATEGIST_ID"' "$package/scripts/run-canary.sh"
grep -q 'publish_workflow "$PRODUCER_ID"' "$package/scripts/run-canary.sh"
grep -q 'unpublish_workflow "$PRODUCER_ID"' "$package/scripts/run-canary.sh"
grep -q 'existing campaign and jobs were deliberately preserved' "$package/scripts/run-canary.sh"
grep -q 'NODE_EXTRA_CA_CERTS="$DATABASE_CA_CERT"' "$package/scripts/common.sh"
grep -q 'TANAGHOM_DATABASE_SSL_MODE=verify-full' "$package/scripts/common.sh"
grep -q 'BEGIN READ ONLY' "$package/scripts/existing-campaign-operator.mjs"
grep -q 'cmp -s "$evidence/iptables.rules.before" "$evidence/iptables.rules.after"' "$package/scripts/run-canary.sh"
if grep -E 'operator (seed|mark-failed)|INSERT INTO tanaghom\.(campaigns|agent_jobs)' "$package/scripts/existing-campaign-operator.mjs" "$package/scripts/run-canary.sh" "$package/scripts/resume-after-strategy.sh"; then echo 'runtime package may not seed, fail, or directly insert campaign jobs' >&2; exit 1; fi
if grep -F '| tee' "$package/scripts/run-canary.sh" "$package/scripts/resume-after-strategy.sh" "$package/scripts/verify-human-approval.sh"; then echo 'a critical canary command exit can be masked by tee' >&2; exit 1; fi
if grep -R -E 'Bearer [A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@' --exclude=validate-package.sh "$package"; then echo 'possible secret found in canary package' >&2; exit 1; fi
if grep -R -E 'systemctl (stop|restart|reload)|iptables (-A|-I|-D|-N|-F|-X)|docker (stop|restart|rm)|docker compose' --exclude=validate-package.sh "$package/scripts"; then echo 'package contains forbidden infrastructure mutation' >&2; exit 1; fi
echo 'PASS: existing-campaign canary package is exact-ID, governed, restorable, provider-isolated, and secret-free.'
