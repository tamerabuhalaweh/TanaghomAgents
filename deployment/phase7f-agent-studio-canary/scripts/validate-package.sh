#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase7f-agent-studio-canary"

for file in \
  README.md RUNBOOK.md \
  scripts/common.sh scripts/preflight.sh scripts/run-canary.sh \
  scripts/restore-locks.sh scripts/canary-operator.mjs \
  scripts/workflow-contract.mjs scripts/test-refusal-paths.sh \
  scripts/test-disposable-lifecycle.sh scripts/test-quarantine-lifecycle.mjs \
  scripts/validate-package.sh
do
  test -s "$package/$file" || {
    echo "missing package file: $file" >&2
    exit 1
  }
done

sh -n "$package"/scripts/*.sh
node --check "$package/scripts/canary-operator.mjs"
node --check "$package/scripts/workflow-contract.mjs"
node --check "$package/scripts/test-quarantine-lifecycle.mjs"
"$package/scripts/test-refusal-paths.sh"

grep -q "EXPECTED_MIGRATION=0032_gemma_served_model_profile" \
  "$package/scripts/common.sh"
grep -q "GO-RUN-SIMULATION-ONLY-AGENT-CANARY" \
  "$package/scripts/common.sh"
grep -q 'n8n execute --id="\$RUNNER_ID"' "$package/scripts/common.sh"
grep -q 'assert_canary_credential_bindings' "$package/scripts/common.sh"
grep -q 'resolved-by-reviewed-name-and-type' \
  "$package/scripts/workflow-contract.mjs"
grep -q 'operator unlock' "$package/scripts/run-canary.sh"
grep -q 'operator lock "\$reason"' "$package/scripts/run-canary.sh"
grep -q 'operator finalize-next' "$package/scripts/run-canary.sh"
grep -q 'operator quarantine "\$reason"' "$package/scripts/run-canary.sh"
grep -q 'n8n audit' "$package/scripts/run-canary.sh"
grep -q 'trap cleanup EXIT HUP INT TERM' "$package/scripts/run-canary.sh"
grep -q 'simulation_only=false' "$package/scripts/canary-operator.mjs"
test "$(grep -Fc '$1::text' "$package/scripts/canary-operator.mjs")" -ge 2
grep -q 'provider_dispatch_id IS NOT NULL' "$package/scripts/canary-operator.mjs"
grep -q 'organization_agent_runtime_certifications' \
  "$package/scripts/canary-operator.mjs"
grep -q 'one English and one Arabic' "$package/RUNBOOK.md"
grep -q 'other twelve mandatory adversarial' "$package/RUNBOOK.md"

if grep -R -E --exclude=validate-package.sh \
  'n8n (publish|unpublish):workflow|systemctl (stop|restart|reload)|docker (stop|restart|rm)|docker compose' \
  "$package/scripts"
then
  echo 'the Phase 7F canary may not activate workflows or mutate protected services' >&2
  exit 1
fi
if grep -R -E --exclude=validate-package.sh \
  'iptables (-A|-I|-D|-N|-F|-X)|nft ' "$package/scripts"
then
  echo 'the Phase 7F canary may not mutate the firewall' >&2
  exit 1
fi
if grep -R -E --exclude=validate-package.sh \
  'https://[^[:space:]"]*(postiz|gohighlevel|leadconnectorhq)' "$package"
then
  echo 'the Phase 7F canary contains a forbidden provider endpoint' >&2
  exit 1
fi
if grep -R -E --exclude=validate-package.sh \
  'Bearer[[:space:]]+[A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@' \
  "$package"
then
  echo 'secret-shaped content found in the Phase 7F canary package' >&2
  exit 1
fi

echo 'PASS: the Phase 7F canary package is syntax-valid, secret-free, inactive, bilingual, fail-closed and provider-isolated.'
