#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase7f-runtime-profile-production-update"
for file in \
  RUNBOOK.md scripts/common.sh scripts/preflight.sh scripts/deploy-update.sh \
  scripts/rollback-update.sh scripts/test-disposable-lifecycle.sh \
  scripts/test-state-capture.sh scripts/validate-package.sh
do
  test -s "$package/$file" || {
    echo "missing package file: $file" >&2
    exit 1
  }
done

sh -n "$package"/scripts/*.sh
"$package/scripts/test-state-capture.sh"
grep -q '0032_gemma_served_model_profile' "$package/scripts/common.sh"
grep -q 'GO-INSTALL-IMMUTABLE-GEMMA-PROFILE' "$package/scripts/common.sh"
grep -q 'ROLLBACK-UNUSED-GEMMA-PROFILE' "$package/scripts/rollback-update.sh"
grep -q 'db_file "\$MIGRATION_UP"' "$package/scripts/deploy-update.sh"
grep -q 'db_file "\$MIGRATION_DOWN"' "$package/scripts/rollback-update.sh"
grep -q 'assert_profile_release_state_unchanged' \
  "$package/scripts/deploy-update.sh"
if grep -R -E --exclude=validate-package.sh \
  'compose (build|up|down)|docker (stop|restart|rm)|systemctl (stop|restart|reload)|n8n (import|publish|unpublish)' \
  "$package/scripts"
then
  echo 'database-only package contains a service, workflow or image mutation' >&2
  exit 1
fi
if grep -R -E --exclude=validate-package.sh \
  'iptables (-A|-I|-D|-N|-F|-X)|nft ' "$package/scripts"
then
  echo 'database-only package contains a firewall mutation' >&2
  exit 1
fi
if grep -R -E --exclude=validate-package.sh \
  'Bearer[[:space:]]+[A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@' \
  "$package"
then
  echo 'secret-shaped content found in runtime-profile package' >&2
  exit 1
fi

echo 'PASS: runtime-profile package is syntax-valid, secret-free, database-only, transactional and independently reversible before use.'
