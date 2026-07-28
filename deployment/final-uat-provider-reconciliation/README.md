# Final UAT provider reconciliation

This package prepares the certified `38.247` Tanaghom deployment to accept the
customer-managed Postiz service hosted at `155.117.45.45`.

It changes only the Tanaghom dashboard source/image and its exact application
allowlist. It does not:

- read, copy, migrate, decrypt, or write a provider credential;
- connect a social channel;
- enable GHL webhook ingress, contact sync, action execution, or provider
  execution;
- clear a platform or organization emergency stop;
- activate an n8n schedule;
- change PostgreSQL, Redis, n8n, Squid, firewall, Nginx, Docker networks, or any
  protected service.

The package proves the existing dashboard network can reach the new Postiz API
and GHL over TLS without a credential, while n8n can reach only the authenticated
Tanaghom integration gateway through the reviewed Squid path.

See [RUNBOOK.md](./RUNBOOK.md) for the controlled deployment, validation, exact
rollback, and the customer-owned gates that remain afterward.
