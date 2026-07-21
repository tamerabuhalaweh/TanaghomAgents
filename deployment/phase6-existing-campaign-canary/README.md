# Phase 6 existing-campaign core-agent canary

This secret-free recovery package advances exactly one customer-created `.test` campaign that already has exactly one reviewed, queued strategist job. It does not create a campaign, insert an agent job directly, activate schedules, publish content, contact a lead, create a CRM record, or spend money.

The approved production identity is supplied at execution time and must include the exact campaign UUID, exact queued strategy-job UUID, exact `.test` name, requested content count, production commit, and reviewed package commit. Preflight refuses all competing claimable core work.

The run is sequential:

1. prove the exact existing campaign/job and all safety locks;
2. temporarily publish Campaign Strategist with its schedule disabled and execute it once;
3. immediately unpublish it;
4. use the existing dashboard database-owner connection to invoke only the
   `SECURITY DEFINER` `tanaghom.queue_campaign_content(uuid,uuid)` function
   after proving the exact function owner and least-privilege grants;
5. temporarily publish Content Producer with its schedule disabled and execute it once;
6. immediately unpublish it;
7. restore both original reviewed definitions inactive;
8. stop with every generated draft pending authenticated human approval.

The content contract currently promises no more than the requested count. The package therefore accepts 1..N drafts, records whether the requested target was fulfilled, and requires a human decision for every generated draft. A shortfall remains visible evidence and does not get represented as target fulfillment.

Execution is not authorized by this package or its merge. See `RUNBOOK.md` for the separate read-only preflight, execution, human-verification, and rollback gates.

The production dashboard secret currently connects as the non-superuser
database owner, not as a login member of the NOLOGIN `tanaghom_api` group role.
The package therefore refuses to impersonate that unavailable role. The
privileged call is root-operated, separately authorized, exact-campaign bound,
transactional, and limited to the same governed function used by the dashboard.
It does not change grants, role membership, or credentials. Moving the dashboard
to a dedicated login that inherits `tanaghom_api` remains a separate hardening
task and is not silently represented as complete here.

If an interrupted run has already persisted the exact authorized strategy but has not created a content job, `resume-preflight.sh` and `resume-after-strategy.sh` provide a separate fail-closed Content Producer-only path. The resume refuses claimable/running competing work and proves the Strategist execution count does not change.
