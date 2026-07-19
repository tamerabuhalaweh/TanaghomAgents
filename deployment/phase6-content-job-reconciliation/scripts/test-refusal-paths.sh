#!/bin/sh
set -eu
script=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

valid_environment='TANAGHOM_JOB_RECONCILIATION_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER TANAGHOM_JOB_RECONCILIATION_ID=jobreconcile-20260719T160000Z TANAGHOM_CANARY_ID=corecanary-20260719T144142Z TANAGHOM_CANARY_CAMPAIGN=x.test TANAGHOM_CONTENT_JOB_ID=49333772-19e9-4e00-8ef3-ae85e91f619f TANAGHOM_EXPECTED_PRODUCTION_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa TANAGHOM_RECONCILIATION_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb TANAGHOM_CANARY_SOURCE_COMMIT=cccccccccccccccccccccccccccccccccccccccc'

if env $valid_environment TANAGHOM_JOB_RECONCILIATION_AUTHORIZATION=wrong sh -c '. "$1/common.sh"; require_environment' sh "$script" >/dev/null 2>&1; then
  echo 'invalid authorization was accepted' >&2; exit 1
fi
if env $valid_environment TANAGHOM_JOB_RECONCILIATION_ID=bad sh -c '. "$1/common.sh"; require_environment' sh "$script" >/dev/null 2>&1; then
  echo 'invalid reconciliation ID was accepted' >&2; exit 1
fi
if env $valid_environment TANAGHOM_CANARY_CAMPAIGN=not-a-test sh -c '. "$1/common.sh"; require_environment' sh "$script" >/dev/null 2>&1; then
  echo 'non-.test campaign was accepted' >&2; exit 1
fi
if env $valid_environment TANAGHOM_CONTENT_JOB_ID=not-a-uuid sh -c '. "$1/common.sh"; require_environment' sh "$script" >/dev/null 2>&1; then
  echo 'invalid content job ID was accepted' >&2; exit 1
fi
if env $valid_environment TANAGHOM_RECONCILIATION_SOURCE_COMMIT=short sh -c '. "$1/common.sh"; require_environment' sh "$script" >/dev/null 2>&1; then
  echo 'short source commit was accepted' >&2; exit 1
fi
echo 'PASS: reconciliation authorization, IDs, campaign, job, and commit refusal paths are fail-closed.'
