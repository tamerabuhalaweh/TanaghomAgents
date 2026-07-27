# Phase 7D fixed executor and canonical certification runbook

Status: repository implementation and disposable validation only.

This runbook does not authorize production migration, n8n import or activation,
credential creation, Gemma traffic, provider traffic, firewall/Nginx changes,
or customer-data execution. It does not touch SmartLabs, SmartCC, voice, or
other server workloads.

## Package

- migration `0031_policy_runtime_executors_certification`;
- fixed, inactive read, proposal, action, and runtime-finalizer n8n exports;
- authenticated, fail-closed private Agent Studio provider gateway;
- canonical seven-scenario-per-language certification;
- disposable two-agent, bilingual, 28-scenario evidence;
- exact rollback to migration `0030_policy_resolved_agent_runtime`.

All three executor adapters default disabled. Every schedule trigger is
disabled and every workflow export is inactive.

## Repository validation

Use a clean disposable PostgreSQL 17.6 database:

```sh
npm ci
npm run db:migrate
psql "$DATABASE_TEST_URL" -X -v ON_ERROR_STOP=1 \
  -f packages/database/seeds/staging.sql
npm run generate:phase7d-workflows
npm run generate:phase7d-executors
git diff --exit-code -- n8n/workflows/phase7d
npm run test:phase7d-executor-import
npm run test:phase7d-certification
npm run test:database
npm test
npm run typecheck:dashboard
npm run build:dashboard
npm run check
```

Required certification evidence:

- two bilingual disposable agent versions;
- exactly 14 scenarios per agent and 28 total;
- success, refusal, escalation, prompt injection, provider failure, duplicate
  retry, and emergency stop in English and Arabic;
- tampered certification evidence rejected;
- adapter registry disabled;
- zero provider dispatches, provider references, external actions, and cost.

## Prepared controlled deployment order

The separately reviewed
`deployment/phase7d-runtime-production-update` package must:

1. verify the exact approved commit and current migration `0029`;
2. verify runtime, Postiz, and GHL emergency stops are active;
3. verify no conflicting Phase 7D workflow or credential IDs exist;
4. apply only migrations `0030` and `0031`, in that order;
5. verify the three exact adapter hashes and disabled state;
6. build/recreate only the Tanaghom dashboard with
   `AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED=false`;
7. provision four mutually isolated database logins and import their encrypted
   n8n credentials;
8. import the runner, simulation dispatcher, three executors, and finalizer
   inactive with all schedules disabled;
9. verify authentication, least-privilege roles, private routing, zero
   executions, n8n audit, and protected services;
10. stop and roll back automatically on any pre-commit failure.

Adapter enablement, runtime provider execution, polling, and live credentials
remain later, explicit UAT decisions.

## Empty-evidence rollback

Rollback is permitted only before runtime, provider-dispatch or v2
certification evidence exists and while all six workflows remain inactive
with zero executions:

```sh
export DATABASE_URL='postgresql://...'
npm run db:rollback
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c \
  "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;"
```

The result must be exactly `0030_policy_resolved_agent_runtime`. If migration
`0031` refuses rollback, preserve the evidence and use a separately reviewed
forward recovery. Never delete jobs, runs, invocations, certifications, or
runtime events to force rollback.
