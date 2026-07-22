#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
script="$root/deployment/phase6-runtime-agent-reconciliation/scripts"
if TANAGHOM_RELEASE_SOURCE_ROOT="$root" TANAGHOM_RUNTIME_AGENT_AUTHORIZATION=wrong TANAGHOM_RUNTIME_AGENT_RELEASE_ID=phase6-runtime-agents-20260721T120000Z TANAGHOM_EXPECTED_PRODUCTION_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa TANAGHOM_RUNTIME_AGENT_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sh -c '. "$1/common.sh"; require_runtime_agent_environment' sh "$script" >/dev/null 2>&1; then
  echo 'invalid runtime-agent authorization was accepted' >&2; exit 1
fi
if TANAGHOM_RELEASE_SOURCE_ROOT="$root" TANAGHOM_RUNTIME_AGENT_AUTHORIZATION=YES-I-AM-THE-AUTHORIZED-OWNER TANAGHOM_RUNTIME_AGENT_RELEASE_ID=bad TANAGHOM_EXPECTED_PRODUCTION_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa TANAGHOM_RUNTIME_AGENT_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb sh -c '. "$1/common.sh"; require_runtime_agent_environment' sh "$script" >/dev/null 2>&1; then
  echo 'invalid runtime-agent release ID was accepted' >&2; exit 1
fi
echo 'PASS: runtime-agent authorization and release-identity refusal paths are fail-closed.'
