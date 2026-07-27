#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase7f-agent-studio-certification"

for file in \
  README.md RUNBOOK.md \
  scripts/common.sh scripts/preflight-evidence-fix.sh \
  scripts/apply-evidence-fix.sh scripts/rollback-evidence-fix.sh \
  scripts/preflight.sh scripts/run-certification.sh \
  scripts/restore-locks.sh scripts/certification-operator.mjs \
  scripts/validate-package.sh
do
  test -s "$package/$file" || {
    echo "missing package file: $file" >&2
    exit 1
  }
done

sh -n "$package"/scripts/*.sh
node --check "$package/scripts/certification-operator.mjs"

grep -q 'GO-RUN-REMAINING-12-SIMULATION-CERTIFICATION' \
  "$package/scripts/common.sh"
grep -q '0033_agent_runtime_certification_evidence' \
  "$package/scripts/common.sh"
grep -q 'phase7f-certification-YYYYMMDDTHHMMSSZ' \
  "$package/scripts/common.sh"
grep -q 'operator check-database' "$package/scripts/common.sh"
grep -q '0032_gemma_served_model_profile' \
  "$package/scripts/preflight-evidence-fix.sh"
grep -q '0033_agent_runtime_certification_evidence.up.sql' \
  "$package/scripts/apply-evidence-fix.sh"
grep -q 'canonical_scenario_count=2' \
  "$package/scripts/apply-evidence-fix.sh"
grep -q 'GO-ROLLBACK-UNCERTIFIED-EVIDENCE-FIX' \
  "$package/scripts/rollback-evidence-fix.sh"
grep -q 'operator finalize-model-next' "$package/scripts/run-certification.sh"
grep -q 'operator run-direct-next' "$package/scripts/run-certification.sh"
grep -q 'operator certify' "$package/scripts/run-certification.sh"
grep -q 'operator verify' "$package/scripts/run-certification.sh"
grep -q 'operator quarantine' "$package/scripts/run-certification.sh"
grep -q 'trap cleanup EXIT HUP INT TERM' \
  "$package/scripts/run-certification.sh"
grep -q 'compare-all-operational' "$package/scripts/run-certification.sh"
grep -q 'n8n audit' "$package/scripts/run-certification.sh"
grep -q 'record_agent_runtime_certification_v2' \
  "$package/scripts/certification-operator.mjs"
grep -q 'runtime_emergency_stop' \
  "$package/scripts/certification-operator.mjs"
grep -q 'dependency_failure_recovered_without_duplicate_action' \
  "$package/scripts/certification-operator.mjs"
grep -q 'duplicate delivery created a second logical invocation' \
  "$package/scripts/certification-operator.mjs"
grep -q 'prompt_injection_granted_authority: false' \
  "$package/scripts/certification-operator.mjs"
grep -q 'other twelve mandatory' "$package/RUNBOOK.md"
grep -q 'Each row is executed once in English and once in Arabic' \
  "$package/RUNBOOK.md"

if grep -R -E --exclude=validate-package.sh \
  'systemctl (stop|restart|reload)|docker (stop|restart|rm)|docker compose' \
  "$package/scripts"
then
  echo 'full certification may not mutate protected services or containers' >&2
  exit 1
fi
if grep -R -E --exclude=validate-package.sh \
  'iptables (-A|-I|-D|-N|-F|-X)|nft ' "$package/scripts"
then
  echo 'full certification may not mutate the firewall' >&2
  exit 1
fi
if grep -R -E --exclude=validate-package.sh \
  'https://[^[:space:]"]*(postiz|gohighlevel|leadconnectorhq)' "$package"
then
  echo 'full certification contains a forbidden provider endpoint' >&2
  exit 1
fi
if grep -R -E --exclude=validate-package.sh \
  'Bearer[[:space:]]+[A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@' \
  "$package"
then
  echo 'secret-shaped content found in full-certification package' >&2
  exit 1
fi

echo 'PASS: the full-certification package is syntax-valid, secret-free, bilingual, fail-closed, resumable and provider-isolated.'
