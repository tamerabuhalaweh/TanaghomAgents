# Planning validation evidence — 2026-09-06

Scope: documentation, source metadata and GitHub tracking only. No application,
migration, workflow, runtime configuration, credential, model/provider request,
production deployment or protected-service change.

## Checks performed

- Pinned upstream inventory: 273 unique profile files / 18 divisions.
- Original-byte Git blob SHA-1 checks matched the pinned upstream tree for
  all 273 profiles; per-file content SHA-256 and license SHA-256 were captured.
- Six pilot candidates exist in the full catalog.
- All profiles remain catalogued, semantic-review pending, not adapted,
  tested, available or activated.
- Every division/profile maps to a real department tracking issue.
- All 17 new issue bodies and the three reconciled existing issue bodies match
  their versioned local snapshots after newline normalization.
- Relative Markdown links and unresolved placeholders checked.
- `npm test`: 111 passed, zero failed.
- `npm run check`: passed; the final file count is reported by the command.
- `git diff --check`: passed (Windows line-ending conversion warnings are
  informational, not whitespace errors).

The small validator in this directory is planning-data tooling only. It adds
no application capability, CI configuration or automatic network work.

## Reproduce from the repository root

```sh
node docs/planning/agency-expansion/validate.mjs
npm run check
npm test
git diff --check
```

Optional read-only GitHub comparison (requires authenticated `gh`):

```sh
node docs/planning/agency-expansion/validate.mjs --github
```

The optional check compares the current editable issue bodies to the committed
snapshot. Future legitimate issue edits should produce a mismatch until a
reviewed snapshot update is committed; do not interpret that as proof of
unauthorized editing.

The source ZIP/tree comparison is described in [PROVENANCE.md](PROVENANCE.md).
The local validator checks manifest structure/digest format and the retained
license, not the availability or semantic safety of every upstream file.
Per-profile semantic review remains open under #175.

## Explicitly not tested

- New profile output quality, conversion impact, or model compatibility.
- Team coordination or learning implementation (not built by this task).
- Current production health, provider credentials, channel mappings or scopes.
- Browser UAT, disposable database/n8n integrations, live Gemma/Postiz/GHL
  execution, or rollout/activation.

CI results for the documentation PR are separate from these local results.
Do not represent queued or pending GitHub checks as passed.

## CI finding after publication

PR #191's dashboard-contract job failed on 2026-09-06 at
`npm audit --audit-level=moderate`, before dashboard type/build validation.
[Failed job](https://github.com/tamerabuhalaweh/TanaghomAgents/actions/runs/34013065179/job/101432088191)
reports five vulnerability entries (two moderate, three high), including
fast-uri/ajv, nanoid and postcss/next. The dependency manifests, lockfile and
quality workflow are unchanged from baseline `0b5b5a7`. This is not evidence
that the planning files introduced a dependency or that production is
exploitable; exact applicability remains to be investigated.

Tracked separately in [#192](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/192),
with a [versioned issue snapshot](release-blocker-192.md). No dependency fix,
audit bypass or production action occurred. The PR remains draft/not
merge-ready while this gate is unresolved. The initial local test results
above remain valid but are not an all-CI-pass statement.
