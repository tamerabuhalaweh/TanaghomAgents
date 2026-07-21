#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
script="$root/deployment/phase6-conversation-shadow-canary/scripts"

base='TANAGHOM_RELEASE_SOURCE_ROOT=$1 TANAGHOM_CONVERSATION_CANARY_ID=conversationcanary-20260721T120000Z TANAGHOM_EXPECTED_PRODUCTION_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa TANAGHOM_CONVERSATION_CANARY_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
if sh -c "$base TANAGHOM_CONVERSATION_CANARY_AUTHORIZATION=wrong . \"$script/common.sh\"; require_canary_environment" sh "$root" >/dev/null 2>&1; then
  echo 'invalid authorization was accepted' >&2; exit 1
fi
if sh -c "TANAGHOM_RELEASE_SOURCE_ROOT=\$1 TANAGHOM_CONVERSATION_CANARY_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER TANAGHOM_CONVERSATION_CANARY_ID=bad TANAGHOM_EXPECTED_PRODUCTION_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa TANAGHOM_CONVERSATION_CANARY_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb . \"$script/common.sh\"; require_canary_environment" sh "$root" >/dev/null 2>&1; then
  echo 'invalid canary ID was accepted' >&2; exit 1
fi
if sh -c "TANAGHOM_RELEASE_SOURCE_ROOT=\$1 TANAGHOM_CONVERSATION_CANARY_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER TANAGHOM_CONVERSATION_CANARY_ID=conversationcanary-20260721T120000Z TANAGHOM_EXPECTED_PRODUCTION_COMMIT=short TANAGHOM_CONVERSATION_CANARY_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb . \"$script/common.sh\"; require_canary_environment" sh "$root" >/dev/null 2>&1; then
  echo 'short production commit was accepted' >&2; exit 1
fi
echo 'PASS: authorization, release identity, and immutable-commit refusal paths are fail-closed.'
