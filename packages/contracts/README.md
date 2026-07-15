# Contracts package

Shared schemas for API payloads, agent jobs, transactional events, and validated
LLM outputs.

Phase 3 v1 contracts live under `schemas/phase3`. They are strict, versioned,
secret-free boundaries for the Strategist and Content Producer. Prompt text is
stored once under `/prompts`; n8n exports must reference the committed prompt
version and may not embed a divergent copy.

Phase 4 contracts live under `schemas/phase4`. Performance responses normalize
Postiz's platform-dependent labels into durable metric keys and dated values.
Lead ingestion must resolve to an organization, campaign, and source post or be
recorded as quarantined; ambiguous provider events may not silently create
unattributed leads.

Phase 5 contracts begin with a customer-owned GoHighLevel contact-upsert
boundary. The job identifies an organization-scoped lead and monotonic sync
version; the result records only the authorized location, provider contact
reference, and whether HighLevel created or updated the contact. No message,
sequence, or free-form outreach content is part of this contract.

Phase 5B adds a normalized GHL webhook event, a metadata-only durable job, and
a no-external-action processing result. Provider bodies are treated as
untrusted input, reduced to bounded supported fields, and never authorize a
message, appointment, opportunity update, or other provider action.

Phase 5C adds an event-bound conversation-intelligence request, a grounded
proposal output with active source/version citations, and a reproducible
bounded summary contract. Customer messages and context remain untrusted;
invalid output, missing approved knowledge, low confidence, and sensitive
categories fail closed to human escalation with zero external actions.

Phase 5E adds strict job, dispatch, and result contracts for governed GHL
actions. These contracts carry bounded action intent and provider-independent
payloads; authorization remains database state, not a claim made by the
payload. The private gateway maps allowlisted actions to provider requests only
after replay, ownership, consent, emergency, and policy checks succeed.

Phase 5F adds a secret-free capacity evidence contract. It records the exact
synthetic workload, tested claim guard, acceptance/drain throughput, latency
percentiles, outcomes, recovery behavior, tenant mismatches, and measured
database growth. Evidence explicitly records zero customer credentials,
provider/model calls, SmartLabs changes, and fixed 75,000-lead SLA claims.

The companion `phase5.conversation-resilience-evidence.v1` contract records
the secret-free burst/soak, dependency, worker, reconnect, encrypted-backlog
restoration, and dead-letter replay gate.

`phase5.n8n-runtime-recovery-evidence.v1` records the pinned disposable queue
runtime, the terminal execution/new-ID logical replay boundary after an abrupt
worker loss, graceful Redis-AOF queued-work recovery, readiness, metrics, and
local alert delivery. It explicitly cannot claim a live provider, production
destination, GPU, or SmartLabs test.

`phase5.n8n-retention-pruning-evidence.v1` records measured synthetic n8n
execution/PostgreSQL and Redis queue/AOF growth, n8n's built-in count pruning,
ordinary vacuum, safe AOF compaction, storage projections, and encrypted
pre-prune restoration into a unique disposable database. It explicitly makes
no physical PostgreSQL shrink, production SLA, GPU-server, or SmartLabs claim.
