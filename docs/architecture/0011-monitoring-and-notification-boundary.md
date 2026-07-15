# Monitoring and notification boundary

## Decision

Tanaghom exposes one authenticated, organization-scoped monitoring snapshot.
It reads the existing conversation-capacity view, integration status, agent
heartbeats, unread alerts, platform controls, and secret-free notification
delivery status in one read-only database transaction.

The monitoring UI distinguishes direct health evidence from inferred state.
Application and PostgreSQL readiness come from the live health endpoint;
provider labels come from recorded connection tests; Gemma cooldown is a
negative signal only; and an agent with no recorded heartbeat is shown as
"Not independently verified."

Owners may configure one email, Slack, and WhatsApp destination per
organization. Destination values use the established AES-256-GCM integration
key, are write-only in the browser, and are represented by a short mask after
save. Slack accepts only `https://hooks.slack.com/services/...`, email is
validated as an address, and WhatsApp uses E.164 format. Arbitrary webhook URLs
are intentionally unsupported.

## Safety boundary

Destination configuration and delivery activation are separate controls.
Migration `0019_notification_monitoring_destinations` creates a singleton
platform control with `runtime_ready=false` and `emergency_stop=true`. The
dashboard may read but cannot change those fields. n8n and conversation worker
roles receive no destination-table access. No notification provider client,
poller, schedule, credential decryption path, or delivery workflow is added by
this slice.

## Rollback

The down migration refuses to remove the destination table while customer
destinations exist. An authorized operator must export or explicitly remove
those records before rollback. The dashboard change can be reverted without
changing provider state because this slice performs no provider calls.
