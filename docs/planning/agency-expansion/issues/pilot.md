# Agency pilot: adapt six governed sales, content, marketing and reporting profiles

## Authorization and status

Implementation started under Tamer's 2026-09-06 scoped GO. PR #194 is reviewed/merged at c77e25cfc006a6efd322adb1f259fbd3d9c47c3f with 38/38 CI checks. The next source slice implements four callable simulation bindings preserving existing workers, a bounded Brand precheck/semantic-proposal adapter, and a grounded Executive reporting adapter. Local evidence: 23 new test groups, 143 total tests and 12 synthetic bilingual journeys pass. Tests execute existing n8n Code-node bodies in Node.js with authored responses, not a hosted n8n/model canary. Authenticated tenant snapshot resolution, durable database/n8n installation, Studio availability and comparative model/quality certification remain incomplete. No production database, model/provider call, activation or deployment. Evidence: docs/evidence/2026-09-06-agency-runtime-adapters.md; exact integration limitations: packages/agent-runtime/README.md.

### Source-slice tracking (not full issue acceptance)

- [x] Candidate source review and complete normalized procedures (PR #194).
- [x] Callable simulation bindings to the existing four compatible paths.
- [x] Brand precheck and semantic proposal contract/validator; no approval authority.
- [x] Cited, window/unit/denominator-bound reporting adapter; no invented ROI.
- [x] English/Arabic contract and negative-control fixtures; zero live actions.
- [ ] Authenticated storage resolver, durable binding/audit integration and actual disposable DB/n8n round trips.
- [ ] Model compatibility, paired evaluation and semantic/Arabic quality acceptance.
- [ ] Truthful Studio availability and separately reviewed installation/rollback.

The checked source implementation items describe this branch's local evidence;
its introducing PR must pass review and full CI. They do not mark the production
or whole-issue acceptance criteria below complete.

Parent: #174.

## Problem

Customers should not need to invent every agent from a blank form. Existing agents can benefit from selected specialist methods, but duplicate workers and raw prompt imports would fragment approvals and authority.

## User story

As an owner, I want a small coherent starter team that understands my approved offer, produces useful bilingual work, and explains its limitations without gaining uncontrolled powers.

## Scope

- Six profile contracts: Social Media Strategist, Content Creator, Brand Guardian, Discovery Coach, Support Responder, Executive Summary Generator.
- Enhance Campaign Strategist and Content Producer rather than duplicate them; content variants/repurposing remain owned by #155.
- Use Discovery/Support methods as bounded conversation skills; coordinate lead qualification with #152 and lifecycle follow-up with #154.
- Deliver grounded reporting through #153. Bind Brand Guardian review to approved claims, tone, rights metadata, and exact content version; it cannot grant human approval.
- For any capability not supported by the current proposal/read executors, document and implement an explicitly reviewed adapter/contract extension; do not invent a working tool.
- Normalize source instructions, pin versions, define expected outputs/required knowledge, limits, uncertainty/escalation, and English/Arabic behavior.
- Keep all new profiles disabled/simulation/proposal-only until separate release gates pass.

## Dependencies and ownership

- #175: semantic review of the six selected source profiles only; do not wait for every future profile.
- #134/#135 foundation; #152/#153/#154/#155 remain the owners of overlapping implementation.
- #177 is the release gate, #137 the existing certification framework, #125 the separate provider UAT lane.

Source implementation and source review for this slice: Codex. Product/scope owner: Tamer. Customer/domain approver: to be designated by Tamer before quality acceptance or rollout; no independent review or customer signoff is implied. Other future slices remain unassigned.

## Acceptance criteria

- [ ] All six profiles have immutable source/procedure/skill/model-contract references and clear existing-versus-new executor mappings.
- [ ] Strategy and content paths retain campaign/draft lineage, human review, and the existing Postiz draft-only handoff.
- [ ] Discovery/support output is concise, customer-appropriate, grounded in approved knowledge, and escalates ambiguity; no enterprise-sales script is blindly applied to consumer inquiries.
- [ ] Brand review returns findings and evidence, not an approval; later content edits invalidate affected findings and approvals.
- [ ] Reports cite permitted source records and time windows; missing data is identified and no invented KPI or conversion promise is emitted.
- [ ] No credentials, arbitrary tools, cross-tenant content, external messages, publishing, or ad spend become reachable through the profiles.
- [ ] The comparative evaluation in #177 passes; existing campaign and conversation regression suites still pass.
- [ ] Each profile is shown truthfully in Studio with availability, required dependencies, mode, and exact blockers; existing system-agent identity/history is retained.

## Validation and evidence

Run contract and disposable tests, the existing seven safety scenarios per selected language, profile-specific quality scenarios, and current-vs-adapted comparisons. Provider stubs only by default; actual model/provider execution requires a separately approved environment and scope.

## Deployment and rollback

Retain exact prior agent/skill bindings. Disable new versions for future claims, preserve in-flight provenance, then use a reviewed binding rollback or forward fix. Never rewrite published skills or erase decisions.

## Non-goals

- No second Content Producer, no generic autonomous sales loop, no ad-account writes.
- No content publishing, live provider activation, new Gemma service configuration, or new infrastructure.

## Definition of done and handoff

All applicable acceptance criteria link reviewed PRs, exact source/version hashes, test commands/results, limitations, and any separately authorized runtime evidence. Keep implementation, deployment, activation and customer acceptance distinct. Close only when this issue's agreed scope is evidenced; document remaining gates rather than silently moving them. Update docs/STATUS.md, the expansion catalog/plan, and the versioned issue snapshot on material changes. No secret or raw customer data belongs in GitHub.

Versioned planning snapshot: docs/planning/agency-expansion/issues/pilot.md. The snapshot is published through the planning documentation PR; issue/comment edits are not immutable release evidence.
