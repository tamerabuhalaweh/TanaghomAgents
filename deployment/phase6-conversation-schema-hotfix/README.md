# Conversation Intelligence Gemma-schema hotfix

This package replaces only the inactive `phase5ConversationIntelligenceV1`
n8n definition. Its current v2 baseline retains the Gemma-compatible grammar
and adds a strict adapter for the legacy nested output shape observed in the
second controlled shadow canary. The adapter resolves every citation against
approved retrieved knowledge before the unchanged canonical validator runs.

The package is pinned to the exact inactive operational hash deployed by the
first grammar correction. It refuses workflow drift, a non-0025 database,
open provider boundaries, stored executions, changed credentials, or protected
service drift. It never changes the dashboard, database schema/data, provider
credentials, firewall, Nginx, or another n8n workflow.

See `RUNBOOK.md` for the authorized execution and exact rollback commands.
