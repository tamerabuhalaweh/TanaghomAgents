# Agent Registry operating contract

## Purpose

The Agent Registry is the customer-facing inventory of Tanaghom business roles
and their specialized n8n workers. It solves three separate questions without
giving the browser access to n8n:

1. What business responsibility does each agent own?
2. Which versioned workers are shipped, imported, active, and scheduled?
3. What live job or exact readiness condition requires attention?

PostgreSQL is the dashboard source of truth. n8n remains a private execution
engine and cannot activate itself or be controlled from the Agents page.

## Current reconciled inventory

| Business role | Specialized worker | Release | Production snapshot | Trigger boundary |
| --- | --- | --- | --- | --- |
| Campaign Strategist | Campaign Strategy Generator v1 | Available | Imported, inactive | Schedule contained only by inactive workflow |
| Content Producer | Campaign Content Generator v1 | Available | Imported, inactive | Schedule contained only by inactive workflow |
| Publisher & Performance Monitor | Postiz Draft Publisher v1 | Available | Imported, inactive | Polling disabled |
| Publisher & Performance Monitor | Postiz Performance Monitor v1 | Available | Not imported | Polling disabled |
| Sales & CRM Agent | GHL Contact Sync v1 | Available | Not imported | Polling disabled |
| Sales & CRM Agent | Governed GHL Actions v1 | Available | Not imported | Polling disabled |
| Sales & CRM Agent | Quality Shadow Evaluator v1 | Available | Imported, inactive | Polling disabled |

The snapshot was reviewed on 2026-07-19 after PR #83. It is evidence with a
timestamp, not a claim that the dashboard is polling n8n in real time.

## State meanings

- **Release available**: the secret-free, versioned export exists in Git and
  passed its repository validation.
- **Not imported**: the export is not in the last verified production n8n
  inventory.
- **Imported, inactive**: n8n contains the workflow, but its activation switch
  is off and it cannot schedule executions.
- **Active**: a controlled platform deployment verified the workflow active.
- **Polling disabled**: the schedule trigger itself is disabled even if the
  workflow is later activated.
- **Schedule contained by inactive workflow**: the schedule node is enabled in
  the export, so activating the workflow would also start polling. Phase 3
  activation therefore requires an explicit schedule decision.

Customer owners control business policies and emergency stops. They do not
directly change n8n import, activation, or schedule state.

## Runtime update procedure

Runtime evidence may change only through a reviewed, Tanaghom-only deployment:

1. Confirm the Git commit and immutable workflow export checksum.
2. Export the existing n8n workflow inventory as recovery evidence.
3. Import the target workflow inactive.
4. Verify its stable name, nodes, credentials-by-reference, inactive state, and
   schedule state.
5. Apply a new database migration updating `runtime_state`, `trigger_state`,
   `runtime_verified_at`, and `runtime_evidence` for that worker.
6. Validate the private gateway, database role, provider policy, emergency
   controls, and exact blockers before any activation.
7. Activate only the separately authorized worker and update registry evidence
   in the same controlled release.
8. On failure, deactivate/restore n8n first, then roll back the registry
   migration so the dashboard never advertises a state that was not achieved.

Do not edit production registry rows ad hoc. Future changes use a new migration
and update `config/agent-registry.v1.json` so Git remains the recovery source.

## Live jobs and tenant boundary

The operations API shows recent jobs only when they belong to the signed-in
organization through a campaign or an explicit organization identifier. GHL
action jobs and quality shadow jobs use their own organization-scoped queues
and are normalized into the same read-only dashboard contract.

A content generation job marked `waiting_approval` while its campaign has zero
pending decisions is labelled **reconciliation required**. The dashboard does
not silently mark it complete; an operator must run the existing controlled
completion function so the immutable audit evidence is preserved.

## Safety boundary

- Registry tables are read-only to `tanaghom_api` and `tanaghom_readonly`.
- n8n and conversation workers receive no registry access.
- No credential values, n8n credential IDs, provider tokens, or customer data
  are stored in the registry.
- The page provides evidence and next actions; it has no workflow activation
  button and makes no provider call.
- This change is Tanaghom-only and does not access SmartLabs, SmartCC, or the
  production voice-agent runtime.
