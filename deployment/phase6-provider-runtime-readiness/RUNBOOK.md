# Controlled provider-runtime readiness runbook

## Scope

The package removes two obsolete infrastructure blockers from the Agents page:
`runtime_not_enabled` and `gateway_not_ready`. The gateway itself was deployed
previously and remains routed through the deny-by-default Squid proxy. The
dashboard remains outside every n8n network.

The package does not remove the genuine customer/UAT blockers: Postiz has no
active supported business-channel mapping, GHL has no connected staging
credential or allowed channel, both provider platform stops remain active, GHL
organization actions remain stopped, and provider policies remain manual.

## Mandatory preflight

From a clean checkout of the approved target commit:

```sh
export TANAGHOM_PROVIDER_RUNTIME_AUTHORIZATION=GO-ENABLE-PROVEN-PROVIDER-RUNTIME-BOUNDARY
export TANAGHOM_PROVIDER_RUNTIME_ID=providerruntime-YYYYMMDDTHHMMSSZ
export TANAGHOM_EXPECTED_CURRENT_COMMIT='<40-character deployed commit>'
export TANAGHOM_TARGET_COMMIT='<40-character approved target commit>'
sudo -E deployment/phase6-provider-runtime-readiness/scripts/preflight.sh
```

Preflight proves the current dashboard remains fail-closed, both dashboard
secrets exist, the fixed n8n header credential exists, the proxy permits only
the reviewed Tanaghom HTTPS hostname, direct egress is denied, unauthenticated
gateway traffic is rejected, all provider policies remain locked, no external
operation exists, and protected container/firewall identities are healthy.

## Deploy

```sh
sudo -E deployment/phase6-provider-runtime-readiness/scripts/deploy-update.sh
```

The script tags the current dashboard image for rollback, captures root-only
evidence, checks out the exact approved commit, builds the dashboard, recreates
only that dashboard container, and validates the release. Any pre-commit
failure automatically restores the previous checkout and image.

## Expected result

- `POSTIZ_AUTOMATION_RUNTIME_READY=true`
- `GHL_ACTION_RUNTIME_READY=true`
- `TANAGHOM_INTEGRATION_GATEWAY_URL` equals the reviewed Tanaghom HTTPS URL
- GHL webhook ingress, contact sync, and action dispatch remain `false`
- Postiz/GHL platform stops remain active
- all organization policies remain fail-closed
- no provider operation, Postiz draft, GHL action, or content publication occurs
- n8n containers, workflows, proxy, firewall, Nginx, and protected services are
  unchanged

## Exact rollback

Rollback is allowed only before any provider operation or safety-policy change:

```sh
export TANAGHOM_PROVIDER_RUNTIME_AUTHORIZATION=GO-ENABLE-PROVEN-PROVIDER-RUNTIME-BOUNDARY
export TANAGHOM_PROVIDER_RUNTIME_ID=providerruntime-YYYYMMDDTHHMMSSZ
export TANAGHOM_PROVIDER_RUNTIME_ROLLBACK=ROLLBACK-PROVEN-PROVIDER-RUNTIME-BOUNDARY
sudo -E deployment/phase6-provider-runtime-readiness/scripts/rollback-update.sh
```

Rollback checks out the recorded previous commit, restores the tagged dashboard
image, recreates only the dashboard, and proves the prior false/empty readiness
state. It refuses after provider activity or safety-lock changes.
