# Customer-visible Agency workspace delivery

Authorized by Tamer on 2026-09-06: implement and deploy a real specialist journey
and a bounded cooperating team on the fresh **155.117.45.45 test VPS**. Owners:
#176 (specialists), #177 (model evidence), #178 (coordination), #179 (interface).
This supersedes planning-only authority for this slice, not every department.

## User outcome

An owner selects one specialist or the six-member Campaign Work Pack team,
supplies a brief and source facts, starts work, follows actual tasks/handoffs,
reads saved deliverables, and approves or rejects the exact completed pack.
The team proceeds strategy → content → brand review → discovery guide → support
answers → a deterministic delivery summary. These are draft documents, not
executed campaigns, live conversations, measured sales or customer messages.

Shared memory means an immutable assignment brief and source facts, plus prior
versioned deliverables within the same organization/assignment. It is not
unbounded cross-customer memory, autonomous knowledge publication or training.
Model-authored claims never become owner-approved facts automatically.

## Implementation boundary

- Extend the existing Agency pilot task/audit queue through additive migration
  0035; distinguish a `workspace.v1` dispatch lane so the frozen simulation
  worker cannot accidentally claim these tasks. Do not create another queue.
- Reuse Studio's create/validate functions and immutable Agency profile bindings.
  Validation is schema/policy validation, explicitly not model certification.
- Preserve frozen candidate/evaluation contracts. Version the document-drafting
  adaptation separately; this is not the #177 structured-output quality trial.
- Use normal text completions, **no response_format, guided JSON, tools or JSON
  schemas sent to shared Gemma**. Structured output is parsed nowhere in this lane.
  Bound input/output, one outstanding inference, no automatic inference retries,
  timeouts/quarantine, exact model/endpoint checks and explicit model-stop state.
- n8n coordinates through authenticated private gateway calls, without database
  table writes, human-approval privileges, provider credentials or arbitrary URLs.
- Tenant/accepted-human authorization, same-origin cookie mutations, immutable
  decisions, exact-result approval, duplicate keys, cancellation, preserved
  partial results, bounded history and server-owned step order are mandatory.
- No publishing, CRM mutation, messages, MCP, shell tools or spending. No changes
  to SmartLabs/SmartCC/voice/Gemma services, 38.247 runtime or provider accounts.

## Product/design brief

Retain the approved light teal/Inter product identity and existing Next.js shell.
Make **AI workspace** prominent in navigation. Lead with the assignment and its
next action; use a compact specialist roster, task timeline, readable selected
artifact and shared-context panel. Avoid another grid of inactive biographies.
Use real saved state, source/version references and human decisions, never
invented activity. Support mobile, keyboard use, Arabic document direction,
loading/errors/empty states and 16px artifact/form text. Previous delegated
design/no-mock-approval instruction applies; no rebrand or generated imagery.

## Acceptance and evidence

- [x] Owner can create single-specialist and six-step team assignments (disposable test).
- [x] Same-tenant prior outputs are visible as inputs to the next specialist (disposable test).
- [x] Tasks/results survive reload; duplicate requests do not duplicate work (disposable test).
- [x] Unauthorized/cross-tenant requests fail; worker cannot approve or edit facts (disposable test).
- [x] Cancel/stop paths preserve evidence and do not retry uncertain calls (disposable test).
- [ ] Real English and Arabic model output, exact model/request counts recorded.
- [x] Exact-pack human approval/rejection is durable; no external action occurs (disposable test).
- [x] Browser tests demonstrate the journey, not only a login screen (authored fixtures).
- [ ] Reviewed code, migration, deployment/rollback and runtime evidence in GitHub.

The local Gemma credential is currently absent; the public health endpoint
returns 200 and unauthenticated model inventory returns 401. A credential was
requested privately through the local `.env` contract; no model call has run.
Do not call an offline demonstration real-model execution or close parent issues
against a subset of their scope. Full production/provider certification remains
separate. No readiness score increase is earned merely by implementing this file.
