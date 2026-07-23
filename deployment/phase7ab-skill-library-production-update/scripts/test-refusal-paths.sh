#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CURRENT=1111111111111111111111111111111111111111
TARGET=2222222222222222222222222222222222222222
RELEASE=phase7ab-20260723T120000Z

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
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment"

expect_refusal env \
  TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER \
  TANAGHOM_RELEASE_ID=unsafe-release \
  TANAGHOM_EXPECTED_CURRENT_COMMIT="$CURRENT" \
  TANAGHOM_TARGET_COMMIT="$TARGET" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment"

expect_refusal env \
  TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER \
  TANAGHOM_RELEASE_ID="$RELEASE" \
  TANAGHOM_EXPECTED_CURRENT_COMMIT=1111111 \
  TANAGHOM_TARGET_COMMIT="$TARGET" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment"

expect_refusal env \
  TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER \
  TANAGHOM_RELEASE_ID="$RELEASE" \
  TANAGHOM_EXPECTED_CURRENT_COMMIT="$CURRENT" \
  TANAGHOM_TARGET_COMMIT="$CURRENT" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment"

env \
  TANAGHOM_RELEASE_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER \
  TANAGHOM_RELEASE_ID="$RELEASE" \
  TANAGHOM_EXPECTED_CURRENT_COMMIT="$CURRENT" \
  TANAGHOM_TARGET_COMMIT="$TARGET" \
  sh -c ". '$SCRIPT_DIR/common.sh'; require_release_environment"

echo 'PASS: missing authorization, malformed release identity, malformed commit, and same-commit release are refused.'
