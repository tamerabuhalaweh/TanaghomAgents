# Conversation Intelligence Gemma-schema hotfix

This package replaces only the inactive `phase5ConversationIntelligenceV1`
n8n definition. It removes the unsupported `uniqueItems` keyword from the JSON
schema sent to Gemma while retaining duplicate rejection in the workflow's
local response validator and the database contract.

The package is pinned to the exact pre-hotfix operational hash observed during
the controlled shadow canary. It refuses workflow drift, a non-0025 database,
open provider boundaries, stored executions, changed credentials, or protected
service drift. It never changes the dashboard, database schema/data, provider
credentials, firewall, Nginx, or another n8n workflow.

See `RUNBOOK.md` for the authorized execution and exact rollback commands.
