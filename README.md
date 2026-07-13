# Tanaghom Agents

Tanaghom Agents is an autonomous content-to-sales business operations platform.

It combines a human-facing operations dashboard with n8n workflows, PostgreSQL,
Gemma, Postiz, and GoHighLevel. AI agents prepare and execute bounded business
work while a human remains the required approval gate for public content.

## Product principles

- AI prepares; humans approve publishing.
- PostgreSQL is the source of truth.
- Every meaningful agent action is auditable.
- External writes are idempotent and retry-safe.
- Credentials never live in workflow exports or source control.
- New integrations begin in staging and cannot spend money or contact real leads
  until explicitly enabled.

## Planned agents

1. Campaign Strategist
2. Content Producer
3. Publisher and Performance Monitor
4. Sales and CRM Agent

The platform also includes a dedicated human approval dashboard, campaign
workspace, agent activity view, publishing calendar, lead pipeline, reporting,
notifications, and system-health surfaces.

See [the delivery roadmap](docs/ROADMAP.md) for phases, acceptance gates, and
external decisions.

## Dashboard development

The Phase 2 dashboard lives in `apps/dashboard`. Its operational screens use
authenticated, server-side API adapters backed by the `tanaghom` PostgreSQL
schema; no sample business records are presented as live work.

```bash
npm install
npm run dev:dashboard
npm run typecheck:dashboard
npm run build:dashboard
```

The n8n editor is an engineering console and is not the customer-facing product.

The authenticated dashboard canary is available at
[tanaghom.38-247-187-232.sslip.io](https://tanaghom.38-247-187-232.sslip.io/).
The public virtual host proxies only the dashboard; n8n and webhook ingress
remain private.

## Reconciliation status

The original local Groky implementation was audited before Phase 2 integration.
Its secret-free source is retained in `archive/legacy-v0` for recovery and
requirements traceability, but it is not compatible with the authoritative
Phase 1 schema and must not be deployed. See
[`docs/reconciliation/GROKY_V0_AUDIT.md`](docs/reconciliation/GROKY_V0_AUDIT.md).

Before any migration against an existing environment, validate catalog access
without writes:

```bash
npm run db:inspect:readonly
```
