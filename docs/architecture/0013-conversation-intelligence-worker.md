# 0013 — Conversation Intelligence n8n worker

## Decision

Use the existing private n8n runtime for Conversation Intelligence instead of a
parallel service. The workflow is generated, versioned, inactive by default,
and owns one bounded transition:

`accepted GHL inbound event → grounded proposal or recorded retry`

It never sends a message or performs a provider action.

## Database authority

The workflow uses a dedicated `Tanaghom Conversation PostgreSQL` credential
whose production login may only inherit `tanaghom_conversation_worker`. It has
no direct table permissions and is not a member of the general n8n worker role.
This workflow's complete invocation surface is:

1. `claim_ghl_inbound_event_job()`
2. `prepare_conversation_intelligence(uuid)`
3. `persist_conversation_intelligence_proposal(uuid,jsonb)`
4. `record_ghl_inbound_event_failure(uuid,text,text,integer)`

These functions enforce tenant policy, emergency stops, capacity, dependency
cooldowns, claim ownership, active approved citations, and zero external
actions. PostgreSQL remains authoritative for retry and proposal state.
The inherited NOLOGIN role also retains the separately reviewed conversation
lease/recovery functions used by the wider supervised-conversation subsystem;
none grants direct provider action or table mutation authority.

## Model boundary

The only HTTP destination is the approved Gemma chat-completions endpoint. n8n
passes the versioned v1 system prompt, an exact JSON Schema response contract,
approved retrieved knowledge, and untrusted customer content in separate trust
domains. The workflow rejects malformed JSON, contract drift, unsupported
facts, missing citations, model/version drift, unsafe escalation decisions, and
any nonzero `external_action_count`.

English grounded answers require active customer-approved citations. Arabic is
supported; when no approved Arabic fact supports an answer, the safe result is
`no_approved_answer` with mandatory human escalation.

## Runtime and activation

The export contains a manual trigger and a disabled schedule. Merge and import
do not activate it. A later production package must import exactly one reviewed
workflow inactive, verify zero executions, create/import the separately
encrypted restricted database credential, update Agent Registry evidence, and
provide exact rollback. Live polling, GHL webhook enablement, and customer data
remain separate owner-approved gates.

## Evidence

The disposable integration uses pinned PostgreSQL and n8n with a local Gemma
simulator. It proves cited English output, Arabic escalation, duplicate safety,
malformed/contract-invalid/429/503 retry behavior, dependency cooldown, no
direct unsafe nodes, and zero external operations. Phase 6 also executes this
worker as the eighth inactive workflow in the credential-independent narrative.
