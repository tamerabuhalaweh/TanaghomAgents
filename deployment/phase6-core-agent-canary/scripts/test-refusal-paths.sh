#!/bin/sh
set -eu
script=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if TANAGHOM_CANARY_AUTHORIZATION=wrong TANAGHOM_CANARY_ID=corecanary-20260719T120000Z TANAGHOM_CANARY_CAMPAIGN=x.test TANAGHOM_EXPECTED_PRODUCTION_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa TANAGHOM_CANARY_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sh -c '. "$1/common.sh"; require_environment' sh "$script" >/dev/null 2>&1; then
  echo 'invalid authorization was accepted' >&2; exit 1
fi
if TANAGHOM_CANARY_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER TANAGHOM_CANARY_ID=bad TANAGHOM_CANARY_CAMPAIGN=x.test TANAGHOM_EXPECTED_PRODUCTION_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa TANAGHOM_CANARY_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sh -c '. "$1/common.sh"; require_environment' sh "$script" >/dev/null 2>&1; then
  echo 'invalid canary ID was accepted' >&2; exit 1
fi
if TANAGHOM_CANARY_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER TANAGHOM_CANARY_ID=corecanary-20260719T120000Z TANAGHOM_CANARY_CAMPAIGN=not-a-test TANAGHOM_EXPECTED_PRODUCTION_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa TANAGHOM_CANARY_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sh -c '. "$1/common.sh"; require_environment' sh "$script" >/dev/null 2>&1; then
  echo 'non-.test campaign was accepted' >&2; exit 1
fi
echo 'PASS: authorization, release-ID, and .test campaign refusal paths are fail-closed.'
