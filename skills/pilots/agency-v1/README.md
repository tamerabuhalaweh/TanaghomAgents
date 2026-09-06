# Agency six-profile pilot: source candidates, not installed agents

Follow-up source implementation: [callable simulation bindings and Brand/reporting
adapters](../../../packages/agent-runtime/README.md). The candidate v1 manifest
below remains the original intake snapshot; it is not rewritten to claim runtime
installation or certification by a later source slice.

Issues: #175 selected-source intake, #176 pilot; #177 evaluation and #137
certification. This is the first source implementation slice following Tamer's
2026-09-06 GO. It does not finish those issues or add cards to the live Studio.

## What this package actually does

Six normalized `proposal_instruction` skill drafts pass both the existing
organization-skill JSON Schema and the real server-side Skill Library validator.
They are packaged for review, **not inserted into any tenant database**. No
automatic importer or runtime consumer is added. The current platform skills,
system agent identities, published versions, model prompts, n8n exports and
customer approval history are unchanged.

The [candidate manifest](../../../config/agency-pilot-candidates.v1.json)
records original source hashes, normalized procedure hashes, real platform
skill version IDs, executor mappings and pinned input/output/model-plan
references. Text-file digests use UTF-8 with LF newlines. `content_hash` uses
the existing server validator's normalized object hashing, not a new algorithm.
The shared planner prompt/schema are reference pins only: no actual model
binding is selected and no model compatibility or quality claim is made.

| Candidate | Proposed existing target | What remains before availability |
| --- | --- | --- |
| Social Media Strategist | Campaign Strategist / `create_campaign_strategy` | Reviewed versioned procedure binding and strategy regressions |
| Content Creator | Content Producer / `generate_content_drafts` | Reviewed binding and lineage/variant tests; coordinate #155 |
| Discovery Coach | Conversation Intelligence / `propose_conversation_reply` | Concise grounded discovery binding; coordinate #152/#154 |
| Support Responder | Same Conversation Intelligence worker | Support/escalation binding; coordinate #154 |
| Brand Guardian | **No existing matching executor** | Version-bound findings schema, read/proposal adapter and stale-review tests |
| Executive Summary Generator | **No existing matching executor** | Tenant-scoped reporting inputs, grounded output schema and adapter under #153 |

Every candidate is unavailable, unactivated and uncertified. All require
tenant-approved evidence, owner/domain review, a reviewed binding, model
compatibility testing and paired bilingual evaluation. The two missing
executors are `null`, not invented tool names. Existing mappings identify
potential reuse; they do not prove the procedures are already injected into
those workers. Installation/promotion requires subsequent reviewed source and
runtime gates. It must enhance existing worker versions, not duplicate them.

## Selected-source semantic review

Reviewer: Codex; review date: 2026-09-06. Tamer approved source work, not
customer/domain acceptance. All six full source bodies were read as untrusted
data at commit `1454492577d1af4884722837f491fef14b501e21`; original-byte SHA-256
matched every selected row of the pinned inventory. No source example or
installation command was executed.

| Source | Useful method retained | Explicitly removed or constrained |
| --- | --- | --- |
| Social Media Strategist | Audience-first message/cadence planning | Tool declarations, unsupported channels, automatic ads, unmeasured growth/ROI targets and implicit memory |
| Content Creator | Brand narrative and channel adaptation | Video/audio execution claims, automatic distribution, unsupported performance promises and standalone duplicate worker |
| Brand Guardian | Evidence-backed tone/claim/rights review | CSS/shell examples, legal clearance claims, invented monitoring state and automatic approval |
| Discovery Coach | Reflect the actual need and clarify fit | Emotional pressure, invented objection statistics, forced enterprise-length scripts and recording access |
| Support Responder | Empathy, approved troubleshooting and escalation | Python/YAML snippets, invented SLA/results, unrequested follow-up, account mutation and automatic knowledge edits |
| Executive Summary | Concise findings and proposed decisions | Mandatory numbers without data, invented executive/consulting experience, unsupported forecasts and autonomous decisions |

The complete adaptation decisions and pinned source URLs are in the manifest.
Arabic examples exist for every candidate. This demonstrates authored bilingual
guidance, not successful model output or professional linguistic signoff.

## Provenance, licensing and recovery

Derived methods: [Agency Agents](https://github.com/msitarzewski/agency-agents/tree/1454492577d1af4884722837f491fef14b501e21),
MIT, Copyright (c) 2025 AgentLand Contributors. Preserve the full
[license notice](../../../docs/planning/agency-expansion/UPSTREAM_LICENSE.txt)
with this package. Third-party brand/asset rights and domain permissions are
not granted by that license.

Retention decision for this pilot: Git retains the complete normalized
candidate procedures, original source identifiers/hashes, license and review
record; it does not retain raw upstream executable examples. Those normalized
procedures can be recovered without downloading upstream. Reconstructing the
original source prose still depends on upstream or a separately reviewed
quarantine archive. The original 273-profile inventory remains an unchanged
historical intake snapshot; this manifest is a separate selected-candidate
review record, not a silent rewrite of its initial pending states. The other
267 source profiles have not been semantically reviewed by this slice.

## Evidence and reproducible checks

From the repository root:

```sh
node --experimental-strip-types scripts/validate-agency-pilot.mjs
node --test tests/agency-pilot-candidates.test.mjs
npm test
npm run check
node docs/planning/agency-expansion/validate.mjs --github
git diff --check
```

The five candidate test groups include a passing baseline before negative
controls. They reject changed source/reference/procedure hashes, unexpected
metadata, duplicate selections, fabricated executors, removed blockers,
available/activated/certified flags, executable content, hidden authority and
unknown tool fields. Tests use local synthetic inputs; no tenant creation,
database mutation, model call or provider action occurs. These tests validate
packaging and constraints, not model behavior. Evidence and remaining gates:
[pilot source-slice report](../../../docs/evidence/2026-09-06-agency-pilot-candidates.md).

## Next source slices and acceptance gates

1. Freeze the proposed [paired evaluation design](../../../docs/planning/agency-expansion/PILOT_EVALUATION.md)
   before any comparison output, including agreed rubric and model/runtime.
2. Implement reviewed versioned bindings for the four compatible candidates.
   Prove campaign/draft lineage, approved-knowledge grounding, DND/takeover,
   human approvals and original worker identity in disposable regressions.
3. Implement Brand Guardian's bounded review contract and Executive Summary's
   authorized-record reporting adapter with #153; preserve existing owners.
4. Add truthful Studio availability only when supported; unknown dependencies
   must remain visible blockers rather than plausible-looking agent cards.
5. Run existing safety certification plus paired English/Arabic quality and
   resource tests. Real model/provider environments require explicit scope.
6. Prepare a separately approved rollout with pinned bindings and rollback.

Source rollback: revert this candidate package through review; no runtime
rollback is necessary because nothing was installed. Future rollout must
disable new claims, preserve in-flight version/audit history and restore the
prior reviewed bindings; it must not overwrite published versions.
