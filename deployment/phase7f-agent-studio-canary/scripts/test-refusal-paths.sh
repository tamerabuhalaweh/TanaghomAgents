#!/bin/sh
set -eu

script=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh
commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
uuid=10000000-0000-4000-8000-000000000001

if env \
  TANAGHOM_PHASE7F_CANARY_AUTHORIZATION=wrong \
  TANAGHOM_PHASE7F_CANARY_ID=phase7f-canary-20260727T120000Z \
  TANAGHOM_EXPECTED_PRODUCTION_COMMIT=$commit \
  TANAGHOM_PHASE7F_SOURCE_COMMIT=$commit \
  TANAGHOM_CANARY_ORGANIZATION_ID=$uuid \
  TANAGHOM_CANARY_OWNER_ID=$uuid \
  TANAGHOM_CANARY_AGENT_VERSION_ID=$uuid \
  sh -c '. "$1"; require_canary_environment' sh "$script" >/dev/null 2>&1
then
  echo 'invalid authorization was accepted' >&2
  exit 1
fi

if env \
  TANAGHOM_PHASE7F_CANARY_AUTHORIZATION=GO-RUN-SIMULATION-ONLY-AGENT-CANARY \
  TANAGHOM_PHASE7F_CANARY_ID=unsafe \
  TANAGHOM_EXPECTED_PRODUCTION_COMMIT=$commit \
  TANAGHOM_PHASE7F_SOURCE_COMMIT=$commit \
  TANAGHOM_CANARY_ORGANIZATION_ID=$uuid \
  TANAGHOM_CANARY_OWNER_ID=$uuid \
  TANAGHOM_CANARY_AGENT_VERSION_ID=$uuid \
  sh -c '. "$1"; require_canary_environment' sh "$script" >/dev/null 2>&1
then
  echo 'invalid canary identity was accepted' >&2
  exit 1
fi

echo 'PASS: missing authorization and invalid canary identities fail closed.'
