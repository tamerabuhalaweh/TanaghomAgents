#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CURRENT=1111111111111111111111111111111111111111
TARGET=2222222222222222222222222222222222222222
RELEASE=phase5g-20260717T120000Z
workdir=$(mktemp -d)
proof="$workdir/backup-proof.env"
deploy="$SCRIPT_DIR/deploy-update.sh"
trap 'rm -rf -- "$workdir"' EXIT HUP INT TERM

expect_refusal() {
  if "$@" >/dev/null 2>&1; then echo 'expected refusal unexpectedly succeeded' >&2; exit 1; fi
}

expect_refusal env TANAGHOM_SHADOW_COMMON_DIR="$SCRIPT_DIR" TANAGHOM_RELEASE_ID="$RELEASE" TANAGHOM_EXPECTED_CURRENT_COMMIT="$CURRENT" \
  TANAGHOM_TARGET_COMMIT="$TARGET" TANAGHOM_BACKUP_PROOF="$proof" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment"

expect_refusal env TANAGHOM_SHADOW_COMMON_DIR="$SCRIPT_DIR" TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER \
  TANAGHOM_RELEASE_ID=unsafe-release TANAGHOM_EXPECTED_CURRENT_COMMIT="$CURRENT" \
  TANAGHOM_TARGET_COMMIT="$TARGET" TANAGHOM_BACKUP_PROOF="$proof" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment"

cat > "$proof" <<EOF
RELEASE_ID=$RELEASE
SOURCE_MIGRATION=0019_notification_monitoring_destinations
ARCHIVE_SHA256=invalid
RESTORE_VERIFIED=NO
EOF
chmod 0600 "$proof"
expect_refusal env TANAGHOM_SHADOW_COMMON_DIR="$SCRIPT_DIR" TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER \
  TANAGHOM_RELEASE_ID="$RELEASE" TANAGHOM_EXPECTED_CURRENT_COMMIT="$CURRENT" \
  TANAGHOM_TARGET_COMMIT="$TARGET" TANAGHOM_BACKUP_PROOF="$proof" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment; validate_backup_proof"

printf 'RELEASE_ID=%s\r\nSOURCE_MIGRATION=0020_quality_rollout_control\r\nARCHIVE_SHA256=0000000000000000000000000000000000000000000000000000000000000000\r\nRESTORE_VERIFIED=YES\r\n' "$RELEASE" > "$proof"
chmod 0600 "$proof"
env TANAGHOM_SHADOW_COMMON_DIR="$SCRIPT_DIR" TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER \
  TANAGHOM_RELEASE_ID="$RELEASE" TANAGHOM_EXPECTED_CURRENT_COMMIT="$CURRENT" \
  TANAGHOM_TARGET_COMMIT="$TARGET" TANAGHOM_BACKUP_PROOF="$proof" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment; validate_backup_proof"

grep -q 'docker exec -u node.*rm -f.*workflow_remote' "$deploy"
grep -q 'rollback_cleanup_failed=1' "$deploy"
grep -q 'ROLLBACK_CLEANUP_FAILED=YES' "$deploy"
! grep -q 'rm -f.*workflow_remote.*rollback_failed=1' "$deploy"
grep -q 'if test "$rollback_failed" -eq 0; then rollback_applied_migrations' "$deploy"

echo 'PASS: invalid inputs are refused, Windows backup proof is accepted, and temporary cleanup cannot suppress critical rollback.'
