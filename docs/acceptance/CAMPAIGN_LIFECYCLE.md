# Tanaghom campaign lifecycle

Issue: [#100](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/100)
Parent: [#3](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/3)

## Customer journey

Tanaghom now defines one controlled campaign path:

1. An accepted, active owner or operator creates a campaign draft from `/campaigns`.
2. The customer reviews the saved brief and explicitly starts Strategy.
3. PostgreSQL creates one versioned `campaign.strategy.generate` job for Campaign Strategist.
4. When the reviewed worker is active, n8n claims the job and persists the strategy through the existing least-privilege worker function.
5. The customer reviews the strategy and explicitly requests a bounded content batch.
6. PostgreSQL creates one versioned `campaign.content.generate` job for Content Producer.
7. Content Producer persists drafts as `pending_approval`; it cannot approve them.
8. A human owner or reviewer approves or rejects every draft.
9. An owner or operator explicitly marks the reviewed campaign ready for downstream handoff.
10. Approved drafts remain in the Content Library. Campaign creation, core-agent work, and the ready transition do not call a provider.

## Authoritative states and next actions

| Campaign state | Customer meaning | Available next action |
| --- | --- | --- |
| `draft` | The brief is saved; no core job is open | Start Strategy or edit the brief |
| `draft` + open strategist job | Strategy is durably queued or running | Wait and refresh; duplicate jobs are prevented |
| `blocked_missing_info` | Strategist requires verified information | Revise the brief, then retry Strategy |
| `strategy_ready` | A persisted strategy is available | Review it, then generate a bounded draft batch |
| `strategy_ready` + open content job | Content is durably queued or running | Wait and refresh |
| `awaiting_approval` | Drafts require human decisions | Open Approvals and decide each draft |
| `awaiting_approval` with no pending drafts | Human review is complete | Explicitly mark ready for handoff |
| `active` | Core work is complete | Review approved items in the Content Library |
| `paused` | New work is stopped | Owner policy review is required before resume |
| failed core job | The attempt and error are retained | Authorized operator may request a controlled retry |

The campaign detail page retains the brief, latest strategy, complete draft copy, approval evidence, job attempts, errors, timestamps, and immutable audit entries.

## Authorization and data boundaries

- Owner/operator: create, revise, start Strategy, start Content, and mark ready.
- Owner/reviewer: make human content decisions and reconcile the reviewed content job.
- Reviewer/viewer: read organization-bound campaign details; they cannot initiate work.
- `tanaghom_api`: execute only the reviewed SECURITY DEFINER lifecycle functions; it has no direct campaign/job/content table-write privileges.
- `tanaghom_n8n_worker`: claim and complete supported core jobs only; it receives no campaign-creation or approval privilege.
- Every read and mutation is bound to the authenticated user's active, accepted organization membership.
- Accepted mutations use API idempotency reservations plus a unique partial database index for open core jobs.

## n8n boundary

Campaign Strategist and Content Producer remain the only n8n workers in this lifecycle. The dashboard records customer intent; PostgreSQL owns the durable job and state; n8n performs the reviewed worker step; PostgreSQL validates and persists the result.

Workflow activation is a platform deployment decision, not a customer dashboard control. A queued job remains visible and durable when a workflow is inactive. Importing or activating the two workers requires a separate, reversible production package and explicit approval.

## Provider boundary

Campaign creation, Strategy, Content, and the ready transition do not call Postiz, GHL, WhatsApp, social channels, voice, or any other external provider. Marking a campaign ready does not publish, contact a lead, send a message, or spend money. It only records that the human-reviewed core work is ready for a later explicit, governed handoff.

The existing organization-level Postiz policy still governs what happens when a human approves content. The provider-free core canary therefore requires Postiz mode `manual` and the platform emergency stop active; these values are verified before the canary. Testing or changing that separate handoff policy is outside #100.

## Validation and rollout gate

Before the issue can close:

- migration `0023_campaign_lifecycle` must pass disposable PostgreSQL apply, rollback, and clean reapply;
- role, tenant, idempotency, lifecycle, audit, and zero-provider-side-effect tests must pass;
- dashboard component, API integration, type, repository, and production-build checks must pass;
- the migration and dashboard must be deployed through a separately approved Tanaghom-only package;
- only Campaign Strategist and Content Producer may be activated for the canary;
- one dashboard-created, zero-budget `.test` campaign must complete brief → strategy → drafts → human approval with no provider action.

Full Postiz/GHL handoff UAT remains paused until that canary evidence is attached to #100.
