#!/bin/sh
set -eu

SCRIPT_DIR_COMMON=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR_COMMON/../../phase6-provider-runtime-readiness/scripts/common.sh"

EXPECTED_MIGRATION=0033_agent_runtime_certification_evidence
OLD_POSTIZ_BASE=https://postiz.163-123-180-104.sslip.io/api/public/v1
NEW_POSTIZ_BASE=https://postiz.155-117-45-45.sslip.io/api/public/v1
GHL_PROBE_URL=https://services.leadconnectorhq.com/locations/jRd3z6IEHghwU0oES6ET

require_reconciliation_environment() {
  test "${TANAGHOM_PROVIDER_RECONCILIATION_AUTHORIZATION:-}" = \
    'GO-RECONCILE-TANAGHOM-UAT-PROVIDERS' ||
    die 'explicit Final UAT provider-reconciliation authorization is absent'
  case "${TANAGHOM_PROVIDER_RECONCILIATION_ID:-}" in
    providerreconcile-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_PROVIDER_RECONCILIATION_ID must use providerreconcile-YYYYMMDDTHHMMSSZ' ;;
  esac
  for value in "${TANAGHOM_EXPECTED_CURRENT_COMMIT:-}" "${TANAGHOM_TARGET_COMMIT:-}"; do
    echo "$value" | grep -Eq '^[0-9a-f]{40}$' ||
      die 'commit IDs must be full lowercase Git SHAs'
  done
  test "$TANAGHOM_EXPECTED_CURRENT_COMMIT" != "$TANAGHOM_TARGET_COMMIT" ||
    die 'current and target commits must differ'
}

current_postiz_allowlist() {
  container_env | sed -n 's/^POSTIZ_ALLOWED_BASE_URLS=//p'
}

assert_current_postiz_allowlist() {
  test "$(current_postiz_allowlist)" = "$OLD_POSTIZ_BASE" ||
    die 'current Postiz allowlist is not the reviewed retired base'
}

assert_target_postiz_allowlist() {
  test "$(current_postiz_allowlist)" = "$NEW_POSTIZ_BASE" ||
    die 'target Postiz allowlist is not the reviewed new base'
}

assert_source_reconciliation_contract() {
  config=$(source_compose config)
  echo "$config" | grep -q "POSTIZ_ALLOWED_BASE_URLS: $NEW_POSTIZ_BASE" ||
    die 'target Compose does not contain the exact new Postiz API base'
  echo "$config" | grep -q 'POSTIZ_AUTOMATION_RUNTIME_READY: "true"' ||
    die 'target Postiz readiness changed'
  echo "$config" | grep -q 'GHL_ACTION_RUNTIME_READY: "true"' ||
    die 'target GHL readiness changed'
  echo "$config" | grep -q 'AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED: "false"' ||
    die 'target generic provider execution is not false'
  echo "$config" | grep -q 'GHL_WEBHOOK_INGRESS_ENABLED: "false"' ||
    die 'target GHL webhook ingress is not false'
  echo "$config" | grep -q 'GHL_CONTACT_SYNC_ENABLED: "false"' ||
    die 'target GHL contact sync is not false'
  echo "$config" | grep -q 'GHL_ACTION_RUNTIME_ENABLED: "false"' ||
    die 'target GHL action execution is not false'
}

assert_provider_network_reachable() {
  output=$(docker exec "$DASHBOARD_CONTAINER" node --input-type=module -e "
const checks = [
  ['postiz', '$NEW_POSTIZ_BASE/is-connected', {}],
  ['ghl', '$GHL_PROBE_URL', { Version: '2021-07-28' }],
];
for (const [name, url, headers] of checks) {
  try {
    const response = await fetch(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
    });
    console.log(name + '|' + response.status + '|' + new URL(url).hostname);
  } catch (error) {
    console.log(name + '|ERROR|' + (error?.cause?.code || error?.name || 'Error'));
  }
}")
  echo "$output"
  echo "$output" | grep -qx 'postiz|401|postiz.155-117-45-45.sslip.io' ||
    die 'new Postiz TLS/API path is not reachable with the expected unauthenticated boundary'
  echo "$output" | grep -qx 'ghl|401|services.leadconnectorhq.com' ||
    die 'GHL TLS/API path is not reachable with the expected unauthenticated boundary'
}

provider_state_fingerprint() {
  db_scalar "
    SELECT concat_ws('|',
      (SELECT count(*) FROM tanaghom.external_operations),
      (SELECT count(*) FROM tanaghom.publishing_channels WHERE is_active),
      (SELECT count(*) FROM tanaghom.integration_connections
        WHERE provider='ghl' AND status='connected'),
      (SELECT count(*) FROM tanaghom.integration_connections
        WHERE provider='postiz' AND base_url='$NEW_POSTIZ_BASE'),
      (SELECT count(*) FROM tanaghom.automation_platform_controls
        WHERE emergency_stop IS NOT TRUE),
      (SELECT count(*) FROM tanaghom.organization_crm_policies
        WHERE conversation_emergency_stop IS NOT TRUE
           OR action_emergency_stop IS NOT TRUE
           OR conversation_processing_mode<>'paused'
           OR action_mode<>'manual'
           OR proactive_message_mode<>'disabled'),
      (SELECT count(*) FROM tanaghom.organization_automation_policies
        WHERE postiz_draft_mode<>'manual')
    );"
}

assert_pre_onboarding_state() {
  test "$(provider_state_fingerprint)" = '0|0|0|0|0|0|0' ||
    die 'provider/channel/action state has moved beyond the pre-onboarding baseline'
}

capture_reconciliation_firewall() {
  destination=$1
  capture_firewall "$destination"
}
