# Phase 6 provider runtime readiness

This package reconciles the dashboard's protected-worker readiness flags with
the already deployed and independently validated n8n-to-Tanaghom HTTPS gateway.

It rebuilds and recreates only the Tanaghom dashboard. It does not alter n8n,
the proxy, firewall, Nginx, database schema, credentials, workflow activation,
provider policy, channel mappings, or external operations.

The target state intentionally keeps:

- Postiz and GHL platform emergency stops active;
- Postiz and GHL organization policies in manual/fail-closed modes;
- GHL contact sync, action dispatch, and webhook ingress disabled;
- every provider-worker schedule in its current disabled state;
- external provider operations at zero.

Runtime readiness means only that the encrypted credential vault, worker
authentication, and reviewed HTTPS gateway boundary are available. It does not
authorize a Postiz draft, GHL call, message, publication, or automatic mode.
