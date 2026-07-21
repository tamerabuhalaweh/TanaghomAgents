#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CURRENT=1111111111111111111111111111111111111111
TARGET=2222222222222222222222222222222222222222
PRESERVED=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
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
  TANAGHOM_PRESERVED_FILE_SHA256="$PRESERVED" \
  TANAGHOM_BACKUP_PROOF="$proof" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment"

expect_refusal env \
  TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER \
  TANAGHOM_RELEASE_ID="$RELEASE" \
  TANAGHOM_EXPECTED_CURRENT_COMMIT="$CURRENT" \
  TANAGHOM_TARGET_COMMIT="$TARGET" \
  TANAGHOM_PRESERVED_FILE_SHA256=invalid \
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
  TANAGHOM_PRESERVED_FILE_SHA256="$PRESERVED" \
  TANAGHOM_BACKUP_PROOF="$proof" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment; validate_backup_proof"

printf 'RELEASE_ID=%s\r\nSOURCE_MIGRATION=0022_agent_registry\r\nARCHIVE_SHA256=0000000000000000000000000000000000000000000000000000000000000000\r\nRESTORE_VERIFIED=YES\r\n' "$RELEASE" > "$proof"
chmod 0600 "$proof"
env \
  TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER \
  TANAGHOM_RELEASE_ID="$RELEASE" \
  TANAGHOM_EXPECTED_CURRENT_COMMIT="$CURRENT" \
  TANAGHOM_TARGET_COMMIT="$TARGET" \
  TANAGHOM_PRESERVED_FILE_SHA256="$PRESERVED" \
  TANAGHOM_BACKUP_PROOF="$proof" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment; validate_backup_proof"

RESUME_RELEASE=phase6-20260721T130000Z
env \
  TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER \
  TANAGHOM_RELEASE_ID="$RESUME_RELEASE" \
  TANAGHOM_BACKUP_RELEASE_ID="$RELEASE" \
  TANAGHOM_EXPECTED_CURRENT_COMMIT="$CURRENT" \
  TANAGHOM_TARGET_COMMIT="$TARGET" \
  TANAGHOM_PRESERVED_FILE_SHA256="$PRESERVED" \
  TANAGHOM_BACKUP_PROOF="$proof" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment; validate_backup_proof"

repository="$workdir/production"
preserved_path="$repository/deployment/phase4-postiz-activation/egress/squid.conf"
mkdir -p "$(dirname "$preserved_path")"
git -C "$workdir" init -q production
git -C "$repository" config user.email test@tanaghom.test
git -C "$repository" config user.name 'Tanaghom Test'
printf 'reviewed baseline\n' > "$preserved_path"
printf 'current\n' > "$repository/version.txt"
git -C "$repository" add .
git -C "$repository" commit -qm current
checkout_current=$(git -C "$repository" rev-parse HEAD)
printf 'target\n' > "$repository/version.txt"
git -C "$repository" add version.txt
git -C "$repository" commit -qm target
checkout_target=$(git -C "$repository" rev-parse HEAD)
git -C "$repository" checkout -q --detach "$checkout_current"
printf 'preserved runtime addition\n' >> "$preserved_path"
preserved_checksum=$(sha256sum "$preserved_path" | awk '{print $1}')

env \
  TANAGHOM_PRODUCTION_ROOT="$repository" \
  TANAGHOM_RELEASE_SOURCE_ROOT="$repository" \
  TANAGHOM_EXPECTED_CURRENT_COMMIT="$checkout_current" \
  TANAGHOM_TARGET_COMMIT="$checkout_target" \
  TANAGHOM_PRESERVED_FILE_SHA256="$preserved_checksum" \
  sh -c ". '$SCRIPT_DIR/common.sh'; assert_preserved_path_stable; assert_production_checkout_at '$checkout_current'; git -C '$repository' checkout -q --detach '$checkout_target'; assert_production_checkout_at '$checkout_target'"

printf 'unapproved drift\n' >> "$repository/version.txt"
expect_refusal env \
  TANAGHOM_PRODUCTION_ROOT="$repository" \
  TANAGHOM_PRESERVED_FILE_SHA256="$preserved_checksum" \
  sh -c ". '$SCRIPT_DIR/common.sh'; assert_production_checkout_at '$checkout_target'"

echo 'PASS: invalid release inputs are refused, Windows CRLF and interrupted-release backup proof are accepted, and exactly one stable preserved Squid file crosses checkout safely.'
