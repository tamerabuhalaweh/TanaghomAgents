# Phase 6 UAT runtime correction

This package corrects two blockers discovered by the first live bilingual UAT:

1. the Campaign Strategist's dynamic cadence schema was invalid for the
   Gemma vLLM/xgrammar structured-output boundary; and
2. n8n cannot start a published workflow whose only schedule is disabled.

The package updates only Tanaghom workflow definitions and Agent Registry
runtime evidence. It enables all eight reviewed schedules behind the existing
database platform stops, customer policy locks, credential/channel gates, and
human approvals. It does not activate provider business authority.

It does not modify or operate SmartLabs, SmartCC, voice, Gemma, Nginx, firewall,
Compose, container images, credentials, database migrations, or customer data.
Gemma recovery remains a separate SmartLabs-owner action.

See [RUNBOOK.md](RUNBOOK.md) for preflight, deployment, validation, and safe
rollback.
