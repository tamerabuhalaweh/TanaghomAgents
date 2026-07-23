---
name: create-postiz-draft
description: Prepare one previously approved Tanaghom content item as a Postiz draft. Use only after server-side approval, policy, channel, idempotency, and emergency-stop checks pass.
---

# Create Postiz Draft

Accept only a server-prepared operation for an approved content item and an allowlisted Postiz channel.

Create a provider draft through the private integration gateway and return the provider operation evidence required by Tanaghom. Preserve idempotency and treat uncertain provider outcomes as indeterminate.

Never publish automatically, expose credentials, choose a different channel, or retry an indeterminate operation.
