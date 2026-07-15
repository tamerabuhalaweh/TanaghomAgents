#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CURRENT=1111111111111111111111111111111111111111
TARGET=2222222222222222222222222222222222222222
RELEASE=phase5d-20260715T120000Z
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
SOURCE_MIGRATION=0008_customer_integrations
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

echo 'PASS: missing authorization, malformed release identity, short commit, and invalid backup proof are refused.'
