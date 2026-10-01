# Alert delivery acceptance kit (#46 / #55)

Goal: earn the scorecard gate **"Operational delivery #46/#55"**: an agreed
capacity envelope plus tested required alerts. Saving a destination alone is not
delivery. Design and safety: [ADR 0020](../../docs/architecture/0020-notification-delivery-worker.md).

## Inputs the team supplies

- One test email inbox and/or one Slack channel incoming webhook (owner saves it in
  Settings → Notifications; it is encrypted and masked).
- For email: `NOTIFICATION_SMTP_URL` (`smtps://…`) and `NOTIFICATION_EMAIL_FROM` in the
  dashboard runtime secret store. Never in Git or chat.
- `NOTIFICATION_WORKER_TOKEN` (≥32 random characters) in the same secret store.
- The signed [capacity envelope](CAPACITY_ENVELOPE.md).

## Steps on the staging/test deployment

1. Deploy the reviewed release including migration `0036`; record commit and migration.
2. Owner saves the test destination(s), selects `dependency_cooldown`, minimum `warning`.
3. Operator sets `NOTIFICATION_DELIVERY_ENABLED=true`, restarts the dashboard, then
   clears the stop for this window only, recording actor, time and reason:
   `UPDATE tanaghom.notification_delivery_controls SET runtime_ready=true, emergency_stop=false, reason='Alert acceptance window <date> <operator>';`
4. Raise one controlled condition on the **test organization only**, e.g. a 30-minute
   Gemma cooldown row in `tanaghom.conversation_dependency_cooldowns` with reason
   `Alert acceptance test`.
5. Trigger one tick: `curl -fsS -X POST -H "Authorization: Bearer $NOTIFICATION_WORKER_TOKEN" https://<dashboard>/api/internal/notifications/deliver`.
   Expect `enqueued` ≥ 1 and each result `sent`.
6. Confirm receipt in the inbox/channel (screenshot without the webhook URL).
7. Trigger a second tick: expect `enqueued: 0` and no second message (dedupe).
8. Remove the test cooldown row, set `emergency_stop=true` again, and confirm a third
   tick returns `claimed: 0`. Optionally set the flag back to `false`.
9. Evidence file `docs/evidence/<date>-alert-delivery.md`: commit, migration, channels,
   tick outputs, screenshots, the delivery rows
   (`SELECT channel-free fields: event_type,severity,status,attempts,provider_status,sent_at`),
   restored stop, owner and the signed capacity envelope. Then update the gate row.

## Scheduling (later, separately approved)

A recurring tick (cron or an n8n schedule calling the route every minute) is a
separate activation decision; this kit uses manual ticks only.

## Failure and rollback

Any unexpected send, duplicate or leaked target: set `emergency_stop=true`
immediately and open an incident on #55. Source rollback: revert the PR; the 0036
down migration refuses while delivery history exists (export/delete it first).
