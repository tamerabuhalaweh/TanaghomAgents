# 0010 — Measured conversation capacity and backpressure

## Decision

Tanaghom treats capacity as a measured operating envelope, not a promised lead
count. The customer's occasional high-volume examples do not establish a fixed
75,000-lead SLA. Every envelope must identify the workload shape, environment,
worker count, provider/model conditions, latency percentiles, queue behavior,
error outcomes, and storage growth that produced it.

Migration `0018_conversation_capacity_backpressure` introduces organization
capacity policy, deterministic priority metadata, bounded concurrent claims,
per-minute model and GHL action dispatch limits, dependency cooldowns, and a
read-only capacity status view. It does not start a worker or enable a provider.

## Priority and admission

Authenticated inbound events remain durable even during overload. Backpressure
therefore limits claims, never webhook acceptance:

- DND changes are `urgent` with priority 120;
- inbound messages are `interactive` with priority 100;
- unread-conversation notifications are `interactive` with priority 80;
- contact updates and other supported system events are `background` with
  priority 20.

The event classifier copies immutable workload metadata into the associated job
when the job is created. An indexed job queue can then choose the oldest highest
priority eligible work without rescanning the whole event payload table. Under
backlog, interactive work drains before background work. No priority changes
organization identity, consent, ownership, or approval requirements.

## Concurrency and rate decisions

Claims serialize only the organization capacity decision with a transaction
advisory lock. This prevents simultaneous workers from exceeding the configured
in-flight limit while preserving `SKIP LOCKED` job ownership. Separate limits
bound conversation/model claims and GHL actions per minute.

Recognized model pressure (`gemma_rate_limited`, `gemma_unavailable`, or
`gemma_overloaded`) creates a bounded Gemma cooldown. A retryable GHL `429`
creates a bounded GHL cooldown. New matching claims stop until `blocked_until`
and resume automatically afterward; operators do not edit queue rows. Provider
timeouts remain indeterminate under the Phase 5E policy and are not blindly
retried.

## Visibility and alerts

`tanaghom.conversation_capacity_status` exposes only organization-scoped counts,
limits, cooldown timestamps, and a derived state. It contains no message body,
credential, or provider token. The committed alert specification covers:

- queue age and interactive backlog;
- saturated conversation or GHL action concurrency;
- active Gemma/GHL cooldowns;
- dead letters and indeterminate actions.

The dashboard/API role can read policy and status and only an accepted active
organization owner can change policy through the controlled function. Workers
have no direct table access.

## Evidence boundary

`scripts/conversation-capacity-integration.mjs` creates synthetic events in a
disposable database, proves the atomic concurrency cap, model cooldown/recovery,
stale-claim recovery with the same job identity, and drains a 10,000-event
campaign-shaped backlog. CI publishes
`phase5.conversation-capacity-evidence.v1` with throughput, p50/p95/p99 latency,
outcomes, tenant mismatches, and database growth.

The artifact proves only the tested disposable environment. It performs zero
Gemma, GHL, WhatsApp, Postiz, or SmartLabs calls and cannot establish production
provider or shared-GPU capacity.

## Remaining Phase 5F gates

- burst and soak profiles with representative conversation turn distributions;
- real provider throttle headers and quota budgets in customer staging;
- approved Gemma slowdown and shared-GPU measurement while SmartLabs health is
  observed read-only;
- Redis/n8n restart, dead-letter replay, backup/restore under backlog, and
  production monitoring delivery;
- reviewed retention/pruning thresholds based on measured customer traffic.
