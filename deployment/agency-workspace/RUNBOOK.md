# Customer-visible workspace — isolated test VPS

Scope: **155.117.45.45**, hostname `vps-khal-tanaghom`, Compose project
`tanaghom-test`, database `tanaghom_test`. Not the 38.247 production runtime.
Tamer authorized the specialist/team journey and its test deployment on
2026-09-06. No SmartLabs/SmartCC/Gemma service edits, provider actions or spending.

## What ships

- `/workspace`: persistent assignments, six ordered specialists, exact shared
  context, result inspection/export and accepted-human approval/rejection.
- Migration 0035 extends the existing Agency queue. The frozen simulator cannot
  claim workspace jobs. Existing model-quality certification remains separate.
- Private n8n 2.26.8 dispatcher (digest-pinned, no published editor/API/webhooks),
  one concurrency, 30-second schedule **imported inactive**. It calls one fixed
  authenticated dashboard endpoint; n8n has neither Gemma nor database credentials.
- Plain-text Gemma drafting, no JSON schema compiler, tools or provider calls.
  Five model steps and one deterministic inventory/summary for a full team.
- Role-scoped worker pool, one in-flight task, 180-second lease, 90-second
  inference timeout, no automatic inference retry, at most 100 claims/24h.
  An unknown/failed request stops further inference pending operator review.

Model prerequisites: `GEMMA_API_KEY` supplied through the approved local `.env`
or a dedicated secure file, copied securely to the test runtime's
`/opt/tanaghom-test/runtime/secrets/gemma_api_key` (root:1000,0640).
Never place it in a commit, CLI argument, issue, public UI or workflow JSON.
The fixed model is `gemma4-26b-a4b-canary`; inventory must report its context size.
The deployment does **not** invent a key or clear stops without a real canary.

## Storage and network boundaries

Existing PostgreSQL/Caddy volumes remain. Add one persistent n8n SQLite volume
`tanaghom-test_workspace_n8n`; it stores workflow and encrypted gateway credential.
This single-dispatcher test is not a horizontally scaled production n8n design.
Its root filesystem is read-only; `/home/node/.cache` is a disposable128MB tmpfs
owned by UID/GID1000 so n8n can generate startup assets. It is not a persistent
document/secret store. Actual read-only server startup has a separate test.
No successful/error/manual execution bodies are retained; prune metadata after
24h or 1,000 records. Logs cap at 10MB for n8n. New image layers can require
roughly 1–3GB; workspace documents are capped at 16,000 characters per step,
20 open assignments per organization. History has no destructive automatic
pruner in this feature; measure growth before increasing test limits.

n8n joins only the new internal `workspace` network; PostgreSQL is on the
existing database bridge and has no host-published port. Dashboard retains the
existing edge network and joins workspace. These bridges are **not an outbound
allowlist**. Fixed application URLs and no user-controlled tools constrain the
gateway; Docker's internal network prevents n8n Internet routing, not arbitrary
host access. This is not a claim of production network certification.
Caddy rejects `/api/internal` and `/api/internal/*` publicly with 404.
Private requests without the gateway token must receive 401.

SSRF defense stays enabled; only internal hostname `dashboard` is excepted.
See [official n8n SSRF documentation](https://docs.n8n.io/hosting/securing/ssrf-protection/).
The pinned version matches the existing isolated Agency harness; any version
upgrade is a separate reviewed change, not a claim that this is latest.

## Controlled update

1. Review the diff and local disposable DB/browser/n8n evidence.
2. On the test VPS only, verify a clean checkout; fetch and check out the exact
   reviewed commit. Record the old source revision before checkout.
3. Execute:

   ```bash
   export EXPECTED_WORKSPACE_RELEASE=<reviewed-40-character-commit>
   bash deployment/agency-workspace/deploy.sh
   ```

The script requires exact migration0034 and no pre-existing workspace secrets.
It builds before changing running services, creates an encrypted pg_dump and
checks its table of contents, applies only0035, recreates the test PostgreSQL
to mount the new restricted worker secret, configures that role, and checks
the real API/worker connections. Then it imports n8n inactive and recreates the
test dashboard/Caddy plus new private n8n. It checks public auth/private
boundary, health, inactive export and `n8n audit`. No model calls or assignments.
The backup and key are separate files under a root-only state directory. This
is a local rollback safeguard, **not off-server disaster recovery**; it does
not replace the separately tracked production backup requirement.

## Exact rollback

Use the state path printed by the update, or:

```bash
state=$(cat /opt/tanaghom-test/runtime/workspace-update-state)
bash deployment/agency-workspace/rollback.sh "$state"
```

This stops only `workspace-n8n`, engages the workspace stop, recreates the
previous immutable dashboard image and original Caddy configuration. It keeps
PostgreSQL, migration0035, completed documents, decisions, credentials and all
audit evidence. No volumes, images, broad Docker resources or unrelated files
are removed. A failed update after the migration automatically runs this path.
An early failure before migration may leave build/secret/backup files; inspect
and resume explicitly rather than blindly rerunning the one-time installer.

For the observed pre-import validation failure (0035 retained, no assignments,
workspace stopped, no n8n service created), the corrected script supports:

```bash
export EXPECTED_WORKSPACE_RELEASE=<reviewed-corrected-40-character-commit>
export WORKSPACE_RESUME_STATE=/opt/tanaghom-test/runtime/workspace-20260906T185616Z
bash deployment/agency-workspace/deploy.sh
```

It validates the original encrypted backup checksum, stopped/unused0035 state
and existing secrets before resuming. After a failed n8n startup, it also permits
the package's stopped n8n container, but reuses the import only after verifying
its exact workspace workflow is inactive and SQLite has zero executions.
It never reapplies the migration, replaces
credentials or overwrites the original rollback image. The application-role
probe does not read `public.schema_migrations`; that remains an administrator
preflight check, preserving least privilege.

`0035.down.sql` is only for an unused disposable workspace. Once any assignment
exists it refuses; do not delete evidence to force it. A backup restore would
overwrite later work and requires a separate reviewed recovery decision.

## Later activation and acceptance gate

Not performed by `deploy.sh`. After securely installing the key:

1. Verify exact authenticated model inventory; do not change the model server.
2. Recreate only the test dashboard to load its key; verify private token
   boundary and that every provider execution flag stays false.
3. Open only the workspace and shared runtime stops on this isolated test DB;
   keep Agency simulator and all Postiz/GHL stops engaged.
4. Run one owner-authorized English specialist task and one Arabic task, with
   at most one outstanding request; record actual model output/tokens/latency.
5. Run one six-step work pack and inspect context lineage; leave the final
   business approval to the human. On any error, restore the workspace stop.
6. Only then publish `tanaghomAgencyWorkspaceV1` and restart this private n8n
   so its 30-second polling serves owner-created tasks. Verify actual schedule
   execution and keep provider flags false. Record exact commands/evidence in
   GitHub before claiming this feature fully delivered.

## Customer path

Open `/workspace` using the normal owner login. Choose **New assignment**,
select one specialist or **Campaign Work Pack — all six specialists**, enter
the outcome and confirmed source facts, save, then **Start assignment**.
Inspect each specialist under **Deliverable**, **Shared context**, and
**Activity**. At completion, **Approve work pack** or **Request changes**
records a human decision; **Export pack** downloads the saved documents.
No approval publishes or sends anything. Rejection saves feedback; creating
a revised assignment is currently required to generate a new version.

If the page says **Model connection pending**, drafting has not been enabled:
you can save and inspect a brief, but there is no live AI result to review.
