# Tanaghom Agents

Tanaghom Agents is a human-governed AI organization platform. Sales, content,
and marketing are the initial pilot, with a versioned roadmap for additional
departments rather than a permanent limit on the product.

It combines a human-facing operations dashboard with n8n workflows, PostgreSQL,
Gemma, Postiz, and GoHighLevel. AI agents prepare and execute bounded business
work while a human remains the required approval gate for public content.

## Start here

- [Current status, evidence dates, blockers and next work](docs/STATUS.md)
- [Developer onboarding and authoritative project-context rules](docs/PROJECT_CONTEXT.md)
- [AI organization expansion plan and issue ownership](docs/planning/agency-expansion/README.md)
- [Complete 273-profile future agent catalog](docs/planning/agency-expansion/CATALOG.md)

The expansion is planning-only. Catalogued profiles are not imported, tested,
available or active agents. GitHub records engineering decisions and source;
PostgreSQL remains the operational business-state authority.

## Product principles

- AI prepares; humans approve publishing.
- PostgreSQL is the source of truth.
- Every meaningful agent action is auditable.
- External writes are idempotent and retry-safe.
- Credentials never live in workflow exports or source control.
- New integrations begin in staging and cannot spend money or contact real leads
  until explicitly enabled.

## Initial business roles

1. Campaign Strategist
2. Content Producer
3. Publisher and Performance Monitor
4. Sales and CRM Agent

These four role groupings are not the complete worker inventory. The repository
contains eight specialized business workflows and six shared Agent Studio
runtime workflows, plus versioned Skills and organization-agent configuration.
See [workflow documentation](n8n/workflows/README.md). Imported/active runtime
state and live-provider acceptance must be verified separately from exports.

Customer surfaces include campaign, approval/content, agent activity,
supervision, lead, reporting, notification configuration and system-health
workspaces. A configured notification destination is not proof of active
delivery; see the limitations in the current status document.

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

## Browser testing

Playwright and its Chromium browser are installed locally with pinned repository
versions. The default suite is credential-free and verifies the login, health,
redirect, and protected Agent Studio API boundaries.

```bash
npm run test:e2e:install
PLAYWRIGHT_BASE_URL=https://tanaghom.38-247-187-232.sslip.io npm run test:e2e
```

In PowerShell, set the URL for the current process before running the suite:

```powershell
$env:PLAYWRIGHT_BASE_URL = "https://tanaghom.38-247-187-232.sslip.io"
npm run test:e2e
```

Future authenticated tests may use `PLAYWRIGHT_STORAGE_STATE` pointing to a
local state file under `playwright/.auth/`. That directory is ignored by Git;
browser session cookies and credentials must never be committed.

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
