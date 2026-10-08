# Multi-Agent Engineering Coordination Contract

Participants:
- Tamer: product owner / final GO authority
- Muse 1.3 Spark: primary implementation agent with full repo access
- Cursor + Grok: independent implementation/review lane
- ChatGPT: architecture/review/specification lane

## Single source of truth

All agents MUST read, in order:
1. `docs/STATUS.md`
2. `docs/PROJECT_CONTEXT.md`
3. `docs/PRODUCTION_READINESS.md`
4. `docs/DEFINITION_OF_DONE.md`
5. this file
6. `MASTER_PLAN.md`
7. `MUSE_REPO_RECONCILIATION.md`

Chat transcripts are not authoritative project state.

## Branch discipline

- Never let Muse and Cursor edit the same implementation files concurrently.
- One issue = one owner = one branch = one PR.
- Rebase/update from main before review.
- No direct work on main.
- No production deploy from a development agent without explicit Tamer authorization.

Suggested ownership:
- Muse: contracts + DB + runtime foundation + primary backend.
- Cursor/Grok: dashboard UX, RTL, visual/system tests, or an explicitly separate vertical.
- Cross-cutting files are assigned to one agent only per PR.

## Shared status file

Every active implementation branch should maintain a task note under:
`docs/planning/creative-platform/tasks/<issue>.md`

It records:
- owner
- branch
- scope
- files owned
- dependencies
- commands run
- test results
- unresolved questions
- rollback
- handoff notes

## Review rule

The other agent reviews the PR rather than silently fixing it on its own branch.
Every PR must cite the issue/task file and production gates affected.

## Network rule

Tailscale/WireGuard may connect:
- GPU worker hosts
- private n8n
- object storage
- internal render services

It does NOT replace:
- app authentication
- tenant authorization
- request signing
- secrets management
- audit
- least-privilege DB roles

## Stop conditions

Stop and escalate to Tamer if a change requires:
- touching SmartLabs/SmartCC;
- changing certified production infrastructure;
- activating live Postiz/GHL/model provider actions;
- purchasing significant GPU capacity;
- introducing AGPL/non-commercial/revenue-restricted model code without approval;
- changing approval semantics;
- weakening tenant/auth boundaries.
