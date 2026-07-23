#!/bin/sh
set -eu

package=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if TANAGHOM_UAT_CORRECTION_AUTHORIZATION=wrong \
  TANAGHOM_UAT_CORRECTION_ID=uatcorrection-20260723T000000Z \
  TANAGHOM_EXPECTED_RELEASE_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  "$package/scripts/preflight.sh" >/dev/null 2>&1; then
  echo 'invalid authorization unexpectedly passed' >&2
  exit 1
fi

if TANAGHOM_UAT_CORRECTION_AUTHORIZATION=CORRECT-REVIEWED-TANAGHOM-UAT-RUNTIME \
  TANAGHOM_UAT_CORRECTION_ID=invalid \
  TANAGHOM_EXPECTED_RELEASE_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  "$package/scripts/preflight.sh" >/dev/null 2>&1; then
  echo 'invalid correction ID unexpectedly passed' >&2
  exit 1
fi

if TANAGHOM_UAT_CORRECTION_AUTHORIZATION=CORRECT-REVIEWED-TANAGHOM-UAT-RUNTIME \
  TANAGHOM_UAT_CORRECTION_ID=uatcorrection-20260723T000000Z \
  TANAGHOM_EXPECTED_RELEASE_COMMIT=short \
  "$package/scripts/preflight.sh" >/dev/null 2>&1; then
  echo 'invalid commit pin unexpectedly passed' >&2
  exit 1
fi

echo 'PASS: missing authorization, invalid correction IDs, and invalid commit pins fail closed.'
