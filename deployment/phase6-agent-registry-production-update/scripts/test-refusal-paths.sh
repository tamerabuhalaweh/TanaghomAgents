#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CURRENT=1111111111111111111111111111111111111111
TARGET=2222222222222222222222222222222222222222
RELEASE=phase6-20260719T120000Z
workdir=$(mktemp -d)
proof="$workdir/backup-proof.env"

cleanup() {
  rm -rf -- "$workdir"
}
trap cleanup EXIT HUP INT TERM

expect_refusal() {
  if "$@" >/dev/null 2>&1; then
    echo 'expected refusal unexpectedly succeeded' >&2
    exit 1
  fi
}

expect_refusal env \
  TANAGHOM_RELEASE_ID="$RELEASE" \
  TANAGHOM_EXPECTED_CURRENT_COMMIT="$CURRENT" \
  TANAGHOM_TARGET_COMMIT="$TARGET" \
  TANAGHOM_BACKUP_PROOF="$proof" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment"

expect_refusal env \
  TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER \
  TANAGHOM_RELEASE_ID=unsafe-release \
  TANAGHOM_EXPECTED_CURRENT_COMMIT="$CURRENT" \
  TANAGHOM_TARGET_COMMIT="$TARGET" \
  TANAGHOM_BACKUP_PROOF="$proof" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment"

expect_refusal env \
  TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER \
  TANAGHOM_RELEASE_ID="$RELEASE" \
  TANAGHOM_EXPECTED_CURRENT_COMMIT=1111111 \
  TANAGHOM_TARGET_COMMIT="$TARGET" \
  TANAGHOM_BACKUP_PROOF="$proof" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment"

cat > "$proof" <<EOF
RELEASE_ID=$RELEASE
SOURCE_MIGRATION=0014_supervised_conversation_ownership
ARCHIVE_SHA256=invalid
RESTORE_VERIFIED=NO
EOF
chmod 0600 "$proof"
expect_refusal env \
  TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER \
  TANAGHOM_RELEASE_ID="$RELEASE" \
  TANAGHOM_EXPECTED_CURRENT_COMMIT="$CURRENT" \
  TANAGHOM_TARGET_COMMIT="$TARGET" \
  TANAGHOM_BACKUP_PROOF="$proof" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment; validate_backup_proof"

printf 'RELEASE_ID=%s\r\nSOURCE_MIGRATION=0021_quality_baseline_shadow_pipeline\r\nARCHIVE_SHA256=0000000000000000000000000000000000000000000000000000000000000000\r\nRESTORE_VERIFIED=YES\r\n' "$RELEASE" > "$proof"
chmod 0600 "$proof"
env \
  TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER \
  TANAGHOM_RELEASE_ID="$RELEASE" \
  TANAGHOM_EXPECTED_CURRENT_COMMIT="$CURRENT" \
  TANAGHOM_TARGET_COMMIT="$TARGET" \
  TANAGHOM_BACKUP_PROOF="$proof" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment; validate_backup_proof"

echo 'PASS: invalid release inputs are refused and Windows CRLF backup proof is accepted.'
