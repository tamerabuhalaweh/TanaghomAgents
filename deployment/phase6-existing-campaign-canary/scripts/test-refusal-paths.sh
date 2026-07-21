#!/bin/sh
set -eu
script=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
base='TANAGHOM_CANARY_ID=uatcanary-20260721T150000Z TANAGHOM_CANARY_CAMPAIGN=Campaign.test TANAGHOM_CANARY_CAMPAIGN_ID=2826cef0-58e1-44cf-84c6-92ae12c18ab8 TANAGHOM_CANARY_STRATEGY_JOB_ID=33900f7a-5c07-441e-9908-af1410afe14a TANAGHOM_EXPECTED_CONTENT_ITEMS=3 TANAGHOM_EXPECTED_PRODUCTION_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa TANAGHOM_CANARY_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

if env $base TANAGHOM_CANARY_AUTHORIZATION=wrong sh -c '. "$1/common.sh"; require_environment' sh "$script" >/dev/null 2>&1; then echo 'invalid authorization was accepted' >&2; exit 1; fi
if env $base TANAGHOM_CANARY_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER TANAGHOM_CANARY_ID=bad sh -c '. "$1/common.sh"; require_environment' sh "$script" >/dev/null 2>&1; then echo 'invalid canary ID was accepted' >&2; exit 1; fi
if env $base TANAGHOM_CANARY_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER TANAGHOM_CANARY_CAMPAIGN=not-a-test sh -c '. "$1/common.sh"; require_environment' sh "$script" >/dev/null 2>&1; then echo 'non-.test campaign was accepted' >&2; exit 1; fi
if env $base TANAGHOM_CANARY_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER TANAGHOM_CANARY_CAMPAIGN_ID=bad sh -c '. "$1/common.sh"; require_environment' sh "$script" >/dev/null 2>&1; then echo 'invalid campaign ID was accepted' >&2; exit 1; fi
if env $base TANAGHOM_CANARY_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER TANAGHOM_EXPECTED_CONTENT_ITEMS=13 sh -c '. "$1/common.sh"; require_environment' sh "$script" >/dev/null 2>&1; then echo 'invalid content target was accepted' >&2; exit 1; fi
echo 'PASS: authorization, release ID, campaign identity, .test suffix, and content-target refusal paths are fail-closed.'
