# Notification delivery worker

Status: proposed (branch `readiness/03-alert-delivery`). Extends ADR 0011, which
deliberately excluded delivery from the destination slice.

## Decision

Migration `0036_notification_delivery_worker` adds `tanaghom.notification_deliveries`
and three API-role functions. A delivery tick (`POST /api/internal/notifications/deliver`,
worker-token authenticated) enqueues, claims and completes deliveries for the five
database-derivable events in `conversation_capacity_status`: `queue_age`,
`interactive_backlog`, `dependency_cooldown`, `dead_letter`, `indeterminate_action`.
Email (SMTPS) and Slack (`hooks.slack.com` incoming webhook) are supported.
`worker_unready` and `database_unavailable` cannot be raised by the database
they describe; they need an external watchdog and remain out of scope. WhatsApp
waits for a provider decision and is never claimed.

## Safety

- Off by default twice: `NOTIFICATION_DELIVERY_ENABLED=true` on the dashboard and
  the existing singleton control `runtime_ready=true AND emergency_stop=false`.
  The API role still cannot change that control; an operator does.
- An active stop halts enqueue **and** claiming of already-queued rows.
- No duplicates: one row per destination, event and UTC hour (`UNIQUE`), at most 10
  new rows per destination per hour, and a claim older than 5 minutes is marked
  `failed/outcome_unknown` instead of being resent. Timeouts are never retried.
- Retries: Slack 429/5xx, SMTP 4xx and connection refusal back off 2, 4, 8, 16 minutes,
  maximum 5 attempts. Other failures are final.
- Targets stay encrypted at rest, are decrypted only inside the tick and are never
  returned or logged. Workers and read-only roles have no access to the new table.
- The delivery table is the audit trail (status, attempts, provider status, error code).

## Rollback

Disable the flag or set the emergency stop (immediate). The down migration refuses
while delivery history exists; export or delete it explicitly, then roll back.
