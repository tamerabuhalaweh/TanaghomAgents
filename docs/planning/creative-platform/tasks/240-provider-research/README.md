# P5 accepted official-source research archive

Decision snapshot: **2026-10-11**. Parent record: [Completed provider decision](../240-provider-decision.md). Controlling scope: [task 240](../240-talking-head.md) and [ADR 0026](../../../../architecture/0026-creative-talking-head.md).

This directory preserves the user-accepted research inputs, not a new provider certification. Reports are analyst-authored official-source diligence; they are not verbatim full vendor websites. The report/ledger files themselves are copied **verbatim** after credential-pattern/content review. No secrets or customer media were identified; no redactions were necessary. Documentation request placeholders are not live credentials.

| File | Provenance and limitations |
|---|---|
| `p5-heygen.md` | Completed HeyGen report; original source numbers/excerpts preserved. Current v3/default IV, opt-in V eligibility, pricing conflicts and privacy/consent gates. |
| `p5-sync.md` | Completed Sync specialist report; original source numbers/excerpts preserved. Video + captured audio, upload/idempotency/lifecycle/cost/media contracts and conflicts. |
| `p5-tavus.md` | Completed Tavus fallback report; original source numbers/excerpts preserved. Faces/legacy video field, custom voice dependency and unresolved gates. |
| `p5-synthesia.md` | Accepted underlying Synthesia report **with incomplete Sources appendix**: ends in an unpopulated placeholder. Do not claim a completed source-excerpt appendix or evidence-mode pass. |
| `p5-synthesia-ledger.json` | Original Synthesia ID→URL/access-date ledger. Contains no quote/evidence attachments. Supplies URL attribution, not missing excerpts or independently reviewed raw pages. |
| `manifest.json` | Byte sizes and SHA-256 of the five accepted scratch inputs. Verification compares archived bytes with these inputs. |
| `decision-ledger.json` | Separate generated URL→citation-number registry for the consolidated decision. Its numbering is not original report numbering. URL registration is not new live retrieval or legal review. |

Original reports refer to adjacent scratch evidence directories, which are **not included in this bounded archive**; no claim is made that full captures, private agreements or account capabilities were copied/reviewed. Tool limitations remain verbatim (HeyGen/Sync/Synthesia report unavailable `web.run`; Tavus reports use of it). This worker did not rerun research, sign agreements, authenticate to providers, upload media, generate output, spend or enroll subjects.

Old report phrases such as “hold implementation” remain as historical text. Current user acceptance and task/ADR authorize **source-only implementation**, not real use. The completed consolidated decision excludes Synthesia from this implementation, preserves Tavus only as future binding extensibility and selects conditional HeyGen primary/Sync `lipsync-2` specialist.

Acceptance is separate: documentary decision completed; `sourceComplete` independently verified by implementation owner; `providerAccepted`, `customAccepted` and `productionCertified` unpassed. Required defaults: `TALKING_HEAD_ENABLED=false`, `LIP_SYNC_ENABLED=false`, `CUSTOM_AVATAR_ENABLED=false`. UNKNOWN and REQUIRES ACCEPTANCE are intentional, not omissions to fill with assumed behavior.
