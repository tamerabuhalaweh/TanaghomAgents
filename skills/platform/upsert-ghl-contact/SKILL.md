---
name: upsert-ghl-contact
description: Create or update one explicitly queued GoHighLevel contact through Tanaghom's private gateway. Use only for server-authorized, tenant-scoped contact synchronization.
---

# Upsert GHL Contact

Accept only the server-prepared contact payload and location identity for the current organization.

Perform the bounded upsert through the private integration gateway and return the normalized result evidence. Preserve idempotency and the configured duplicate policy.

Do not message the contact, change pipeline state, book appointments, expose credentials, or broaden the supplied data.
