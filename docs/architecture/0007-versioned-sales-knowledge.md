# 0007 — Versioned sales knowledge and proposal-only intelligence

## Decision

Tanaghom treats customer knowledge as immutable organization-scoped versions,
not prompt text or editable workflow configuration. A source identifies stable
provenance; each revision moves through draft, reviewed, approved, active,
superseded, or revoked states. Only one active version per source and language
is retrievable. Activation supersedes the prior version, while rollback restores
a superseded version without erasing history.

The Sales and CRM worker cannot query knowledge tables. It can prepare one
request only from a running, already-claimed GHL event. The controlled database
function derives the organization from that event, selects active knowledge in
the detected language, includes at most twelve recent turns and one traceable
summary, and returns a separated prompt envelope:

- authoritative system policy;
- approved retrieved knowledge;
- untrusted provider message;
- untrusted bounded conversation context;
- an empty tool-results array.

There is no caller-supplied organization identifier in this worker boundary.

## Grounded proposal contract

Every factual proposal cites the active source ID, version ID, and content
fingerprint. Persistence rechecks those citations against the event's
organization and current active state. A missing approved answer must contain no
citation and must escalate. Superseded and revoked versions cannot be cited in a
new proposal.

The output records language, intent, urgency, sentiment, sales stage, risk,
confidence, next-best action, and escalation. Low confidence and complaint,
legal, payment, refund, abuse, policy-exception, sensitive-data, high-urgency,
or critical-urgency cases cannot be persisted without human escalation.

All outputs remain proposals. `external_action_count` is fixed at zero. This
boundary cannot send a GHL message, book an appointment, change a pipeline,
call a tool, invoke n8n, or publish content.

## Memory

Conversation memory contains at most twelve recent provider events plus a
versioned summary. Summary event IDs must belong to the same organization and
conversation. The ordered input IDs and prompt version produce a stable input
fingerprint, preventing multiple summaries for the same bounded input.

## Evaluation

The committed catalog is synthetic and contains no credentials or personal
data. Sixteen English and Arabic cases cover product questions, pricing,
objections, unknown answers, complaints, refunds, sensitive data, superseded
and revoked sources, and prompt injection. CI records contract, classification,
groundedness, escalation, language, and adversarial results.

This is a reference contract-and-policy evaluation, not a live Gemma quality or
production-capacity claim. Live model evaluation requires a separately approved
shadow worker and customer-approved catalog.

## Activation boundary

Migration `0013` and the owner catalog UI do not activate a model worker or an
auto-reply path. Phase 5B ingress remains disabled by default, organization
processing remains paused, and the GHL emergency stop remains active until a
separate production change is reviewed and approved.
