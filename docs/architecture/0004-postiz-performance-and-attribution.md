# Postiz performance and lead attribution boundary

## Status

Accepted for Phase 4H implementation. Production migration, workflow import,
schedule activation, and provider calls remain separate approval gates.

## Purpose

Tanaghom needs historical evidence after an approved draft becomes a Postiz
post. A single mutable total is insufficient for trend reporting, retry safety,
or campaign attribution. Phase 4H therefore records dated provider observations
and derives the dashboard aggregates from those observations.

## Data flow

1. The API queues a performance job only for a live Postiz post belonging to the
   authenticated organization.
2. The restricted worker claims and prepares that job through controlled
   database functions. It has no direct table-write privilege.
3. n8n calls the private Tanaghom integration gateway with its platform worker
   credential and a job fingerprint. It never receives the customer API key.
4. The gateway rechecks the job, organization policy, emergency stop, connected
   credential, and fingerprint before calling Postiz.
5. n8n normalizes the dated metric series and completes the job through a
   security-definer function.
6. The function idempotently upserts observations and refreshes the post's
   current aggregate totals.
7. Reports reads organization-scoped campaign, post, freshness, and attribution
   evidence through the authenticated operations API.

## Safety properties

- The committed workflow is inactive and its polling trigger is disabled.
- `POSTIZ_PERFORMANCE_SYNC_ENABLED` defaults to `false` and independently locks
  the gateway.
- Queueing and claiming stop while the organization is paused, the platform
  emergency stop is active, the credential is disconnected, or a provider
  operation is indeterminate.
- A partial retry cannot duplicate an observation for the same organization,
  post, provider, metric, and date.
- Lead attribution requires same-organization source, campaign, and post
  evidence. Incomplete or conflicting evidence is quarantined for human review.
- Terminal synchronization failures notify active owners; records remain
  available for diagnosis.

## Provider contract

The gateway uses Postiz's public post analytics endpoint and requests a bounded
lookback period. Provider labels are mapped to Tanaghom's stable metric keys;
unknown labels are retained as normalized provider metrics rather than silently
discarded.

No customer credential, provider response containing secrets, or raw provider
URL is persisted by the workflow export.

## Controlled production order

1. Review and approve the migration and rollback diff.
2. Back up the database and apply migration `0010`.
3. Deploy the dashboard gateway with synchronization still disabled.
4. Import the exact reviewed workflow export inactive.
5. Validate database grants, gateway authentication, and the emergency stop.
6. Connect a Postiz-supported staging business channel.
7. Enable the gateway only for a controlled staging test.
8. Manually run one bounded synchronization and inspect history, attribution,
   audit events, and Reports.
9. Consider schedule activation only under a separate approval.

## Rollback scope

- Disable `POSTIZ_PERFORMANCE_SYNC_ENABLED` first.
- Disable the n8n schedule and deactivate the workflow.
- Roll back the dashboard release if required.
- Apply `0010_postiz_performance_monitoring.down.sql` only after confirming the
  Phase 4H history is no longer required or has been exported. The down migration
  removes only Phase 4H functions, grants, triggers, indexes, and tables.
- Earlier Phase 4 publishing and credential records are not removed.
