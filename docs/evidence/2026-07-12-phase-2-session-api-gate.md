# Phase 2 session and API gate — 2026-07-12

## Result

Issue #13's remaining session lifecycle and disposable API integration gates
passed. PR #22 merged as commit
`8b5295edbf6b0a9958604e193896eac9fa00a37a` and that exact commit was deployed
to the existing SSH-only dashboard canary.

No database migration, public ingress, Nginx, DNS, n8n workflow, Gemma, voice
agent, or protected SmartLabs configuration was changed by this deployment.

## Automated acceptance evidence

GitHub Actions run `29203070071` passed all five required jobs:

- repository contract;
- disposable database migration and rollback contract;
- dashboard type check, dependency audit, and production build;
- pinned dashboard image build; and
- production Next.js HTTP integration against disposable PostgreSQL and a
  disposable Supabase-compatible JWT issuer.

The API integration job proved:

- password login and HttpOnly access/refresh cookies;
- access-token expiry and refresh-token rotation;
- successful authorization with the rotated access token;
- idempotent approval replay without duplicate facts;
- conflicting idempotency-key reuse rejection;
- stale approval rejection with reservation rollback;
- exactly one approval, audit action, outbox event, and completed idempotency
  record for a successful decision;
- complete transaction rollback when outbox insertion fails; and
- invalid refresh rejection with both session cookies cleared.

## Canary evidence

- Git commit: `8b5295edbf6b0a9958604e193896eac9fa00a37a`.
- Image: `sha256:20b15f0c2e218f09ebfe6c56f533b874b6c9f7fd1f721441ee225fbd7d69c3dd`.
- Container health: `healthy`.
- Application health: API `ready`, authentication `configured`, database
  `connected`.
- Unauthenticated operations request: HTTP 401.
- Missing refresh-token request: HTTP 401 with both session cookies cleared.
- Observed dashboard usage: 42.38 MiB of 768 MiB; 11 PIDs.
- Exact rollback image tag:
  `tanaghom-dashboard-canary:rollback-248c14f41bd02be61498fbaccf447352f2996102`.

All nine protected systemd units remained active. All five n8n containers
(main, worker, PostgreSQL, Redis, and egress proxy) remained healthy.
