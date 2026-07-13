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
