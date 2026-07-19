# Phase 6 content-job reconciliation

This package completes one already-reviewed `campaign.content.generate` job
after every generated item has an attributable final human decision. It calls
the existing `tanaghom.complete_content_job(uuid)` function exactly once under
`tanaghom_n8n_worker` and records the resulting job, agent, and immutable audit
state.

It does not generate content, import or execute an n8n workflow, call Gemma,
queue a provider job, publish, contact a lead, modify a migration, or change a
service, container, firewall rule, credential, or proxy. SmartLabs, SmartCC,
voice, Gemma configuration, Nginx, Postiz, and GHL are outside its mutation
scope.

Preparation and merge do not authorize the production mutation. See
[RUNBOOK.md](RUNBOOK.md) for the separate preflight and execution gates.
