# 0008 — Supervised conversation ownership and reply leases

## Decision

Tanaghom stores one authoritative conversation row per organization and GHL
conversation. Its state and reply authority are separate but constrained:

- `human_owned` always grants reply authority to exactly one active human;
- `ai_owned` permits only an expiring AI lease;
- queued, approval, required-human, paused, resolved, and failed states grant no
  reply authority.

Every ownership command locks the conversation row, verifies an optimistic
`conversation_version`, increments an `ownership_epoch`, clears incompatible
leases, and records an immutable transition with actor, prior/new state,
prior/new authority, reason, time, and result version. A UUID command receipt
makes duplicate clicks and reconnect retries idempotent.

## Dispatch boundary

Phase 5D performs no provider send. It stores supervised human reply drafts and
creates no GHL message operation. Phase 5E must:

1. claim an expiring AI lease for the current ownership epoch;
2. prepare a bounded provider operation;
3. call `assert_conversation_ai_reply_authority()` in the final database
   transaction immediately before provider dispatch;
4. stop without sending if the lease, epoch, conversation stop, organization
   stop, or platform stop changed.

A human takeover increments the epoch and clears the token, so queued AI work
cannot retain send authority. Clearing an organization emergency stop never
silently returns paused conversations to AI; each conversation requires an
explicit, reasoned `resume_ai` command.

## Supervisor model

The owner, operator, and reviewer roles can acquire supervised ownership.
Assignment, reassignment, pausing, organization emergency control, and return
to AI remain owner/operator controls; organization emergency control is owner
only. Reviewers may resolve only conversations they currently own. Viewers are
read-only. Every lookup and assignee validation is organization-bound.

The inbox combines SLA age, priority, language, intent, risk, campaign,
pipeline stage, handoff summary, suggested response, and current assignee. The
timeline combines authenticated provider messages, grounded AI proposals and
citations, ownership transitions, supervised drafts, operations, and failures.

## Notifications and recovery

Urgent, SLA-breached, failed, and high-value conversations produce deduplicated
supervisor notifications. Lost leases expire, reconnects reuse the original
command receipt, and stale UI mutations fail with a version conflict. Stuck
authority is recovered by an audited human takeover or emergency pause—not by
editing the ownership row directly.
