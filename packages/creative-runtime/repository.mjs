// PostgreSQL job repository. Accepts an injected `db` with pg-compatible
// `query(text, params)` so tests and workers share the call surface without
// this package depending on connection management. Every mutation goes
// through a controlled SECURITY DEFINER function; no raw table writes.

function one(rows) {
  return rows && rows.length > 0 ? rows[0] : null;
}

export async function enqueueJob(db, input) {
  const {
    actorId, capability, lane, params, idempotencyKey, correlationId,
    priority = 0, maxAttempts = 3, templateRef = null,
    brandKitVersionId = null, estimatedCredits = null,
  } = input ?? {};
  if (!actorId || !capability || !lane || !params || !idempotencyKey || !correlationId) {
    throw new Error('creative_enqueue_input_incomplete');
  }
  const result = await db.query(
    `SELECT tanaghom.create_creative_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS job_id`,
    [actorId, capability, lane, params, idempotencyKey, correlationId,
      priority, maxAttempts, templateRef, brandKitVersionId, estimatedCredits],
  );
  return one(result.rows)?.job_id ?? null;
}

export async function claimJob(db, { lane, worker, leaseSeconds = 120 }) {
  const result = await db.query(
    `SELECT * FROM tanaghom.claim_creative_job($1,$2,$3)`,
    [lane, worker, leaseSeconds],
  );
  return one(result.rows);
}

// Capability-filtered design claim: lane cpu, capability IN
// ('design','carousel'). Never touches foreign CPU jobs.
export async function claimDesignJob(db, { worker, leaseSeconds = 120 }) {
  const result = await db.query(
    `SELECT * FROM tanaghom.claim_creative_design_job($1,$2)`,
    [worker, leaseSeconds],
  );
  return one(result.rows);
}

export async function getRenderInput(db, { jobId, worker }) {
  const result = await db.query(
    `SELECT tanaghom.get_creative_render_input($1,$2) AS input`,
    [jobId, worker],
  );
  return one(result.rows)?.input ?? null;
}

// Tenant-checked source resolution through the controlled reader: returns
// { version_id, object_key, mime } or null when the version is not visible
// to this worker's job.
export async function getRenderSource(db, { jobId, worker, versionId }) {
  const result = await db.query(
    `SELECT tanaghom.get_creative_render_source($1,$2,$3) AS source`,
    [jobId, worker, versionId],
  );
  return one(result.rows)?.source ?? null;
}

export async function countRenderOutputs(db, { jobId, worker }) {
  const result = await db.query(
    `SELECT tanaghom.count_creative_render_outputs($1,$2) AS outputs`,
    [jobId, worker],
  );
  return one(result.rows)?.outputs ?? 0;
}

export async function getRenderVersionAsset(db, { jobId, worker, versionId }) {
  const result = await db.query(
    `SELECT tanaghom.get_creative_render_version_asset($1,$2,$3) AS asset_id`,
    [jobId, worker, versionId],
  );
  return one(result.rows)?.asset_id ?? null;
}

export async function markRunning(db, { jobId, worker }) {
  const result = await db.query(`SELECT tanaghom.mark_creative_job_running($1,$2) AS status`, [jobId, worker]);
  return one(result.rows)?.status ?? null;
}

export async function heartbeat(db, { jobId, worker, leaseSeconds = 120 }) {
  const result = await db.query(`SELECT tanaghom.heartbeat_creative_job($1,$2,$3) AS lease_expires_at`, [jobId, worker, leaseSeconds]);
  return one(result.rows)?.lease_expires_at ?? null;
}

export async function completeJob(db, { jobId, worker, assetVersionId, actualCredits = null }) {
  const result = await db.query(`SELECT tanaghom.complete_creative_job($1,$2,$3,$4) AS status`, [jobId, worker, assetVersionId, actualCredits]);
  return one(result.rows)?.status ?? null;
}

export async function failJob(db, { jobId, worker, errorClass, errorMessage, retryAfterSeconds = 60 }) {
  const result = await db.query(`SELECT tanaghom.fail_creative_job($1,$2,$3,$4,$5) AS status`, [jobId, worker, errorClass, errorMessage, retryAfterSeconds]);
  return one(result.rows)?.status ?? null;
}

export async function requestCancel(db, { actorId, jobId }) {
  const result = await db.query(`SELECT tanaghom.request_creative_cancel($1,$2) AS status`, [actorId, jobId]);
  return one(result.rows)?.status ?? null;
}

export async function expireLeases(db) {
  const result = await db.query(`SELECT tanaghom.expire_creative_leases() AS expired`);
  return one(result.rows)?.expired ?? 0;
}

export async function registerVersion(db, input) {
  const {
    jobId, worker, assetId = null, title = null, mime, width = null,
    height = null, durationMs = null, bytes, sha256, objectKey,
    thumbKey = null, provenance = {}, promptRef = null,
    templateRef = null, method,
  } = input ?? {};
  const result = await db.query(
    `SELECT tanaghom.create_creative_asset_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS asset_version_id`,
    [jobId, worker, assetId, title, mime, width, height, durationMs, bytes,
      sha256, objectKey, thumbKey, provenance, promptRef, templateRef, method],
  );
  return one(result.rows)?.asset_version_id ?? null;
}

export async function decideVersion(db, { actorId, assetVersionId, decision, feedback = null }) {
  const result = await db.query(`SELECT tanaghom.decide_creative_asset_version($1,$2,$3,$4) AS status`, [actorId, assetVersionId, decision, feedback]);
  return one(result.rows)?.status ?? null;
}

export async function getJob(db, { organizationId, jobId }) {
  const result = await db.query(
    `SELECT id AS job_id, organization_id, capability, lane, status, attempt, max_attempts,
            correlation_id, idempotency_key, cancel_requested, error_class, output_asset_ids
       FROM tanaghom.creative_jobs WHERE id = $1 AND organization_id = $2`,
    [jobId, organizationId],
  );
  return one(result.rows);
}
