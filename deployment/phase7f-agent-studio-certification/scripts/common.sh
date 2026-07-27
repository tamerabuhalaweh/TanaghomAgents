#!/bin/sh
set -eu

CERTIFICATION_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_SOURCE_ROOT=${TANAGHOM_RELEASE_SOURCE_ROOT:-$(CDPATH= cd -- "$CERTIFICATION_SCRIPT_DIR/../../.." && pwd)}
TANAGHOM_RELEASE_SOURCE_ROOT=$RELEASE_SOURCE_ROOT
export TANAGHOM_RELEASE_SOURCE_ROOT

# Reuse the already reviewed Phase 7F workflow, service, database, firewall and
# side-effect assertions. This package replaces only the authorization and
# operator entry points.
. "$RELEASE_SOURCE_ROOT/deployment/phase7f-agent-studio-canary/scripts/common.sh"

SCRIPT_DIR=$CERTIFICATION_SCRIPT_DIR
PRODUCTION_ROOT=${TANAGHOM_PRODUCTION_ROOT:-/opt/tanaghom-dashboard}
EXPECTED_MIGRATION=0033_agent_runtime_certification_evidence
WORKFLOW_CONTRACT="$RELEASE_SOURCE_ROOT/deployment/phase7f-agent-studio-canary/scripts/workflow-contract.mjs"

require_certification_environment() {
  test "${TANAGHOM_PHASE7F_CERTIFICATION_AUTHORIZATION:-}" = \
    'GO-RUN-REMAINING-12-SIMULATION-CERTIFICATION' ||
    die 'explicit Phase 7F full-certification authorization is absent'
  case "${TANAGHOM_PHASE7F_CERTIFICATION_ID:-}" in
    phase7f-certification-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_PHASE7F_CERTIFICATION_ID must use phase7f-certification-YYYYMMDDTHHMMSSZ' ;;
  esac
  TANAGHOM_PHASE7F_CANARY_ID=$TANAGHOM_PHASE7F_CERTIFICATION_ID
  TANAGHOM_RELEASE_ID=$TANAGHOM_PHASE7F_CERTIFICATION_ID
  export TANAGHOM_PHASE7F_CANARY_ID TANAGHOM_RELEASE_ID
  for value in \
    "${TANAGHOM_EXPECTED_PRODUCTION_COMMIT:-}" \
    "${TANAGHOM_PHASE7F_SOURCE_COMMIT:-}"
  do
    echo "$value" | grep -Eq '^[0-9a-f]{40}$' ||
      die 'production and source commits must be full lowercase Git SHAs'
  done
  for value in \
    "${TANAGHOM_CERTIFICATION_ORGANIZATION_ID:-}" \
    "${TANAGHOM_CERTIFICATION_OWNER_ID:-}" \
    "${TANAGHOM_CERTIFICATION_AGENT_VERSION_ID:-}" \
    "${TANAGHOM_CERTIFICATION_RUNTIME_PROFILE_ID:-}"
  do
    echo "$value" | grep -Eqi \
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' ||
      die 'organization, owner, agent version and runtime profile must be UUIDs'
  done
}

operator() {
  action=$1
  shift
  test -s "$DATABASE_CA_CERT" ||
    die "reviewed database CA certificate is missing: $DATABASE_CA_CERT"
  DATABASE_URL=$(database_url) \
    NODE_EXTRA_CA_CERTS="$DATABASE_CA_CERT" \
    TANAGHOM_DATABASE_SSL_MODE=verify-full \
    TANAGHOM_CERTIFICATION_ORGANIZATION_ID="$TANAGHOM_CERTIFICATION_ORGANIZATION_ID" \
    TANAGHOM_CERTIFICATION_OWNER_ID="$TANAGHOM_CERTIFICATION_OWNER_ID" \
    TANAGHOM_CERTIFICATION_AGENT_VERSION_ID="$TANAGHOM_CERTIFICATION_AGENT_VERSION_ID" \
    TANAGHOM_CERTIFICATION_RUNTIME_PROFILE_ID="$TANAGHOM_CERTIFICATION_RUNTIME_PROFILE_ID" \
    node "$SCRIPT_DIR/certification-operator.mjs" \
      "$action" "$TANAGHOM_PHASE7F_CERTIFICATION_ID" "$@"
}

assert_certification_baseline() {
  assert_phase7f_baseline
  operator check-database >/dev/null
}
