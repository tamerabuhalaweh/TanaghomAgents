# n8n workflows

Secret-free workflow exports live here. Credential IDs, API keys, customer data,
and production webhook URLs must never be committed.

The recovered Groky v0 exports are preserved under `archive/legacy-v0/n8n` as
inactive reference material. They target a different schema and must not be
imported into the Tanaghom runtime. New exports will be generated from versioned
contracts and prompts after their database/API compatibility tests pass.

Phase 3 exports are generated under `phase3/`. The committed files are inactive,
contain no webhook trigger, and reference credential stubs by stable UUID. Run
`npm run generate:phase3-workflows` after changing a prompt or generator; CI
rejects prompt/export drift and executes both workflows using the pinned n8n
image, disposable PostgreSQL, and a simulated Gemma endpoint.

Phase 4 exports are generated under `phase4/`. The Postiz publisher accepts only
database-queued, human-requested jobs, rechecks approval evidence immediately
before the API call, and sends `type: draft`. Its polling trigger is committed
disabled and the workflow itself is inactive. The export contains credential
stubs only; disposable validation uses a simulated Postiz endpoint.

The Phase 4 performance monitor follows the same boundary: it claims a
database-authorized job, asks the private dashboard gateway for dated Postiz
analytics, normalizes the response to the versioned performance contract, and
completes the job through controlled database functions. It cannot read the
customer API key, write performance tables directly, or activate its own
schedule. Both the workflow and its polling trigger are committed inactive.

Phase 5 exports are generated under `phase5/`. The GHL contact workflow handles
only an explicitly queued contact upsert: it claims a database-authorized job,
loads customer credentials only inside the private dashboard gateway, and
records the returned contact ID through controlled database functions. The
workflow cannot message contacts, read customer tokens, write application
tables directly, activate its disabled polling trigger, or retain contact data
in n8n execution history.

Phase 5E adds the governed GHL action worker. It supports only database-prepared
message, qualification, tag, assignment, appointment, opportunity, nurture,
won, and lost actions. It calls the private dashboard gateway and completes or
fails work through controlled functions; it contains no customer credential or
direct GHL URL. The workflow is inactive, polling is disabled, and timeouts are
recorded as indeterminate rather than blindly retried.
