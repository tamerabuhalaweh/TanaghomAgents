#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase6-uat-runtime-correction"

sh -n "$package"/scripts/*.sh
node "$root/scripts/validate-vllm-structured-output-schemas.mjs"
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
node "$package/scripts/prepare-runtime-workflows.mjs" "$root" "$temporary"
test "$(find "$temporary" -type f -name '*.json' | wc -l)" = 8
"$package/scripts/test-refusal-paths.sh"

grep -q 'CORRECT-REVIEWED-TANAGHOM-UAT-RUNTIME' "$package/scripts/common.sh"
grep -q 'SAFE-ROLLBACK-TANAGHOM-UAT-RUNTIME-CORRECTION' "$package/scripts/rollback-correction.sh"
grep -q 'assert_all_schedules_enabled' "$package/scripts/deploy-correction.sh"
grep -q 'assert_no_tanaghom_activation_errors_since' "$package/scripts/validate-release.sh"
grep -q 'assert_business_locks' "$package/scripts/preflight.sh"
grep -q 'assert_zero_provider_activity' "$package/scripts/preflight.sh"
grep -q 'assert_bilingual_jobs_quarantined' "$package/scripts/preflight.sh"
grep -q 'n8n audit' "$package/scripts/deploy-correction.sh"
grep -q 'tanaghom-\$TANAGHOM_UAT_CORRECTION_ID-\$id-before.json' "$package/scripts/common.sh"
grep -q 'tanaghom-\$TANAGHOM_UAT_CORRECTION_ID-\$label-restore.json' "$package/scripts/common.sh"

runtime_scripts="$package/scripts/common.sh $package/scripts/preflight.sh $package/scripts/deploy-correction.sh $package/scripts/validate-release.sh $package/scripts/rollback-correction.sh"
if grep -E 'iptables|nft|nginx|systemctl|/opt/(smartlabs|smartcc)|/data/' $runtime_scripts; then
  echo 'forbidden protected-system mutation found in runtime scripts' >&2
  exit 1
fi
if grep -E 'docker (stop|rm|kill|compose)' $runtime_scripts; then
  echo 'forbidden container mutation found in runtime scripts' >&2
  exit 1
fi
if grep -RE --exclude=validate-package.sh \
  'Bearer[[:space:]]+[A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@|sb_secret_[A-Za-z0-9_-]+' \
  "$package"; then
  echo 'secret-shaped content found in runtime correction package' >&2
  exit 1
fi

echo 'PASS: UAT runtime correction is syntax-valid, secret-free, Tanaghom-only, policy-gated, and safely reversible.'
