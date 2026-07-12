# Contracts package

Shared schemas for API payloads, agent jobs, transactional events, and validated
LLM outputs.

Phase 3 v1 contracts live under `schemas/phase3`. They are strict, versioned,
secret-free boundaries for the Strategist and Content Producer. Prompt text is
stored once under `/prompts`; n8n exports must reference the committed prompt
version and may not embed a divergent copy.
