#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

if (
  unset TANAGHOM_UAT_ACTIVATION_AUTHORIZATION TANAGHOM_UAT_ACTIVATION_ID TANAGHOM_EXPECTED_RELEASE_COMMIT
  require_release_environment
) >/dev/null 2>&1; then
  echo 'missing authorization was accepted' >&2
  exit 1
fi

if (
  TANAGHOM_UAT_ACTIVATION_AUTHORIZATION=ACTIVATE-REVIEWED-TANAGHOM-UAT-WORKERS
  TANAGHOM_UAT_ACTIVATION_ID=unsafe
  TANAGHOM_EXPECTED_RELEASE_COMMIT=0000000000000000000000000000000000000000
  export TANAGHOM_UAT_ACTIVATION_AUTHORIZATION TANAGHOM_UAT_ACTIVATION_ID TANAGHOM_EXPECTED_RELEASE_COMMIT
  require_release_environment
) >/dev/null 2>&1; then
  echo 'invalid activation ID was accepted' >&2
  exit 1
fi

if (
  TANAGHOM_UAT_ACTIVATION_AUTHORIZATION=ACTIVATE-REVIEWED-TANAGHOM-UAT-WORKERS
  TANAGHOM_UAT_ACTIVATION_ID=uatactivation-20260722T000000Z
  TANAGHOM_EXPECTED_RELEASE_COMMIT=short
  export TANAGHOM_UAT_ACTIVATION_AUTHORIZATION TANAGHOM_UAT_ACTIVATION_ID TANAGHOM_EXPECTED_RELEASE_COMMIT
  require_release_environment
) >/dev/null 2>&1; then
  echo 'invalid release commit was accepted' >&2
  exit 1
fi

echo 'PASS: missing authorization, invalid release IDs, and invalid commit pins fail closed.'
