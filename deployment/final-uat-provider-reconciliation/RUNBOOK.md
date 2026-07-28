# Controlled Final UAT provider reconciliation

## Purpose

The certified Tanaghom deployment at
`https://tanaghom.38-247-187-232.sslip.io` still allows only the retired Postiz
API hostname. The customer-managed temporary-production Postiz service is:

`https://postiz.155-117-45-45.sslip.io/api/public/v1`

The dashboard already has a reviewed outbound network and can reach that
endpoint over TLS. This transaction replaces the application-level Postiz URL
allowlist, rebuilds/recreates only the Tanaghom dashboard, and proves every
provider and workflow safety lock remains closed.

## Exact scope

The transaction:

1. verifies production source, database migration `0033`, healthy containers,
   protected network identities, firewall/Nginx/Squid hashes, runtime flags,
   gateway authentication, provider stops, and zero provider operations;
2. verifies unauthenticated TLS reachability to the new Postiz API and GHL
   (HTTP 401 is the expected proof);
3. tags the exact current dashboard image for rollback;
4. checks out and builds the exact reviewed Git commit;
5. recreates only `tanaghom-dashboard-canary-dashboard-1`; and
6. repeats all boundaries and records root-only evidence.

It does not change a credential, database row, n8n workflow, schedule, provider
policy, firewall, Nginx, Squid, network, or protected service.

## Mandatory preflight

Run from a clean, exact release-source checkout:

```sh
export TANAGHOM_PROVIDER_RECONCILIATION_AUTHORIZATION=GO-RECONCILE-TANAGHOM-UAT-PROVIDERS
export TANAGHOM_PROVIDER_RECONCILIATION_ID=providerreconcile-YYYYMMDDTHHMMSSZ
export TANAGHOM_EXPECTED_CURRENT_COMMIT='<deployed 40-character commit>'
export TANAGHOM_TARGET_COMMIT='<approved 40-character commit>'
sudo -E deployment/final-uat-provider-reconciliation/scripts/preflight.sh
```

The preflight fails if credentials/channels/actions have already started,
production has an unreviewed change, the target is not current remote `main`,
the dashboard/provider boundary differs, or any protected component is
unhealthy.

## Deployment

```sh
sudo -E deployment/final-uat-provider-reconciliation/scripts/deploy-allowlist.sh
```

Evidence is written under:

`/var/backups/tanaghom-providerreconcile-YYYYMMDDTHHMMSSZ`

No database backup is required because the transaction performs no database
mutation. The exact prior image, commit, container/network evidence, runtime
configuration, firewall, Nginx, Squid, provider-control counts, gateway proof,
and n8n audit are retained.

## Validation

```sh
sudo -E deployment/final-uat-provider-reconciliation/scripts/validate-release.sh
```

Expected result:

- public health is HTTP 200;
- protected routes remain authenticated;
- the dashboard remains loopback-bound and on only its outbound network;
- `POSTIZ_ALLOWED_BASE_URLS` equals the new API base exactly;
- Postiz/GHL runtime readiness stays true while provider execution, GHL webhook
  ingress, contact sync, and GHL action execution stay false;
- platform and organization emergency stops remain active;
- no active Postiz channel, connected GHL tenant, or external provider
  operation appears;
- new Postiz and GHL unauthenticated reachability returns HTTP 401;
- both n8n containers reach the authenticated Tanaghom gateway through Squid,
  unapproved proxy destinations and direct egress remain denied; and
- n8n, PostgreSQL, Redis, Squid, firewall, Nginx, and protected container
  identities remain unchanged.

## Exact rollback

Rollback is allowed only before a credential is saved against the new Postiz
base, a Postiz channel is activated, a GHL tenant becomes connected, a provider
operation exists, or a safety policy changes:

```sh
export TANAGHOM_PROVIDER_RECONCILIATION_AUTHORIZATION=GO-RECONCILE-TANAGHOM-UAT-PROVIDERS
export TANAGHOM_PROVIDER_RECONCILIATION_ID=providerreconcile-YYYYMMDDTHHMMSSZ
export TANAGHOM_EXPECTED_CURRENT_COMMIT='<deployed 40-character commit>'
export TANAGHOM_TARGET_COMMIT='<approved 40-character commit>'
export TANAGHOM_PROVIDER_RECONCILIATION_ROLLBACK=ROLLBACK-TANAGHOM-UAT-PROVIDER-ALLOWLIST
sudo -E deployment/final-uat-provider-reconciliation/scripts/rollback-allowlist.sh
```

Rollback restores the recorded prior commit and dashboard image, recreates only
the dashboard, and proves the old allowlist and all protected boundaries.

Once customer credentials or channels are onboarded, use a separately reviewed
reconciliation; do not use this automatic rollback.

## Customer-owned gates after deployment

The application allowlist does not make Final UAT pass. The following external
facts must still exist:

1. the owner re-enters the raw Postiz API key in the certified Tanaghom vault;
2. one supported business/professional staging channel is connected to the same
   Postiz organization and mapped in Tanaghom;
3. the owner re-enters the GHL Private Integration Token and Location ID in the
   certified vault;
4. GHL grants `locations.readonly` for the connection check and only the exact
   write scopes authorized for Assisted UAT;
5. a signed GHL webhook subscription, one allowlisted WhatsApp test contact,
   approved English/Arabic templates, consent/DND, quiet hours, and frequency
   limits are supplied; and
6. bounded Shadow and Assisted evidence passes before any production rollout.

The previously shared Postiz test key must be rotated after staging acceptance
and before customer production.
