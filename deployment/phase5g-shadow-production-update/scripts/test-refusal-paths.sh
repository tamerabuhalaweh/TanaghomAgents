#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CURRENT=1111111111111111111111111111111111111111
TARGET=2222222222222222222222222222222222222222
RELEASE=phase5g-20260717T120000Z
workdir=$(mktemp -d)
proof="$workdir/backup-proof.env"
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

echo 'PASS: invalid shadow-release inputs are refused and Windows CRLF migration-0020 proof is accepted.'
