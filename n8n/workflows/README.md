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
