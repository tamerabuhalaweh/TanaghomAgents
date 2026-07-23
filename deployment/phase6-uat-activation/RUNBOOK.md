# Controlled all-agent UAT activation runbook

## Purpose

The customer needs to test Tanaghom as an operating agent platform rather than
an operator-driven demonstration. This package activates automatic polling for
the two credential-independent campaign workers and makes all six remaining
reviewed workers available in their fail-closed UAT modes.

The package is pinned to:

- application database migration `0025_runtime_agent_reconciliation`;
- n8n `2.26.8`;
- release source commit supplied as an exact 40-character Git SHA;
- production dashboard commit
  `a25a24d2cb4cb8a8f2a231fb1d25ed682bf5f341`; and
- the already reviewed Squid-only production worktree diff hash.

## Resulting activation matrix

| Worker | n8n state | Schedule | Business authority |
| --- | --- | --- | --- |
| Campaign Strategist | published | one minute | internal strategy generation |
| Content Producer | published | one minute | internal draft generation; human approval remains mandatory |
| Postiz Draft Publisher | published | disabled | manual approved-content draft only; platform stop remains active |
| Postiz Performance Monitor | published | disabled | unavailable until a mapped staging channel exists |
| GHL Contact Sync | published | disabled | unavailable until a customer staging GHL connection exists |
| Conversation Intelligence | published | disabled | proposal-only; unavailable while CRM processing is paused |
| Governed GHL Actions | published | disabled | manual/assisted only; proactive messaging and platform action remain stopped |
| Quality Shadow Evaluator | published | disabled | no external action; unavailable until a reviewed baseline exists |

The Agent Registry therefore distinguishes a published workflow from an enabled
background trigger. Provider/customer blockers remain visible and truthful.

## Preflight refusal conditions

The deployment refuses unless:

- the explicit owner authorization and unique release ID are supplied;
- the isolated release checkout is clean and at the expected source commit;
- the production dashboard checkout and reviewed dirty diff are unchanged;
- the database is exactly at migration `0025_runtime_agent_reconciliation`;
- n8n main, worker, PostgreSQL, Redis, and egress proxy are healthy and n8n is
  exactly `2.26.8`;
- the five expected workflows are present once, inactive, and unarchived;
- the three expected workflows are absent;
- all provider emergency stops are active;
- Postiz remains manual, GHL remains paused/manual with proactive messaging
  disabled, and quality rollout remains at baseline;
- no Tanaghom provider job, inbound event, external operation, quality job, or
  GHL action job exists;
- no core generation job is claimable; and
- the workflow contracts and credential references match the reviewed exports.

## Static validation

From the repository root:

```sh
deployment/phase6-uat-activation/scripts/validate-package.sh
deployment/phase6-uat-activation/scripts/test-disposable-n8n-lifecycle.sh
```

The lifecycle test uses pinned disposable n8n and PostgreSQL images. It proves
the five-workflow baseline, three imports, eight publications, core-only
schedule state, complete unpublication, exact five-workflow restoration, and
package-owned removal of the three newly imported workflows.

## Controlled deployment

Run only from the clean isolated release checkout on the GPU server:

```sh
export TANAGHOM_UAT_ACTIVATION_AUTHORIZATION=ACTIVATE-REVIEWED-TANAGHOM-UAT-WORKERS
export TANAGHOM_UAT_ACTIVATION_ID=uatactivation-YYYYMMDDTHHMMSSZ
export TANAGHOM_EXPECTED_RELEASE_COMMIT=<approved-40-character-commit>
sudo -E deployment/phase6-uat-activation/scripts/deploy-activation.sh
```

The deployment:

1. repeats the full preflight;
2. creates a root-only evidence directory;
3. exports only the five pre-existing Tanaghom workflows;
4. captures the exact Agent Registry restoration SQL and n8n inventory;
5. imports all eight reviewed exports inactive;
6. publishes all eight by exact ID;
7. restarts only the two existing n8n application containers so published
   trigger state is loaded; container recreation is forbidden;
8. records core workers as `active/enabled` and all other published workers as
   `active/disabled`;
9. runs `n8n audit`; and
10. validates the public boundary, workflow state, registry, locks, container
    identity, and zero provider activity.

No Compose, image pull, firewall, Nginx, database migration, credential, or
customer-data operation occurs.

## Validation after deployment

```sh
export TANAGHOM_UAT_ACTIVATION_ID=uatactivation-YYYYMMDDTHHMMSSZ
export TANAGHOM_EXPECTED_RELEASE_COMMIT=<approved-40-character-commit>
sudo -E deployment/phase6-uat-activation/scripts/validate-release.sh
```

Expected customer-visible result:

- Campaign Strategist and Content Producer show active with no workflow or
  polling blocker.
- Publisher and Sales roles show the exact remaining customer/provider gates.
- No content is published and no lead is contacted.

## Exact rollback

Rollback is allowed only while no provider activity, inbound event, quality
job, GHL action job, or newly imported workflow execution exists:

```sh
export TANAGHOM_UAT_ACTIVATION_AUTHORIZATION=ACTIVATE-REVIEWED-TANAGHOM-UAT-WORKERS
export TANAGHOM_UAT_ACTIVATION_ID=uatactivation-YYYYMMDDTHHMMSSZ
export TANAGHOM_EXPECTED_RELEASE_COMMIT=<approved-40-character-commit>
export TANAGHOM_UAT_ROLLBACK_AUTHORIZATION=ROLLBACK-AUTHORIZED-TANAGHOM-UAT-ACTIVATION
sudo -E deployment/phase6-uat-activation/scripts/rollback-activation.sh
```

Rollback:

1. unpublishes the eight exact workflow IDs;
2. restarts only n8n main and worker;
3. reimports the five root-only pre-deployment workflow exports inactive;
4. removes only the three package-imported, inactive, zero-execution workflow
   rows;
5. restores every Agent Registry runtime field exactly; and
6. verifies the prior five-inactive/three-absent inventory and public boundary.

If provider/customer testing begins after this release, this automatic rollback
must not be used. A separately reviewed reconciliation is required so accepted
work and provider outcomes are preserved.

## Continuation gates

This deployment intentionally does not complete the live-provider acceptance:

- Postiz requires a mapped supported business staging channel before its
  schedule and platform stop can be changed.
- GHL requires a customer staging connection, webhook configuration, approved
  test contact, channel allowlist, and bounded action window.
- Quality requires a reviewed de-identified English/Arabic baseline and owner
  approval to enter shadow stage.

Those are continuation steps under Issue #125, not hidden failures in this
package.
