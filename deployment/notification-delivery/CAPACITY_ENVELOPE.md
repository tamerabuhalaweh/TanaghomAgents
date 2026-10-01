# Capacity envelope (fill in and sign; #46)

The operational-delivery gate needs an agreed envelope. Values below are blanks or
the current database defaults, not measured capacity. Measure on the target host
before signing.

| Item | Current default / source | Agreed value | Measured on (date, host, release) |
| --- | --- | --- | --- |
| Organizations in pilot | — | | |
| Inbound conversation events per hour (peak) | — | | |
| Interactive backlog alert threshold | 100 (`conversation_capacity_policies.interactive_backlog_threshold`) | | |
| Queue-age warning | 120 s (`queue_age_warning_seconds`) | | |
| Max conversation concurrency | `conversation_capacity_policies` | | |
| Max model claims per minute | `conversation_capacity_policies` | | |
| Max GHL actions per minute | `conversation_capacity_policies` | | |
| Dashboard p95 page load / API latency target | — | | |
| Database size and free disk headroom | — | | |
| Backup frequency / restore time objective | — | | |
| Alert channels and recipients | Settings → Notifications | | |
| Alert rate cap per destination | 10 per hour, 1 per event per hour (ADR 0020) | | |
| Who responds to `critical` and within what time | — | | |

Required alert events tested (tick both): ☐ dependency_cooldown ☐ dead_letter ☐ indeterminate_action ☐ queue_age ☐ interactive_backlog

Not covered by this worker (needs an external watchdog): worker_unready, database_unavailable.

Agreed by (customer): ______________ Date: ________
Operated by (Tanaghom): ______________ Date: ________
