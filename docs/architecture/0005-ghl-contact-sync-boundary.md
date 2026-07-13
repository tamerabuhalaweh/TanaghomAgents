# 0005 — GHL contact synchronization boundary

## Decision

Phase 5A introduces only a customer-requested GoHighLevel contact upsert. It
does not introduce messaging, sequences, opportunity movement, appointment
booking, or scheduled automation.

The customer stores a private integration token and location ID through the
owner-only Integrations settings. The token is encrypted at rest and is
decrypted only inside the dashboard's private integration gateway. Neither the
browser, n8n export, PostgreSQL worker role, nor execution history receives it.

An owner or operator explicitly queues a contactable lead. PostgreSQL creates a
versioned job and idempotent external-operation record. The inactive n8n
workflow can claim and prepare that job only through security-definer
functions, sends the bounded request to the private gateway, and records the
validated result through another controlled function.

## Safety properties

- GHL's platform emergency stop defaults to active.
- Organization CRM policy defaults to manual and may be paused.
- The upsert request sets `createNewIfDuplicateAllowed` to false.
- A location mismatch blocks completion.
- An indeterminate GHL operation blocks further claims for that organization.
- Retryable failures reuse the same job and external-operation idempotency key.
- The n8n worker has no direct table writes, credential reads, or approval
  privileges.
- The workflow and schedule are committed inactive and execution-data saving is
  disabled for both successes and failures.

## Activation boundary

Static and disposable simulated-provider evidence does not authorize a live
GHL call or production workflow activation. Those require customer credentials,
an approved test location, reviewed egress, and a separate controlled runtime
approval.

## Rollback

Migration `0011_ghl_contact_sync.down.sql` removes only Phase 5A functions,
state, policy, index, and GHL platform-control row, then restores the Postiz-only
provider constraint. Application and workflow changes can be rolled back by
reverting their release while the workflow remains inactive.
