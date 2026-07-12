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

The Phase 2 dashboard lives in `apps/dashboard` and uses fixture data until the
authenticated API adapter is introduced.

```bash
npm install
npm run dev:dashboard
npm run typecheck:dashboard
npm run build:dashboard
```

The n8n editor is an engineering console and is not the customer-facing product.
