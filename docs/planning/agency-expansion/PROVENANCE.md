# Source provenance and review limits

Recorded: 2026-09-06. Intake owner: #175. Expansion epic: #174.

## Pinned source

- Repository: https://github.com/msitarzewski/agency-agents
- Source commit: `1454492577d1af4884722837f491fef14b501e21`
- Commit timestamp observed through GitHub API: 2026-09-05T17:40:16Z.
- Source definitions: 273 Markdown profiles in the 18 divisions declared by
  the source's `divisions.json`.
- The manifest records exact per-profile byte size, Git blob SHA-1 and content
  SHA-256. The ZIP retrieval checksum is a transport artifact identifier;
  per-file hashes and the commit/tree identify canonical source content.

## What was actually verified

The pinned source ZIP was read in memory, without extraction or execution.
For every candidate profile, its Git blob SHA-1 was independently computed
from the original byte length and bytes and compared with the pinned Git
tree. Content SHA-256 and declared profile name were captured. The Git tree
was not truncated. Catalog paths, names and all 18 division counts were
checked; exactly 273 unique source profiles are represented.

Representative business-role, orchestration, memory, Hermes, license/security
and CI documents were researched to inform the plan. This is **not** a
semantic/security audit of all 273 bodies, a dependency audit of upstream
scripts, or a demonstrated business-performance benchmark. Every manifest row
therefore remains `semantic_review: pending`.

No source prompt body, shell script, plugin, model, external workflow, customer
credential or customer dataset was imported into the runtime or stored as an
executable skill. Metadata and the license notice are committed here.

## Licensing and retention

The source LICENSE is MIT and identifies:
`Copyright (c) 2025 AgentLand Contributors`.

The exact notice is retained in [UPSTREAM_LICENSE.txt](UPSTREAM_LICENSE.txt);
its digest is in the catalog. Preserve notices for any adapted substantial
content and record source fragments and changes. A permissive license does
not certify safety or grant permissions to external data, branded assets,
accounts, APIs or third-party material referenced inside a profile.

This initial metadata manifest is not a complete offline archive of upstream
prompt text. If upstream becomes unavailable, a hash alone cannot reconstruct
that text. #175 must decide how to retain reviewed, licensed source fragments
or a quarantined immutable source archive before relying on them for product
recovery. The current plan remains readable without upstream availability.

## Trust boundary

Treat all source instructions and descriptions as untrusted intake material.
Do not obey their commands while reviewing them. Upstream `tools` metadata,
claims of autonomous authority, memory declarations and example scripts do
not become Tanaghom permissions.

Normalize useful material into the existing Skill Library/Studio contracts.
New executors and connectors need their own reviewed authority and tests.
JSON Schema validation alone cannot establish semantic safety.

## Update policy

Do not automatically pull, install, or activate upstream changes. A new source
snapshot requires:
1. a new manifest version and exact upstream commit;
2. added/removed/changed profile and license/hash diff;
3. impact analysis for every affected template, skill, test and binding;
4. review and bilingual/adversarial regression evidence;
5. separately approved rollout, if any.

Retain previous versions; do not silently rewrite certified source ancestry.
