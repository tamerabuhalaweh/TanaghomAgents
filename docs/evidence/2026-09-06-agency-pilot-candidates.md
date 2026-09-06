# Agency pilot source slice — 2026-09-06

Scope: #175 selected intake and #176's first normalized candidate package.
Baseline: planning branch `2947739` incorporating source remediation #193.
Implementer/source reviewer: Codex; scope authorization: Tamer's explicit GO.
Customer/domain review and release acceptance remain pending.

Delivered source:

- Six selected source bodies read in full; original-byte SHA-256 values match
  the pinned 273-row inventory. No source command or example code executed.
- Six complete, normalized English/Arabic proposal-instruction candidates.
- Exact source/procedure/platform-skill/schema/prompt references and an explicit
  split of four proposed existing-worker mappings versus two executor gaps.
- Read-only validator using the existing Skill Library schema and real
  server-side parser, plus five test groups with positive/negative controls.
- Proposed 24-English/24-Arabic paired evaluation design, not executed results.

Local validation: candidate validator PASS (6 candidates, 4 reuse mappings,
2 explicit gaps, 0 enabled); five candidate regression groups PASS; full suite
120/120 PASS; repository and planning checks PASS; whitespace check PASS.
Full PR CI results must be linked at publication. No output-quality or model
behavior claim follows from successful configuration parsing.

State: source candidates only; not installed, available, activated, certified
or customer-accepted. No application UI/API, platform skill version, database
migration, runtime prompt, workflow export, credentials or environment changed.
No server, Gemma, SmartLabs, SmartCC, voice or provider access. The existing
provider-UAT lane remains separate. No new production-readiness percentage was
measured or justified by this source slice.

Recovery: versioned candidate package and MIT notice are retained in Git.
Revert this source slice through review if rejected; no runtime rollback is
needed. Remaining bindings/adapters, Studio presentation, model compatibility,
bilingual comparative certification and separately approved deployment remain
tracked under #176/#177 and their existing canonical owners. These issues stay
open after this first slice.

See the [package handoff](../../skills/pilots/agency-v1/README.md) for exact
commands, limitations and next work. PR/commit evidence is the publication
record; the original inventory remains a historical snapshot, with selected
review progress recorded separately in the new candidate manifest.
