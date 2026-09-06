# Developer start here: authoritative Tanaghom project context

Read [STATUS.md](STATUS.md) first, then the linked active issue and architecture
decisions. This file is the handoff contract; no developer should need a chat
transcript to locate the current implementation or approved next step.

## Project boundary

- Repository: `tamerabuhalaweh/TanaghomAgents`.
- Product: Tanaghom, a human-governed AI organization platform.
- First pilot: sales, content and marketing; future scope includes all
  departments in the [expansion plan](planning/agency-expansion/README.md).
- The surrounding Groky folder is the legacy prototype; secret-free historical
  material is in `archive/legacy-v0`, not the deployable implementation.
- SmartLabs, SmartCC, voice and their infrastructure are out of scope.
  References in a Tanaghom runbook do not authorize changing those systems.
- The separate Hybrid/New/tanaghum-platform deployment is not this repository's
  certified environment. Do not transplant its credentials, schema or evidence.

## Where implementation actually lives

| Area | Authoritative source |
|---|---|
| Customer UI and real application API | `apps/dashboard/app`, including API route handlers |
| Business services, auth, permissions and integration gateway | `apps/dashboard/lib/server` |
| Business state and permission enforcement | `packages/database` (`tanaghom` schema) |
| Shared schemas and model/tool contracts | `packages/contracts` |
| Eight business workflows plus six shared runtime exports | `n8n/workflows` |
| Prompt sources and workflow generation | `prompts`, `scripts/generate-*.mjs` |
| Authenticated Agency pilot (review slice, not deployed) | `packages/agent-runtime/integration.mjs`, migration 0034, `n8n/workflows/agency-pilot`, [ADR 0019](architecture/0019-authenticated-agency-pilot.md) |
| Platform skill metadata and instruction packages | `config/skill-registry.v1.json`, `skills/platform` |
| Tests and CI definitions | `tests`, `scripts/*test*`, `.github/workflows/quality.yml` |
| Controlled release and rollback packages | `deployment` |
| Decisions, acceptance, evidence and work plan | `docs` |

`services/api` is a reserved/documentary location, not a separate implemented
API deployment. n8n's own PostgreSQL/Redis execution state is separate from
the authoritative business PostgreSQL database.

## How to decide what is true

1. Current source/contracts describe implemented behavior at an exact commit.
2. Fresh, authorized runtime observations establish current deployed state.
3. Timestamped deployment records establish historical facts only.
4. Issues/PRs track scope, review and remaining work; old bodies may be stale.
5. Architecture/roadmap records describe intent and constraints, not proof that
   every described capability is deployed.

An issue closed for an implementation slice does not close live-provider UAT.
An inactive committed workflow export does not prove live n8n is inactive.
A saved credential or last successful connection test is not current provider
readiness. Simulation certification is not authorization for external actions.

## Working procedure

1. Read STATUS, the issue body and latest relevant comments, source and ADRs.
2. Verify branch/HEAD and existing local changes without discarding user work.
3. Restate the exact authorized scope, non-goals and acceptance gate in the PR.
4. Use existing owners before creating duplicates; the expansion ownership map
   is in its plan and issue index.
5. Update prompts, generated artifacts, schemas/hashes and tests consistently
   when the task affects them. Never casually run a migration command against
   an environment file that may point to a live database.
6. Validate in proportion to risk: repository tests/checks first, then relevant
   type/build/disposable integration/browser suites. Keep local, simulated and
   live results distinctly labeled.
7. Use reviewed PRs. Runtime deployment/activation is separate and requires the
   exact applicable authorization, preflight, validation and rollback.
8. Update issue acceptance evidence, STATUS and any affected catalog/decision
   records. Close an issue only when its agreed definition of done is met.
9. End every completion report with the next best move and explicit remaining
   blockers. Do not invent a production percentage; if one is requested,
   disclose a stable rubric, scope, evidence date and unpassed hard gates.

## Durable context and tamper evidence

GitHub issues/comments and branch names are editable. They are useful current
coordination, but not immutable evidence by themselves. Use:
- versioned issue/decision snapshots committed with the implementation;
- exact commit SHAs, content hashes and version IDs for accepted artifacts;
- PR/review/deployment links and explicit actor, timestamp and scope;
- append-only evidence records and successor decisions rather than silently
  rewriting past acceptance.

Hashing makes changed content detectable; it does not prove who approved it
or prevent repository administrators from deleting refs. Protect acceptance
with the existing review process. This planning task does not modify branch
protection, permissions, tags or organization settings.

Source-only GitHub recovery does not restore live database state or encryption
keys. Do not commit secrets, session files, customer data or raw operational
logs to make a report appear complete.

## Required handoff fields

Every material delivery record must state:
- scope and linked issue/PR;
- exact source baseline and resulting commit/version;
- implemented versus deployed versus activated versus accepted status;
- validation commands, results, evidence hashes/links and untested limitations;
- known blockers, owner/input needed, next approved action;
- authorization boundary and rollback/forward-recovery constraints.

For a runtime observation, include environment, timestamp and freshness.
Never copy a prior report's health, agent count or readiness percentage as a
new measurement. Keep records for another environment explicitly separate.
