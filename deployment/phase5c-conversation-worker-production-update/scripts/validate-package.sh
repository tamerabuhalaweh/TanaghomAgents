#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase5c-conversation-worker-production-update"

sh -n "$package"/scripts/*.sh
"$package/scripts/test-refusal-paths.sh"
test -s "$package/RUNBOOK.md"

for file in "$package"/scripts/*.sh; do
  ! grep -Eq 'docker (stop|restart|rm|compose .+ (stop|restart|rm)).*(smartlabs|gemma|voice|smartcc)' "$file"
  ! grep -Eq 'systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)' "$file"
  ! grep -Eq '(/opt/(smartlabs|n8n-smartlabs)|/data/)' "$file"
done

grep -q 'EXPECTED_START_MIGRATION=0023_campaign_lifecycle' "$package/scripts/common.sh"
grep -q 'TARGET_MIGRATION=0024_conversation_intelligence_worker_registry' "$package/scripts/common.sh"
grep -q 'RUNTIME_ROLE=tanaghom_conversation_runtime' "$package/scripts/common.sh"
grep -q 'CREDENTIAL_ID=62000000-0000-4000-8000-000000000005' "$package/scripts/common.sh"
grep -q 'import:credentials' "$package/scripts/deploy-update.sh"
grep -q 'chown node:node.*credential_remote' "$package/scripts/deploy-update.sh"
grep -q 'test -r.*credential_remote' "$package/scripts/deploy-update.sh"
grep -q 'import:workflow.*--activeState=false' "$package/scripts/deploy-update.sh"
grep -q 'openssl rand -hex 32' "$package/scripts/deploy-update.sh"
grep -q 'rm -f.*secret_file.*role_sql.*credential_json.*connection_env.*pgpass_file' "$package/scripts/deploy-update.sh"
grep -q 'runtime-authentication.txt' "$package/scripts/deploy-update.sh"
grep -q 'n8n audit' "$package/scripts/deploy-update.sh"
grep -q 'assert_existing_workflows_unchanged' "$package/scripts/deploy-update.sh"
grep -q 'assert_existing_credentials_unchanged' "$package/scripts/deploy-update.sh"
grep -q 'ROLLBACK_FAILED=YES' "$package/scripts/deploy-update.sh"
grep -q 'ROLLBACK-THE-AUTHORIZED-CONVERSATION-WORKER-RELEASE' "$package/scripts/rollback-update.sh"
grep -q '0024 rollback unexpectedly accepted an imported runtime' "$package/scripts/test-disposable-lifecycle.sh"
grep -q 'No deployment is authorized\|does \*\*not\*\* authorize' "$package/RUNBOOK.md"
if grep -RE --exclude=validate-package.sh 'Bearer[[:space:]]+[A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@' "$package"; then
  echo 'secret-shaped content found in the production package' >&2
  exit 1
fi

echo 'PASS: Conversation Intelligence production package is syntax-valid, secret-free, inactive, exact, reversible, and protected-service scoped.'
