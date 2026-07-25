# Phase 7D shared policy runtime runbook

Status: repository implementation and disposable validation only.
**This runbook does not authorize a production migration, credential creation,
n8n import, workflow activation, Gemma request, provider request, or customer
job.**

## Scope

The reviewed change consists of:

- migration `0030_policy_resolved_agent_runtime`;
- strict planner and executor-result contracts;
- the versioned policy-resolved planner prompt;
- an inactive shared n8n planner/authorizer export;
- an inactive fixed simulation-dispatcher export;
- disposable tenant-isolation, policy-denial, idempotency, emergency-stop,
  evidence, and least-privilege tests.

It does not modify the dashboard, Nginx, firewall, Compose, credentials,
SmartLabs, SmartCC, the voice system, production Gemma, or any provider.

## Required preflight before a future production package

1. Check out an approved 40-character commit on `main`.
2. Confirm the latest database migration is exactly
   `0029_organization_agent_studio`.
3. Confirm migration `0030` and all shared-runtime tables and roles are absent.
4. Confirm the Agent Studio runtime contains no production organization-agent
   jobs.
5. Confirm Postiz and GHL emergency stops are active and organization modes are
   manual.
6. Confirm the new runtime emergency stop will remain active after migration.
7. Confirm the two workflow exports match the reviewed Git hashes and will be
   imported inactive.
8. Confirm no shared-runtime login credential or role membership exists.
9. Complete a separately approved database backup/preflight if the production
   change owner requires it.

Stop on any mismatch. Do not rename roles, bypass the baseline, or reuse the
legacy n8n database identity.

## Repository and disposable validation

```sh
npm run generate:phase7d-workflows
npm test
npm run check
DATABASE_TEST_URL='<DISPOSABLE-POSTGRES-17-URL>' npm run test:database
```

The disposable database must start empty. The test suite applies all
migrations twice, runs the bilingual shared-runtime proof, rolls back `0030`
without crossing `0029`, verifies every Phase 7D object and role is gone, and
then completes the existing full rollback/reapply sequence.

## Future controlled installation order

The production package must perform this exact order and stop on failure:

1. read-only baseline and safety-lock preflight;
2. apply only `0030_policy_resolved_agent_runtime`;
3. verify all role, function, table, hash, grant, and default-stop assertions;
4. create separate runtime and simulation database login identities outside
   Git, then grant only their corresponding NOLOGIN role;
5. import both reviewed workflow JSON files inactive;
6. verify both have zero executions and that polling remains disabled;
7. run database-boundary probes with no Gemma or provider traffic;
8. leave the runtime emergency stop active.

Opening the runtime stop, enabling polling, importing customer jobs, activating
either workflow, or configuring executor/provider identities is a later,
explicit authorization.

## Empty-evidence rollback

Rollback is allowed only if every Phase 7D evidence table is empty and both n8n
workflows are inactive with zero executions.

```sh
export DATABASE_URL='<AUTHORIZED-PRODUCTION-DATABASE-URL>'
npm run db:rollback
unset DATABASE_URL
```

The rollback must remove only migration `0030`, its functions, tables,
triggers, and four package roles, while leaving
`0029_organization_agent_studio` current. The shared `pgcrypto` extension is
not removed because it may predate or serve other database consumers.

If any Phase 7D evidence exists, the rollback intentionally fails. Preserve
the database and prepare a reviewed forward recovery. Never delete jobs,
invocations, approvals, dependency blocks, certifications, or audit events to
force rollback.

The future deployment package must also remove only its two imported inactive
workflow IDs during an empty-evidence rollback. It must not alter existing
Phase 3–6 workflows or protected services.
