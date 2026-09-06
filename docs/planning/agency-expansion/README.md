# AI Organization Expansion Plan

Status: planning and GitHub tracking approved on **2026-09-06**. A subsequent
Tamer GO authorizes targeted #192 remediation, planning-PR acceptance after
passing gates, and #175's six selected reviews / #176's pilot source work.
It does not authorize live model/provider execution, installation, deployment,
activation, or implementation of every future department.

Parent: [Epic #174](https://github.com/tamerabuhalaweh/TanaghomAgents/issues/174).
Read [current project status](../../STATUS.md) before starting work.

Publication note: documentation PR #191 exposed an existing-dependency audit
failure, tracked separately in #192 and remediated in source PR #193. Both PRs
require passing CI; runtime deployment remains separate. See [validation](VALIDATION.md).

## Product decision

Tanaghom is a human-governed AI organization platform. Sales, content and
marketing are the initial pilot/proof of concept, not the permanent limit of
the product. All 273 profiles across the 18 divisions of the pinned Agency
Agents source are in the expansion inventory. More departments and future
upstream additions can be admitted through new reviewed catalog versions.

The objective is useful, accountable business work, not a large number of
agent cards. Specialist roles, reusable skills, deterministic executors and
team coordination remain distinct concepts.

## Approved direction versus authority to act

Approved direction:
- a six-profile pilot and reproducible comparison against current behavior;
- bounded team assignments and an evidence-backed operations experience;
- optional supervision and reviewed improvement proposals;
- eventual coverage of every inventoried division.

This is not approval to install the source library, execute its commands,
create live agents, activate Hermes, clear emergency stops, contact customers,
publish, spend money, or change any server/service. Department-specific
privacy, professional oversight, safety and connector gates still apply.
No new readiness percentage or production acceptance is claimed.

## Six-profile pilot

First source slice: [six normalized candidates](../../../skills/pilots/agency-v1/README.md)
with real Skill Library validation. Four map to existing workers; Brand Guardian
and Executive Summary still need adapters/contracts. No candidate is installed,
available or certified. The original full inventory remains the historical
intake snapshot; selected review progress is in the separate candidate manifest.

| Source profile | Tanaghom mapping | Canonical implementation ownership |
|---|---|---|
| Social Media Strategist | Improve Campaign Strategist methods, without a duplicate worker | #176 |
| Content Creator | Improve Content Producer methods/variants | #176 coordinates; #155 owns repurposing |
| Brand Guardian | New bounded evidence-backed review proposal; never a human approval | #176; explicitly resolve executor/contract gap |
| Discovery Coach | Concise conversation discovery/qualification skills | #176 coordinates with #152/#154 |
| Support Responder | Grounded customer-care and escalation specialization | #176 coordinates with #154 |
| Executive Summary Generator | Read-only/proposal reporting from permitted evidence | #153 owns capability; #176 integrates pilot |

The pilot is not 273 new live agents. Source files are normalized into exact
Tanaghom skill/template contracts. A template needing a missing read/proposal
operation is blocked until that executor is deliberately reviewed and built.

## Work graph and release order

| Step | Work | Depends on | Evidence required |
|---|---|---|---|
| 0 | Full inventory and intake #175 | Pinned upstream + current architecture | Complete manifest; six selected profiles semantically reviewed first |
| 1 | Six-profile pilot #176 | Selected intake; existing #134/#135; overlapping #152-#155 slices as needed | Versioned contracts and credential-independent regression evidence |
| 2 | Comparative evaluation #177 | Frozen pilot contracts and baseline | Per-profile/per-language evidence, safety pass and measured resource use |
| 3 | Bounded team coordination #178 | Existing runtime handoff; certified pilot for rollout | Ownership/dependencies/budgets, restart/race/stop/duplicate tests |
| 4 | Team operations UX #179 | #178 contracts | Authenticated, truthful, accessible bilingual/browser journeys |
| 5 | Governed improvement proposals #180 | Existing version lifecycle; #177/#137; #150 only if Hermes used | Quarantine -> review -> new version -> regression gate |
| Later | Department coverage #181-#190 | Per-profile intake, required adapters and domain gates | Each department's explicit acceptance criteria |

Pilot implementation and evaluation design can progress together, but
certification is a release gate. Team API design can proceed while evaluation
runs; executable rollout must not assume an untested pilot has passed.
Do not wait for all 273 semantic reviews to start the six-profile pilot.

### Separate current delivery lane

#125, #45, #54, #56 and #137 retain the existing customer/provider acceptance
work. They are not superseded, closed or dependent on all future departments.
New roles do not resolve channel mappings, customer scopes, signed webhooks,
test contacts, measured provider outcomes or written customer acceptance.

## Future-department coverage

| Owner | Upstream divisions | Profiles | Initial boundary |
|---|---|---:|---|
| #181 | Marketing, sales, support | 51 | Draft/read/proposal; existing customer/provider gates |
| #182 | Engineering, security, testing | 80 | Read-only/proposed changes; later isolated execution only |
| #183 | Design, product, project management | 22 | Reviewable design/research/planning artifacts |
| #184 | Finance | 5 | Evidence-backed analysis, no financial transactions |
| #185 | Academic, research | 7 | Cited synthesis with rights and provenance |
| #186 | Healthcare | 3 | Restricted-domain review and qualified human oversight |
| #187 | GIS | 13 | Approved datasets and bounded isolated analysis |
| #188 | Game development, spatial computing | 27 | Proposals first; separate render/compute/host gates |
| #189 | Specialized | 58 | Split HR/legal/operations/leadership/etc. by domain risk |
| #190 | Paid media | 7 | Planning/read-only; no spending or ad mutations |
| Total | All 18 source divisions | 273 | Cataloguing is not operational admission |

The six pilot profiles are a cross-cutting subset, not six additional source
entries. Each profile retains its primary department owner. Specialized
profiles may later move to more precise department groupings through a
reviewed catalog revision; preserve ancestry and do not lose coverage.
High-risk profiles are not automatically rejected or authorized: document
their permitted scope, qualified review, and any explicit Tamer-approved
restriction or deferral.

## Reuse existing work; do not duplicate

- #131 remains the foundation epic; #132-#135 are closed implementation
  foundations, not evidence that every downstream live gate passed.
- #150 is the existing optional Hermes Supervisor Analyst/Skill Proposal Worker.
  Do not create a second Hermes manager or relax its proposal-only isolation.
- #151 evaluates the older downloaded Drive flow pack, not Agency Agents.
- #152 owns lead operations; #153 analytics/reporting; #154 lifecycle engagement;
  #155 Content Producer repurposing.
- #136 owns MCP governance; #156 the read-only Meta/Instagram MCP pilot;
  #157 the optional isolated video-draft worker.
- #137 remains the authoritative certification/rollout gate. #177 adds a
  source-specific paired evaluation, not a second certification authority.

Upstream Hermes routing may inform lazy specialist discovery. It is not a
Tanaghom-certified plugin, permission model, memory store or runtime. Neither
the pilot nor deterministic team coordination requires Hermes installation.

## Proposed evaluation contract

Concrete offline preparation is now in
[evaluation/agency-v1](../../../evaluation/agency-v1/RUNBOOK.md): 48 core and 24
public reserve EN/AR cases, pinned paired request generation, proposed rubric
and explicit execution gates. The reserves are not a blind holdout. PR #196
accepted the authenticated simulation lane; actual paired quality execution,
matching compiler/model pins, reviewer approval and production installation
remain separate. This package does not certify new agents.

The next [isolated authenticated runner](../../../evaluation/agency-runner-v1/RUNBOOK.md)
now implements fixed baseline/adapted execution through the real owner API and
restricted worker with disposable n8n/PostgreSQL. Its 360-attempt test uses only
authored simulator responses; real model/reference/reviewer gates remain open.

Before generating comparison results, approve the task rubric, data rights,
model/runtime and acceptance thresholds. Proposed initial set: at least
20 English and 20 Arabic representative cases covering all six profiles.
Keep held-out cases and account for nondeterministic results.

Measure task usefulness, factual grounding, brand adherence, escalation,
correction effort, unauthorized requests/actions, tokens/steps and latency.
Report results by language and profile with sample sizes and uncertainty.
Keep the existing seven safety scenario classes per selected language.
Any unauthorized action or tenant/credential leak fails the gate regardless
of average quality.

Do not import upstream percentage targets or claim improved conversion from
simulation. Simple inbound messages use the shortest approved response path;
additional specialists must justify their latency and resource cost.

## Completion and context discipline

- [Review and model setup](REVIEW_AND_MODEL_SETUP.md) records PR #198 acceptance,
  delegated technical review, proposed human roles and Tamer's CPU-VPS/shared-
  Gemma selection. A second GPU is not required. The original frozen isolation
  plan needs a reviewed successor; human nomination and execution remain open.
- Versioned snapshots of every new issue live in [issues/](issues/).
- [issue-index.v1.json](issue-index.v1.json) maps the snapshots to live issues.
- [CATALOG.md](CATALOG.md) is the human-readable full roster.
- [catalog.v1.json](catalog.v1.json) holds exact source hashes and adoption states.
- [PROVENANCE.md](PROVENANCE.md) defines source verification and review limits.
- [VALIDATION.md](VALIDATION.md) records planning checks and repeatable commands.
- [TRACKING_RECONCILIATION.md](TRACKING_RECONCILIATION.md) preserves cross-links
  to existing owners and the dated reconciliation of older issue wording.
- [ADR 0018](../../architecture/0018-ai-organization-expansion.md) records the
  architectural direction and authority limits.
- [Project context rules](../../PROJECT_CONTEXT.md) define developer handoff.

For every material change, update the relevant issue snapshot, status and
catalog entries in the same PR. Link exact test/deployment evidence when it
exists. Close implementation issues only against their real acceptance
criteria; documentation completion does not close them.
