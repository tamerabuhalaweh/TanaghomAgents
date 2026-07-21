#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase6-content-job-reconciliation"

for file in README.md RUNBOOK.md scripts/common.sh scripts/reconcile-operator.mjs scripts/preflight.sh scripts/reconcile-job.sh scripts/test-refusal-paths.sh scripts/test-disposable-lifecycle.sh scripts/test-workflow-baseline.sh scripts/validate-package.sh; do
  test -s "$package/$file" || { echo "missing package file: $file" >&2; exit 1; }
done
sh -n "$package"/scripts/*.sh
node --check "$package/scripts/reconcile-operator.mjs"
"$package/scripts/test-refusal-paths.sh"
"$package/scripts/test-workflow-baseline.sh"

grep -q 'BEGIN ISOLATION LEVEL SERIALIZABLE' "$package/scripts/reconcile-operator.mjs"
grep -q "WITH SET TRUE'" "$package/scripts/reconcile-operator.mjs"
grep -q "REVOKE tanaghom_n8n_worker FROM %I GRANTED BY CURRENT_USER'" "$package/scripts/reconcile-operator.mjs"
grep -q 'SET LOCAL ROLE tanaghom_n8n_worker' "$package/scripts/reconcile-operator.mjs"
grep -q 'SELECT tanaghom.complete_content_job' "$package/scripts/reconcile-operator.mjs"
grep -q 'RESET ROLE' "$package/scripts/reconcile-operator.mjs"
grep -q 'worker_has_approval_table_access' "$package/scripts/reconcile-operator.mjs"
grep -q 'matching_active_human_decisions !== 1' "$package/scripts/reconcile-operator.mjs"
grep -q 'YES-COMPLETE-THE-REVIEWED-CONTENT-JOB' "$package/scripts/reconcile-job.sh"
test "$(grep -c 'operator reconcile' "$package/scripts/reconcile-job.sh")" = 1
test "$(grep -c 'compare-others' "$package/scripts/reconcile-job.sh")" = 1
if grep -q 'compare-others' "$package/scripts/preflight.sh"; then
  echo 'read-only preflight incorrectly compares against a historical full-workflow inventory' >&2; exit 1
fi
grep -Fq 'compare-others "$evidence/workflows.before.json" "$evidence/workflows.after.json"' "$package/scripts/reconcile-job.sh"
if grep -Fq '$CANARY_EVIDENCE/workflows.before.json' "$package/scripts/preflight.sh" "$package/scripts/reconcile-job.sh"; then
  echo 'runtime package incorrectly treats historical canary inventory as a permanent allowlist' >&2; exit 1
fi
test "$(grep -c "WITH SET TRUE'" "$package/scripts/reconcile-operator.mjs")" = 1
test "$(grep -c "REVOKE tanaghom_n8n_worker FROM %I GRANTED BY CURRENT_USER'" "$package/scripts/reconcile-operator.mjs")" = 1
grep -q 'RECONCILIATION_SUCCEEDED_AT=' "$package/scripts/reconcile-job.sh"
grep -q 'There is intentionally no command' "$package/RUNBOOK.md"
grep -q 'Preparation and merge do not authorize' "$package/README.md"

if grep -E 'client\.query\([`"](INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)' "$package/scripts/reconcile-operator.mjs"; then
  echo 'operator contains a direct database mutation' >&2; exit 1
fi
runtime_scope="$package/scripts/common.sh $package/scripts/preflight.sh $package/scripts/reconcile-job.sh $package/scripts/reconcile-operator.mjs"
if grep -E 'n8n (import|execute|publish|unpublish)|publish_workflow|execute_workflow' $runtime_scope; then
  echo 'runtime package can modify or execute a workflow' >&2; exit 1
fi
if grep -E 'export:credentials|--decrypted' $runtime_scope; then
  echo 'runtime package can expose an encrypted n8n credential' >&2; exit 1
fi
if grep -E 'systemctl (stop|restart|reload)|docker (stop|restart|rm)|docker compose|iptables (-A|-I|-D|-N|-F|-X)|nft ' $runtime_scope; then
  echo 'runtime package can modify protected services, containers, or firewall state' >&2; exit 1
fi
if grep -E 'api\.postiz|services\.leadconnectorhq|Authorization:|Bearer ' $runtime_scope; then
  echo 'runtime package contains a provider call or credential shape' >&2; exit 1
fi
if grep -R -E 'Bearer [A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@' --exclude=validate-package.sh --exclude=test-disposable-lifecycle.sh "$package"; then
  echo 'possible secret found in reconciliation package' >&2; exit 1
fi
echo 'PASS: content-job reconciliation package is least-privileged, idempotent, evidence-backed, and provider-isolated.'
