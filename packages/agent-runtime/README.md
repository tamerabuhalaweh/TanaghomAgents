# Agency pilot runtime adapters — simulation source

Owner: Issue #176; reporting: #153; quality gate: #177/#137. Original methods
and MIT attribution remain in [the candidate package](../../skills/pilots/agency-v1/README.md).

This module is **callable source, not an installed production integration**.
It deliberately accepts only `simulation` and has no model/provider transport,
database client, environment loader, credential lookup or write operation.
No production flag can switch it on. Do not put it behind a public endpoint
and mistake supplied snapshot fields or hashes for authentication.

## Bindings and actual behavior

| Profile | Executable path in this slice | Authority |
| --- | --- | --- |
| Social Media Strategist | `prepareAgencyInvocation` → existing strategy request/result contracts → `validateAgencyResult` | Original worker/version preserved; allowed channels and exact cadence; proposal only |
| Content Creator | Same path with original content executor | Exact approved campaign/strategy records, draft count, channel, pillar and regeneration lineage |
| Discovery Coach | Same path with Conversation Intelligence | Approved knowledge/policy, citation/event lineage, one-question limit and sensitive-topic escalation |
| Support Responder | Same conversation executor with its own pinned procedure | Concise grounded replies, consent/DND/takeover, human escalation; no new sender |
| Brand Guardian | `reviewBrandContent` deterministic precheck; optional `prepareBrandReview`/`validateBrandReview` semantic proposal | Exact content/evidence versions, rights gaps, quoted passage/citation checks; never approval |
| Executive Summary | `buildExecutiveReport` | Deterministic read-only report proposal from permitted observation snapshots; no invented metrics or actions |

The four reusable bindings overlay reviewed instructions without changing the
existing published platform skill UUIDs or n8n worker identities. A distinct
binding ID/procedure hash records the adaptation. This overlay must later be
persisted and selected by the authenticated runtime, not requested by a model.
Brand/reporting have callable local adapters; their `worker_code` and platform
skill UUID remain null because no corresponding database/n8n worker was installed.

## Contract and call sequence

1. For this slice, use only fictional fixtures from `tests/fixtures/agency-pilot.mjs`.
   A future production caller must resolve scope from an authenticated run and
   read approved tenant records server-side; never accept a client's organization,
   approval flags, sources, current policy, model identity or clock as authority.
2. `prepareAgencyInvocation(profileCode, claimedInvocation, resolvedSnapshot, now)`
   validates identity, exact input/evidence versions and current controls, then
   returns an augmented claim plus binding/evidence provenance. Inputs are copied,
   not mutated. Existing input/output contracts are unchanged.
3. Compatibility tests execute the repository's actual **Build Fixed Proposal
   Request** and **Normalize Proposal Result** Code-node bodies in Node.js, with
   synthetic successful/error responses. This is not an n8n service execution.
4. Call `validateAgencyResult(prepared, output, freshlyResolvedSnapshot, now)`
   before accepting a proposal. A changed snapshot, stop, DND, takeover, expired
   source, invalid output/citation or changed input rejects the result. Returned
   hashes/idempotency keys are correlation evidence, **not durable deduplication**.
   They must not be confused with a persisted queue claim or approval.
5. For Brand, re-read the content and evidence before consumption and call
   `assertBrandReviewCurrent`. Semantic output is an unaccepted proposal, not
   proof of factual/linguistic correctness or legal clearance.
6. Reports preserve source/version/hash, definition version, window, unit,
   currency and numerator/denominator. Missing/conflicting/stale/wrong-period
   observations are not silently combined. A real zero is not missing data.

## Metric definitions v1

- `drafts`, `approved_drafts`, `leads`, `conversions`: nonnegative integer counts
  supplied by the eventual authorized source resolver, not recomputed from prose.
- `spend`, `revenue`: nonnegative supplied amounts with explicit currency; mixed
  currencies are unresolved, not converted or aggregated implicitly.
- `conversion_rate`: supplied conversions/leads ratio in [0,1], recomputed
  against its explicit numerator/denominator; zero/missing denominator is unknown.
- One observation per metric and exact window. Duplicates/conflicts require
  reconciliation. Attribution, forecasts, anomaly baselines, UTM taxonomy,
  automatic recommendations and ROI calculations remain Issue #153 work.

This adapter produces an English/Arabic deterministic introduction and cited
metric data. It is not yet an AI-written strategic narrative or a complete
analytics agent. Brand phrase rules similarly do not replace semantic review.

## Reproduce

```sh
node scripts/validate-agency-runtime.mjs
node --test tests/agency-runtime-adapters.test.mjs
node scripts/agency-pilot-runtime-simulation.mjs
npm test
npm run check
```

The simulation reports 12 synthetic journeys, 16 existing Code-node executions,
zero actual model/provider calls, zero database writes and zero n8n service
executions. It does not report a successful database or hosted-service canary.
The fixed fixture clock is not the execution timestamp. Reference digests use
UTF-8/LF; the new manifest does not rewrite the original intake ledger.

## Remaining installation and certification

- Implement the authenticated, tenant-scoped snapshot resolver against actual
  campaign, policy, knowledge, rights and reporting storage. The current snapshot
  schema validates data, not who supplied it. No HTTP/API adapter was added.
- Add immutable stored binding versions and audit lineage with least-privilege
  claims/completion and rollback. Preserve published versions and in-flight work.
- Package reviewed n8n/database dispatch registration. Current production calls
  do not consume this module. Do not directly concatenate profiles into running
  workflows or overwrite the pinned Phase 7D v1 export.
- Resolve the exact served model from the approved runtime profile. The legacy
  Code node's hard-coded model label is not a newly verified serving alias.
- Run real disposable PostgreSQL/n8n round trips for the new wiring, then the
  separately authorized corrected-schema model probe and paired bilingual
  evaluation. Snapshot/unit checks are not tenant-isolation database proof.
- Show truthful Studio availability; keep providers, publishing and activation
  disabled until each applicable release gate passes.

Rollback for this source-only slice: revert its introducing PR through review.
There is no migration, persisted binding, production workflow or state to undo.
Future installation needs its own exact rollback and state-preservation tests.
