# Conversation Intelligence Gemma-schema hotfix

This package replaces only the inactive `phase5ConversationIntelligenceV1`
n8n definition. Its current v4 baseline retains the Gemma-compatible grammar
and the two strictly bounded nested-output fallbacks observed in controlled
shadow canaries. The variants differ only in reviewed field aliases (`message`
vs `content`, `summary_update` vs `summary`, and `fact_description` vs `text`).
The primary correction now explicitly requires the canonical flat top-level
keys in the system prompt and forbids legacy wrapper objects. The fallback
adapter still resolves every citation against approved retrieved knowledge
before the unchanged canonical validator runs.

The package is pinned to the exact inactive operational hash deployed by the
third compatibility correction. It refuses workflow drift, a non-0025 database,
open provider boundaries, stored executions, changed credentials, or protected
service drift. It never changes the dashboard, database schema/data, provider
credentials, firewall, Nginx, or another n8n workflow.

See `RUNBOOK.md` for the authorized execution and exact rollback commands.
