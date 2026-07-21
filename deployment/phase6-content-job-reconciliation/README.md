# Phase 6 content-job reconciliation

This package completes one already-reviewed `campaign.content.generate` job
after every generated item has an attributable final human decision. It calls
the existing `tanaghom.complete_content_job(uuid)` function exactly once under
`tanaghom_n8n_worker` and records the resulting job, agent, and immutable audit
state.

The Supabase operator login has role-level `INHERIT TRUE`, while its existing
worker membership is `ADMIN TRUE, INHERIT FALSE, SET FALSE`. During the same
serializable transaction, the package creates a separate current-user grant
with explicit `ADMIN FALSE, INHERIT FALSE, SET TRUE`, assumes the worker role,
calls the function, revokes only that temporary self-granted membership row,
verifies the original grantor's row is unchanged at `SET FALSE`, and only then
commits. Any error rolls back both the job and membership changes. No credential
is decrypted or exported.

It does not generate content, import or execute an n8n workflow, call Gemma,
queue a provider job, publish, contact a lead, modify a migration, or change a
service, container, firewall rule, credential, or proxy. SmartLabs, SmartCC,
voice, Gemma configuration, Nginx, Postiz, and GHL are outside its mutation
scope.

The two Tanaghom core workflows must still match their reviewed original hashes
and remain inactive. Other workflows are protected by an operation-scoped
inventory: the package captures the complete current inventory immediately
before mutation and requires every non-core workflow to be identical
immediately afterward. A workflow added after the original canary is therefore
not mistaken for unauthorized drift, and no unrelated workflow is inspected,
executed, authorized, or changed by this package.

Preparation and merge do not authorize the production mutation. See
[RUNBOOK.md](RUNBOOK.md) for the separate preflight and execution gates.
