# ADR 0015: Governed customer Skill Library

## Status

Accepted for Phase 7B repository implementation. Production migration, Agent
Studio bindings, executable customer skills, generic runtime dispatch, provider
calls, MCP onboarding, and n8n activation remain outside this decision.

## Context

Phase 7A makes eight platform capabilities discoverable and pins every reviewed
worker to an immutable platform skill. Organization owners also need to capture
their own procedures and knowledge without gaining a path to code execution,
credentials, provider endpoints, database access, n8n identifiers, or runtime
permission changes.

## Decision

Customer-authored skills use separate tenant-bound tables:

- `organization_skill_definitions` owns a stable organization code and one of
  two non-executable classes: `knowledge` or `proposal_instruction`.
- `organization_skill_versions` owns all changeable content, language,
  contract tokens, validation evidence, SHA-256 content hash, lifecycle actors,
  timestamps, and immutable version ancestry.
- `organization_skill_references` stores only owner-approved organization-local
  keys plus provenance, language, review state, expiry, and a content hash.
- `organization_skill_audit_events` records draft, clone, validate, publish,
  supersede, retire, and export actions without update or deletion.

Every content or metadata change creates another draft version. Validation
recomputes the normalized content hash from stored data. Publishing one version
supersedes the previous published version but does not delete or rewrite it.
Retirement prevents future use while preserving history.

## Safety boundary

The application and database both reject frontmatter, code fences, control and
bidirectional override characters, executable markup, arbitrary URL schemes,
private keys, secret assignments, bearer tokens, shell/package commands,
filesystem paths, direct SQL, hidden prompt overrides, MCP runtime references,
and n8n workflow or credential identifiers. Inputs, outputs, languages,
examples, references, and content sizes are bounded.

`tanaghom_api` receives SELECT on the new tables and EXECUTE only on three
owner-checked functions. It receives no direct DML. n8n, conversation workers,
and public receive neither table access nor function execution. All functions
verify the accepted active owner and organization again inside PostgreSQL.

## Product behavior

The Skill Library lists platform and organization skills with filters,
plain-language permissions, exact versions, checksums, assignments, references,
blockers, and audit evidence. Owners can create, clone, validate, publish,
retire, and export organization skills. Other accepted roles see published
history but cannot see drafts or mutate content.

Arabic and English authoring use direction-aware fields and logical CSS. Loading,
empty, forbidden, validation, conflict, and service-failure states are explicit.
The export is Agent Skills-compatible Markdown containing instructions only.
Export is a same-origin POST because it records an immutable audit event.

## Agent isolation

No Phase 7B table is a runtime agent binding. Publishing records
`agent_bindings_changed=false` and the UI reports that assignment requires a
separately validated Agent Studio version. The existing four business agents,
eight workers, workflows, emergency stops, policies, credentials, and provider
operations are unchanged.

## Rollback

Migration `0027_governed_skill_library` rolls back only when every organization
Skill Library table is empty. Once customer data exists, rollback refuses and a
separately reviewed forward migration must preserve it. Disposable testing
proves migration, role boundaries, lifecycle, refusal with data, empty rollback,
and clean reapplication.
