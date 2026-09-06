# Agency intake: review and version the complete 273-profile source catalog

## Authorization and status

Planning/backlog authorized by Tamer on 2026-09-06. Implementation has not started under this issue. This GO authorizes GitHub documentation and tracking only; implementation, deployment, real model/provider calls and activation need separately scoped approval. Future department inclusion is a product direction, not certified capability.

Parent: #174.

## Problem

The full catalog must remain recoverable and traceable, but Markdown instructions may contain unsafe tools, unsupported claims, stale assumptions, or overlap with existing skills. Enumerating and hashing a file does not certify its content.

## User story

As a platform maintainer, I need a complete pinned catalog and per-profile review record so no future department is forgotten and unsafe source instructions never become runtime authority.

## Scope

- Start with the committed 273-row inventory of source commit 1454492577d1af4884722837f491fef14b501e21; distinguish it from the older Drive pack in #151.
- Review exact source fragments for licensing/provenance, commands/tool declarations, secrets without exposing values, unsafe authority, assumptions, localization, and unsupported metrics.
- Map each fragment to reference-only, knowledge/instruction skill, role template, executor/connector work, evaluation scenario, or explicitly restricted/rejected candidate.
- Define a normalized template package compatible with #132-#135; retain source path/blob/content digest and MIT attribution.
- Design explicit, reviewable catalog-version updates and impact reports. Never automatically follow upstream main or run upstream installers.

## Dependencies and ownership

- #174; #151 remains responsible only for the separate downloaded flow pack.
- Existing skill/lifecycle contracts #132-#135; executable/MCP work additionally requires #136/#137.

Implementation owner: unassigned until a scoped development GO. Product/scope decisions: Tamer. The implementing developer must name the reviewer and required customer/domain approver in the PR.

## Acceptance criteria

- [ ] The inventory matches the pinned upstream tree exactly: 273 unique profile paths across 18 divisions, with Git blob and SHA-256 hashes verified.
- [ ] Every profile has a recorded review result, mapping, overlap rationale, permission/data requirements, language gaps, maintenance owner, and evidence reference before admission.
- [ ] Catalogued, adapted, tested, available, and activated are separate states; nothing is represented as adapted merely because it was inventoried.
- [ ] Normalization strips or rejects upstream runtime/tool declarations and executable instructions; accepted fragments cannot broaden Tanaghom policy.
- [ ] Unknown provenance, unsafe authority, specialized domain restrictions, and unresolved dependencies are visible blockers, not hidden omissions.
- [ ] Upstream updates produce a new version/diff; old source identifiers and evidence remain recoverable.

## Validation and evidence

Offline manifest completeness/hash/link checks; normalization refusal fixtures for frontmatter, commands, arbitrary URLs, cross-tenant knowledge, malicious instructions, and unsafe tool requests. A human records semantic review results; a linter cannot mark them safe.

## Deployment and rollback

Remove an unadmitted catalog candidate without deleting its provenance/review history. Deprecate admitted immutable versions rather than rewriting them. No runtime change in the initial metadata-only inventory.

## Non-goals

- No bulk prompt import into customer Skill Library or n8n.
- No copying customer data, executing source scripts, or treating MIT licensing as security certification.

## Definition of done and handoff

All applicable acceptance criteria link reviewed PRs, exact source/version hashes, test commands/results, limitations, and any separately authorized runtime evidence. Keep implementation, deployment, activation and customer acceptance distinct. Close only when this issue's agreed scope is evidenced; document remaining gates rather than silently moving them. Update docs/STATUS.md, the expansion catalog/plan, and the versioned issue snapshot on material changes. No secret or raw customer data belongs in GitHub.

Versioned planning snapshot: docs/planning/agency-expansion/issues/catalog.md. The snapshot is published through the planning documentation PR; issue/comment edits are not immutable release evidence.
