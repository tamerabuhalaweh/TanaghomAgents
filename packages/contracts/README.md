# Contracts package

Shared schemas for API payloads, agent jobs, transactional events, and validated
LLM outputs.

Phase 3 v1 contracts live under `schemas/phase3`. They are strict, versioned,
secret-free boundaries for the Strategist and Content Producer. Prompt text is
stored once under `/prompts`; n8n exports must reference the committed prompt
version and may not embed a divergent copy.

Phase 4 contracts live under `schemas/phase4`. Performance responses normalize
Postiz's platform-dependent labels into durable metric keys and dated values.
Lead ingestion must resolve to an organization, campaign, and source post or be
recorded as quarantined; ambiguous provider events may not silently create
unattributed leads.

Phase 5 contracts begin with a customer-owned GoHighLevel contact-upsert
boundary. The job identifies an organization-scoped lead and monotonic sync
version; the result records only the authorized location, provider contact
reference, and whether HighLevel created or updated the contact. No message,
sequence, or free-form outreach content is part of this contract.

Phase 5B adds a normalized GHL webhook event, a metadata-only durable job, and
a no-external-action processing result. Provider bodies are treated as
untrusted input, reduced to bounded supported fields, and never authorize a
message, appointment, opportunity update, or other provider action.
