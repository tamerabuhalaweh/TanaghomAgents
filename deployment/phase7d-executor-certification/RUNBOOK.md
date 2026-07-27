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

## Future controlled deployment order

A separate reviewed production package must:

1. verify the exact approved commit and current migration `0030`;
2. verify runtime, Postiz, and GHL emergency stops are active;
3. verify no conflicting workflow IDs or credential names exist;
4. apply only migration `0031`;
5. verify the three exact adapter hashes and disabled state;
6. build/recreate only the Tanaghom dashboard with
   `AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED=false`;
7. import all four executor exports inactive and keep schedules disabled;
8. verify authentication, least-privilege database roles, private routing, and
   protected services;
9. run the credential-free certification proof;
10. stop and roll back automatically on any pre-commit failure.

Adapter enablement, runtime provider execution, polling, and live credentials
remain later, explicit UAT decisions.

## Empty-evidence rollback

Rollback is permitted only before provider-dispatch or v2 certification
evidence exists and while all four workflows remain inactive with zero
executions:

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
