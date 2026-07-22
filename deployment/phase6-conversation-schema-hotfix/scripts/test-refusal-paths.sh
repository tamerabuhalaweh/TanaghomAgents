#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
script="$root/deployment/phase6-conversation-schema-hotfix/scripts"
if TANAGHOM_RELEASE_SOURCE_ROOT="$root" TANAGHOM_CONVERSATION_HOTFIX_AUTHORIZATION=wrong TANAGHOM_CONVERSATION_HOTFIX_ID=conversation-schema-hotfix-20260722T120000Z TANAGHOM_EXPECTED_PRODUCTION_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa TANAGHOM_CONVERSATION_HOTFIX_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sh -c '. "$1/common.sh"; require_hotfix_environment' sh "$script" >/dev/null 2>&1; then
  echo 'invalid hotfix authorization was accepted' >&2; exit 1
fi
if TANAGHOM_RELEASE_SOURCE_ROOT="$root" TANAGHOM_CONVERSATION_HOTFIX_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER TANAGHOM_CONVERSATION_HOTFIX_ID=bad TANAGHOM_EXPECTED_PRODUCTION_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa TANAGHOM_CONVERSATION_HOTFIX_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sh -c '. "$1/common.sh"; require_hotfix_environment' sh "$script" >/dev/null 2>&1; then
  echo 'invalid hotfix release ID was accepted' >&2; exit 1
fi
TANAGHOM_RELEASE_SOURCE_ROOT="$root" TANAGHOM_CONVERSATION_HOTFIX_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER TANAGHOM_CONVERSATION_HOTFIX_ID=conversation-schema-hotfix-20260722T120000Z TANAGHOM_EXPECTED_PRODUCTION_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa TANAGHOM_CONVERSATION_HOTFIX_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  sh -c '. "$1/common.sh"; require_hotfix_environment; test "$TANAGHOM_RELEASE_ID" = "$TANAGHOM_CONVERSATION_HOTFIX_ID"' sh "$script"
echo 'PASS: Conversation schema hotfix authorization and identity refusal paths are fail-closed.'
