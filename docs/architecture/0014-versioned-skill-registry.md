# ADR 0014: Versioned Skill Registry

## Status

Accepted for Phase 7A repository implementation. Production migration,
customer-created agents, generic execution, and workflow activation are outside
this decision.

## Context

Tanaghom has four business-agent roles and eight reviewed workflow workers.
Their capabilities were previously discoverable only by reading workflow
exports, prompt sources, and database functions. A future organization agent
must select a capability without gaining permission to change its executor,
broaden provider access, or mutate a published contract.

## Decision

PostgreSQL remains authoritative. `skill_definitions` owns the stable skill
identity and either platform or organization scope. `skill_versions` pins:

- instructions and strict input/output contract references;
- skill, risk, and side-effect classes;
- explicit data domains, integrations, channels, and operations;
- one reviewed executor type, identity, and version;
- instruction-package and tool-schema SHA-256 checksums;
- lifecycle and append-only provenance.

`agent_skill_bindings` pins a business role and specialized worker to an exact
published version. `skill_references` records hashed repository artifacts, and
`skill_audit_events` is append-only. The initial reconciliation maps every
existing worker to exactly one platform skill without changing its workflow,
job type, trigger, activation, provider policy, approval gate, emergency stop,
or runtime evidence.

The recovery contract is `config/skill-registry.v1.json`. Each platform skill
also has a concise Agent Skills-compatible `SKILL.md` containing instructions
only. Customer executable scripts are forbidden. These packages carry no
runtime authority: PostgreSQL functions, application authorization, private
gateway checks, and network boundaries remain authoritative even if exported
metadata is altered.

## Lifecycle and immutability

Versions move through `draft`, `validated`, `published`, `deprecated`, and
`retired`. Published content, schemas, permissions, executor bindings, and
checksums cannot change in place. A reviewed lifecycle transition may deprecate
or retire a version; capability changes require a new version and a new
immutable binding.

Phase 7A exposes no mutation API. `tanaghom_api` and `tanaghom_readonly` receive
read-only registry access. `tanaghom_n8n_worker` and
`tanaghom_conversation_worker` receive no registry read or write privilege.
Model output therefore cannot create a permission manifest or choose an
executor.

## Tenant boundary

Platform definitions have a null `organization_id`; organization definitions
must have one. Binding, reference, and audit triggers require the same nullable
organization identity as the referenced definition. Cross-tenant bindings and
artifacts fail before persistence. The authenticated operations API lists only
platform skills and skills belonging to the caller's organization.

## Validation and rollback

Repository validation compiles every referenced JSON Schema, verifies closed
object boundaries, recomputes instruction and tool-schema hashes, checks the
eight one-to-one worker bindings, and rejects wildcards, unknown executor
types, unsafe package paths, or executable skill content.

Disposable PostgreSQL validation proves least privilege, immutability, known
executor enforcement, tenant isolation, clean rollback to migration `0025`,
and clean reapplication. Rollback refuses if organization-owned skill data,
bindings, references, or audit events exist, or if the seeded platform registry
has changed. It drops only Phase 7A objects.

## Consequences

The dashboard API can truthfully describe available skills and permissions,
but no customer can create an agent yet. Agent Studio, organization skill
authoring, generic runtime dispatch, MCP-backed executors, certification, and
production activation remain separate reviewed issues under #131.
