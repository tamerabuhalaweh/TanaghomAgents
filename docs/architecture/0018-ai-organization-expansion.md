# ADR 0018: AI organization expansion through curated specialist profiles

Date: 2026-09-06.
Status: product/planning direction approved; implementation and deployment not
authorized by this ADR. Tracking: #174, with existing foundation epic #131.

## Context

Tanaghom's initial sales/content/marketing release is a pilot for a broader
AI organization. Agency Agents provides 273 candidate role definitions across
18 divisions at a pinned source revision. It also supplies process guidance,
handoffs and host-tool integrations, but not Tanaghom's tenant policy,
business-state, credential or approval boundaries.

A profile is not a trained model, executable capability, certified worker,
or proof of improved outcomes. Adding more profiles must not create
unbounded chains, duplicate agents, conflicting managers or misleading UI.

## Decisions

### D1 — Broader product scope with a bounded pilot

Retain every pinned profile in the future roadmap. Start with six specialist
adaptations: campaign strategy, content crafting, brand review, conversation
discovery, customer care and executive reporting. Use future departmental
issues to preserve coverage without making them first-release dependencies.

### D2 — Reuse the current control and execution planes

The Next.js application and PostgreSQL remain authoritative for human
authorization and business state. n8n remains the reviewed execution engine.
Gemma remains a bounded model endpoint, not an administrator.

Extend existing immutable skills, Agent Studio, jobs, runtime profiles,
invocations, approvals and audit. ADR 0017 already defines a successful-parent
agent handoff with tenant/version/correlation checks; generalized team
coordination must build on it, not introduce a rival task ledger.

### D3 — Curated intake, not wholesale installation

Pin the exact upstream commit, per-file hashes, license, semantic review,
capability mapping and evidence. Normalize procedures and role templates into
Tanaghom-compatible contracts. No automatic imports, upstream installers,
arbitrary tool declarations or one-n8n-workflow-per-source-profile design.

Track catalogued, adapted, tested, available and activated separately.
A semantic review or executor gap can block admission while the source
profile remains visible in the roadmap.

### D4 — Permission intersection at every delegation

Managers propose bounded assignments. The platform authorizes each child
against the original human request, organization policy, assigned agent/skill
versions and executor scope. No parent can transfer its credentials or grant
a child more authority. Assignment acceptance is not a human business
approval. Timeout cannot default to approval.

Define bounded depth, loops, steps, time, retries, concurrency and whole-team
budgets; preserve cancellation, emergency-stop and uncertain-provider blocks.
Keep fast inbound response paths independent of unnecessary team reasoning.

### D5 — One optional supervisor interface

Reuse #150 for Hermes Supervisor Analyst and Skill Proposal Worker.
Initial Hermes operation remains isolated, optional, default-off and
proposal-only. It is not a system administrator and cannot directly pause,
retry, reassign, activate, publish, contact, change policy or write skills.
Accepted proposals go through the existing human/policy/runtime gate.

The upstream Hermes router is a possible future reference, not an approved
runtime/plugin. Do not install Hermes on the protected GPU/SmartLabs host.
No-Hermes deterministic team coordination must remain fully usable.

### D6 — Improvement is versioned and evaluated

Use source-grounded, sanitized tenant evidence to propose new drafts.
No self-modifying production prompts, unreviewed persistent memories,
cross-customer learning, model-weight changes or automatic publication.
Human review, evaluation, immutable version creation and rollout remain
separate steps. #180 extends the existing lifecycle and #150 proposal path.

### D7 — Evidence before capability claims

Compare the six pilot adaptations with current behavior under matching
conditions. The initial proposed 40-case bilingual dataset is not proof of
conversion uplift or general production reliability. Keep existing security,
tenant, idempotency and seven-per-language certification scenarios; add
profile/domain-specific cases and measured runtime budgets.

### D8 — Domain expansion requires its own acceptance

Engineering execution, ad spend, finance, healthcare, HR, legal, sensitive
location data and media/compute workloads require domain-specific permission,
privacy, qualified review and infrastructure gates. Including a role in the
catalog never waives these gates.

### D9 — GitHub is the engineering record, not runtime memory

Issues track current work. Repository documents record decisions and status
snapshots. Accepted artifacts are addressed by exact commit/content hashes;
branches and issue text are editable and are not immutable approval evidence.
Operational truth remains in authorized runtime records. Git is not a
replacement for database/credential backup.

## Consequences

The initial reuse is in methods, templates, evaluations and team contracts,
not automatic new tools. Some pilot profiles require explicit proposal/read
executor work. The all-department vision is retained without inflating current
readiness or blocking the current Postiz/GHL acceptance lane.

No changes to SmartLabs, SmartCC, voice, Gemma services, credentials, providers,
n8n activation, firewall, Nginx or production occur under this planning ADR.

## Alternatives not selected

- Bulk-install every source profile: incompatible permissions and no
  certification evidence.
- Replace Tanaghom with a new agent framework: discards working governance and
  creates duplicate state.
- Give Hermes autonomous manager authority: conflicts with #150 and the
  human-governed control plane.
- Add only more cards: does not add useful execution or accountable teamwork.
