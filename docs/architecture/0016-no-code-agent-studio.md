# ADR 0016: No-code Agent Studio and immutable organization agents

Status: accepted for Phase 7C repository implementation under Issue #134.
Production migration, shared runtime execution, provider actions, n8n mutation,
and customer UAT activation are not authorized by this decision.

## Decision

Tanaghom exposes an owner-controlled Agent Studio at `/settings/agents`.
Studio creates declarative organization-agent configuration. It does not create
code, n8n workflows, credentials, prompts with hidden authority, or direct
provider calls.

An organization agent is split into an immutable definition and append-only
versions. Each version pins:

- a reviewed platform template, when used;
- exact published platform or organization Skill versions;
- exact active tenant knowledge versions;
- existing customer-managed integration identifiers and compatible channels;
- brand, languages, business outcome, responsibility, and tone;
- allowed records, actions, channels, business hours, consent, rate, retry,
  concurrency, runtime, token, follow-up, action, and budget limits;
- the actions requiring human review, eligible roles, review expiry, and the
  requirement that approval is bound to exact proposed parameters;
- mandatory success, refusal, escalation, prompt-injection, provider-failure,
  duplicate-retry, and emergency-stop scenarios for every selected language.

Every material change creates a new draft version. The database rejects a
revision based on a stale source version. Existing validated or running
versions are never rewritten.

## Lifecycle boundary

The stored lifecycle is:

`draft → validated → simulation → shadow → assisted → active → paused/retired`

Phase 7C permits owner validation, pause, resume, and retirement through
transactional database functions. Promotion into simulation, shadow, assisted,
or active is rejected until the shared policy-resolved runtime and evaluation
evidence from Issues #135 and #137 are reviewed.

`automatic` is present only as a future database vocabulary value so later
migrations can be forward-compatible. Both the public contract and the
database mutation boundary reject it in Phase 7C.

## Authorization and isolation

- Accepted active owners create, validate, revise, pause, resume, and retire.
- Reviewers, operators, and viewers receive only permitted non-draft reads.
- Direct table writes are denied to the dashboard API role.
- n8n and conversation-worker roles receive no Agent Studio table or function
  access.
- Every template, Skill, knowledge version, integration, actor, clone source,
  and transition is checked against the organization boundary.
- Only security-definer functions can create or transition versions.
- Audit rows are append-only and attributed to the accepted human actor.

The existing system-agent registry is separate and remains unchanged.
Organization agents cannot overwrite platform agents or n8n workflow identity.

## Browser data minimization

The Agent Studio response includes only the information needed to compose and
inspect a version. Integration base URLs, provider configuration, credentials,
tokens, database roles, executor endpoints, n8n identifiers, and encryption
material are not selected or returned.

Free-text fields reject secrets, URLs, commands, executable markup, hidden
control characters, runtime identifiers, and common instruction-override
language. Knowledge and brand inputs are governed keys, not pasted documents
or URLs.

## Compatibility and validation

Draft creation rejects a provider-dependent Skill unless the matching existing
organization integration is bound with a compatible channel. Validation is
stricter: a required customer integration must be connected and must have
passed its provider health test.

Studio prepares mandatory scenarios but does not fabricate pass results.
Runtime certification remains false, and the UI states the exact next gate.

## Rollback

Migration `0029_organization_agent_studio` is reversible only while no
organization Agent Studio definition, version, binding, policy, scenario, or
audit data exists. Once customer data exists, rollback deliberately refuses;
recovery must use a reviewed forward migration so customer history is never
deleted to force a downgrade.

The controlled production update and dashboard rollback commands remain a
separate approval artifact. Merging this implementation does not deploy it.
