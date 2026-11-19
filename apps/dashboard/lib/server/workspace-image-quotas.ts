import "server-only";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Pool, PoolClient } from "pg";

import { buildObjectKey } from "@tanaghom/creative-runtime/storage/keys";
import { creativeStorage } from "@/lib/server/creative/storage";
import { loadWorkspaceQuota, type PlanTier } from "@/lib/server/workspace-quotas";

const requireRuntime = process.getBuiltinModule("module").createRequire(`${process.cwd()}/package.json`);
const googleImages: typeof import("@tanaghom/agent-runtime/google-images")
  = requireRuntime("@tanaghom/agent-runtime/google-images");

type Queryable = Pool | PoolClient;

export type PostImageStatus = "generated" | "fallback";
export type ImageFallbackReason = "tier_not_included" | "monthly_quota_reached" | "provider_error";

/** Founder-locked monthly AI image caps per workspace plan. */
export const PLAN_MONTHLY_AI_IMAGES: Record<PlanTier, number> = {
  starter: 0,
  growth: 15,
  scale: 60,
};

export interface WorkspaceImageQuotaStatus {
  plan_tier: PlanTier | null;
  is_sandbox: boolean;
  images_used: number;
  images_limit: number;
  month: string;
}

export interface WorkspacePostImage {
  post_index: number;
  status: PostImageStatus;
  fallback_reason: string | null;
  model: string | null;
  prompt_summary: string | null;
  byte_size: number | null;
  url: string | null;
}

export interface PostImageSubject {
  index: number;
  headline?: string | null;
  body?: string | null;
  visual_brief?: string | null;
}

export interface EnsureWorkspacePostImagesRequest {
  organizationId: string;
  workspaceId: string;
  posts: PostImageSubject[];
  brandKit?: { name?: string | null; brand_name?: string | null; colors?: Record<string, unknown> | null; tone?: string | null } | null;
  campaign?: { title?: string | null; brief?: string | null } | null;
}

export interface WorkspaceImageDeps {
  now?: Date;
  plan?: { plan_tier: PlanTier | null; is_sandbox: boolean } | null;
  env?: Record<string, string | undefined>;
  generate?: (prompt: string) => Promise<{ bytes: Buffer; mimeType: string; sha256: string; model?: string }>;
  store?: (key: string, bytes: Buffer, mimeType: string) => Promise<unknown>;
  imageKey?: (input: { organizationId: string; assetId: string; mimeType: string }) => string;
  logger?: (event: Record<string, unknown>) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The UTC calendar month key ("YYYY-MM-01") that image usage is counted against. */
export function utcMonthStart(now: Date = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function boundedInteger(value: unknown, fallback: number, ceiling = 100000) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= ceiling ? parsed : fallback;
}

/**
 * Server-only, audited cap override used only while a test tenant is on a plan
 * without image capacity. Format: "orgUuid:cap,orgUuid:cap". It is empty by
 * default, cannot be set from the browser, and every use is logged.
 */
export function imageCapOverride(organizationId: string, raw = process.env.WORKSPACE_IMAGE_CAP_OVERRIDE_ORG_IDS) {
  if (!raw) return null;
  for (const entry of String(raw).split(",")) {
    const [id, cap] = entry.split(":").map((part) => part.trim());
    if (!id || id.toLowerCase() !== organizationId.toLowerCase()) continue;
    const value = Number(cap);
    if (Number.isSafeInteger(value) && value >= 0 && value <= 1000) return value;
  }
  return null;
}

/** Resolves the monthly image cap for a workspace plan (sandbox and Starter are zero). */
export function workspaceImageLimit(
  plan: { plan_tier: PlanTier | null; is_sandbox: boolean },
  organizationId: string,
  env: Record<string, string | undefined> = process.env,
) {
  const override = imageCapOverride(organizationId, env.WORKSPACE_IMAGE_CAP_OVERRIDE_ORG_IDS);
  if (override !== null) {
    console.warn(JSON.stringify({
      event: "workspace_image_cap_override_applied",
      organization_id: organizationId,
      images_limit: override,
    }));
    return override;
  }
  if (plan.is_sandbox || !plan.plan_tier) return 0;
  const tier = plan.plan_tier;
  return boundedInteger(env[`PLAN_MONTHLY_AI_IMAGES_${tier.toUpperCase()}`], PLAN_MONTHLY_AI_IMAGES[tier]);
}

export async function loadWorkspaceImageUsage(client: Queryable, organizationId: string, month: string) {
  const result = await client.query<{ images_used: number | string }>(
    `SELECT images_used FROM tanaghom.workspace_monthly_image_usage
      WHERE organization_id = $1::uuid AND month = $2::date`,
    [organizationId, month],
  );
  return boundedInteger(result.rows[0]?.images_used, 0);
}

export async function loadWorkspaceImageQuota(client: Queryable, organizationId: string): Promise<WorkspaceImageQuotaStatus> {
  const plan = await loadWorkspaceQuota(client, organizationId);
  const month = utcMonthStart();
  const imagesUsed = await loadWorkspaceImageUsage(client, organizationId, month);
  return {
    plan_tier: plan.plan_tier,
    is_sandbox: plan.is_sandbox,
    images_used: imagesUsed,
    images_limit: workspaceImageLimit(plan, organizationId),
    month,
  };
}

async function withQuotaLock<T>(client: Queryable, organizationId: string, run: (tx: Queryable) => Promise<T>): Promise<T> {
  const connect = (client as unknown as { connect?: () => Promise<PoolClient> }).connect;
  if (typeof connect === "function") {
    const dedicated = await connect.call(client);
    try {
      await dedicated.query("BEGIN");
      await dedicated.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`workspace-image-quota:${organizationId}`]);
      const value = await run(dedicated);
      await dedicated.query("COMMIT");
      return value;
    } catch (error) {
      await dedicated.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      dedicated.release();
    }
  }
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`workspace-image-quota:${organizationId}`]);
  return run(client);
}

/**
 * Atomically reserves one image slot for the month. The conditional upsert can
 * never push images_used past the cap, so two posts finishing together cannot
 * overspend a plan.
 */
export async function reserveImageSlot(client: Queryable, organizationId: string, month: string, imagesLimit: number) {
  return withQuotaLock(client, organizationId, async (tx) => {
    const result = await tx.query<{ images_used: number | string }>(
      `INSERT INTO tanaghom.workspace_monthly_image_usage (organization_id, month, images_used)
       VALUES ($1::uuid, $2::date, 1)
       ON CONFLICT (organization_id, month) DO UPDATE
          SET images_used = tanaghom.workspace_monthly_image_usage.images_used + 1,
              updated_at = now()
        WHERE tanaghom.workspace_monthly_image_usage.images_used < $3::int
       RETURNING images_used`,
      [organizationId, month, imagesLimit],
    );
    return result.rows[0] ? boundedInteger(result.rows[0].images_used, 0) : null;
  });
}

/** Returns a reserved slot after a failed provider or storage call. */
export async function refundImageSlot(client: Queryable, organizationId: string, month: string) {
  return withQuotaLock(client, organizationId, async (tx) => {
    const result = await tx.query<{ images_used: number | string }>(
      `UPDATE tanaghom.workspace_monthly_image_usage
          SET images_used = GREATEST(0, images_used - 1), updated_at = now()
        WHERE organization_id = $1::uuid AND month = $2::date
        RETURNING images_used`,
      [organizationId, month],
    );
    return result.rows[0] ? boundedInteger(result.rows[0].images_used, 0) : 0;
  });
}

interface StoredPostImageRow {
  post_index: number;
  status: PostImageStatus;
  fallback_reason: string | null;
  model: string | null;
  prompt_summary: string | null;
  byte_size: number | null;
}

export function postImageUrl(workspaceId: string, postIndex: number) {
  return `/api/workspace/${workspaceId}/images/${postIndex}`;
}

async function existingRow(client: Queryable, organizationId: string, workspaceId: string, postIndex: number) {
  const rows = await listWorkspacePostImages(client, organizationId, workspaceId);
  return rows.find((row) => row.post_index === postIndex) ?? null;
}

function publicRow(row: StoredPostImageRow, workspaceId: string): WorkspacePostImage {
  return {
    post_index: Number(row.post_index),
    status: row.status,
    fallback_reason: row.fallback_reason ?? null,
    model: row.model ?? null,
    prompt_summary: row.prompt_summary ?? null,
    byte_size: row.byte_size === null || row.byte_size === undefined ? null : Number(row.byte_size),
    url: row.status === "generated" ? postImageUrl(workspaceId, Number(row.post_index)) : null,
  };
}

export async function listWorkspacePostImages(
  client: Queryable,
  organizationId: string,
  workspaceId: string,
): Promise<WorkspacePostImage[]> {
  const result = await client.query<StoredPostImageRow>(
    `SELECT post_index, status, fallback_reason, model, prompt_summary, byte_size
       FROM tanaghom.workspace_post_images
      WHERE workspace_id = $1::uuid AND organization_id = $2::uuid
      ORDER BY post_index`,
    [workspaceId, organizationId],
  );
  return result.rows.map((row) => publicRow(row, workspaceId));
}

async function recordPostImage(client: Queryable, row: {
  id: string;
  organizationId: string;
  workspaceId: string;
  postIndex: number;
  month: string;
  status: PostImageStatus;
  fallbackReason: string | null;
  model: string | null;
  objectKey: string | null;
  mimeType: string | null;
  byteSize: number | null;
  sha256: string | null;
  promptSummary: string | null;
}) {
  const result = await client.query<StoredPostImageRow>(
    `INSERT INTO tanaghom.workspace_post_images
       (id, organization_id, workspace_id, post_index, month, status, fallback_reason, model,
        object_key, mime_type, byte_size, sha256_hex, prompt_summary)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::int,$5::date,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (workspace_id, post_index) DO UPDATE
        SET id = EXCLUDED.id,
            month = EXCLUDED.month,
            status = EXCLUDED.status,
            fallback_reason = EXCLUDED.fallback_reason,
            model = EXCLUDED.model,
            object_key = EXCLUDED.object_key,
            mime_type = EXCLUDED.mime_type,
            byte_size = EXCLUDED.byte_size,
            sha256_hex = EXCLUDED.sha256_hex,
            prompt_summary = EXCLUDED.prompt_summary,
            created_at = now()
      WHERE tanaghom.workspace_post_images.status <> 'generated'
     RETURNING post_index, status, fallback_reason, model, prompt_summary, byte_size`,
    [
      row.id, row.organizationId, row.workspaceId, row.postIndex, row.month, row.status,
      row.fallbackReason, row.model, row.objectKey, row.mimeType, row.byteSize, row.sha256, row.promptSummary,
    ],
  );
  return result.rows[0] ?? null;
}

function geminiApiKey() {
  try {
    const value = readFileSync(process.env.GEMINI_API_KEY_FILE || "/run/secrets/gemini_api_key", "utf8").trim();
    return value.length >= 20 && value.length <= 500 && !/\s/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function defaultGenerate() {
  const key = geminiApiKey();
  if (!key) throw new googleImages.GoogleImageError("model_unavailable", 503);
  const client = googleImages.createGoogleImagesClient({ apiKey: key });
  return (prompt: string) => client.generate(prompt);
}

/**
 * Generates up to three AI images for a completed Task 2 deliverable.
 *
 * Every path is fail-open: a zero cap, a reached cap, a provider error, or a
 * storage error records a fallback row and returns, so Task 2 stays succeeded
 * and Tasks 3-6 are never blocked. A failed provider call never keeps the slot
 * it reserved.
 */
export async function ensureWorkspacePostImages(
  client: Queryable,
  request: EnsureWorkspacePostImagesRequest,
  deps: WorkspaceImageDeps = {},
): Promise<WorkspacePostImage[]> {
  if (!UUID_RE.test(request.organizationId) || !UUID_RE.test(request.workspaceId)) {
    throw new Error("workspace_image_request_invalid");
  }
  const posts = (request.posts || [])
    .filter((post) => Number.isInteger(post.index) && post.index >= 1 && post.index <= 3)
    .slice(0, 3);
  if (!posts.length) return [];

  const log = deps.logger ?? ((event: Record<string, unknown>) => console.warn(JSON.stringify(event)));
  const env = deps.env ?? process.env;
  const month = utcMonthStart(deps.now ?? new Date());
  const plan = deps.plan ?? await loadWorkspaceQuota(client, request.organizationId);
  const imagesLimit = workspaceImageLimit(plan, request.organizationId, env);
  const existing = new Map(
    (await listWorkspacePostImages(client, request.organizationId, request.workspaceId))
      .map((row) => [row.post_index, row]),
  );
  const generate = deps.generate ?? defaultGenerate();
  const store = deps.store ?? ((key: string, bytes: Buffer, mimeType: string) => creativeStorage().put(key, bytes, mimeType));
  const imageKey = deps.imageKey ?? ((input: { organizationId: string; assetId: string; mimeType: string }) =>
    buildObjectKey({ organizationId: input.organizationId, capability: "image", assetId: input.assetId, version: 1, mime: input.mimeType }));

  const results: WorkspacePostImage[] = [];
  for (const post of posts) {
    const current = existing.get(post.index);
    // Only a generated image (or a tier_not_included fallback while still at a
    // zero cap) is terminal; a temporary provider_error fallback can be retried.
    if (current && (current.status === "generated" || (imagesLimit === 0 && current.fallback_reason === "tier_not_included"))) {
      results.push(current);
      continue;
    }

    const id = randomUUID();
    if (imagesLimit === 0) {
      const recorded = await recordPostImage(client, {
        id, organizationId: request.organizationId, workspaceId: request.workspaceId, postIndex: post.index,
        month, status: "fallback", fallbackReason: "tier_not_included", model: null,
        objectKey: null, mimeType: null, byteSize: null, sha256: null, promptSummary: null,
      });
      if (recorded) results.push(publicRow(recorded, request.workspaceId)); else { const settled = await existingRow(client, request.organizationId, request.workspaceId, post.index); if (settled) results.push(settled); }
      continue;
    }

    const reserved = await reserveImageSlot(client, request.organizationId, month, imagesLimit);
    if (reserved === null) {
      const recorded = await recordPostImage(client, {
        id, organizationId: request.organizationId, workspaceId: request.workspaceId, postIndex: post.index,
        month, status: "fallback", fallbackReason: "monthly_quota_reached", model: null,
        objectKey: null, mimeType: null, byteSize: null, sha256: null, promptSummary: null,
      });
      log({
        event: "workspace_post_image_fallback",
        organization_id: request.organizationId,
        workspace_id: request.workspaceId,
        post_index: post.index,
        reason: "monthly_quota_reached",
        images_limit: imagesLimit,
      });
      if (recorded) results.push(publicRow(recorded, request.workspaceId)); else { const settled = await existingRow(client, request.organizationId, request.workspaceId, post.index); if (settled) results.push(settled); }
      continue;
    }

    const prompt = googleImages.buildPostImagePrompt({ post, brandKit: request.brandKit ?? null, campaign: request.campaign ?? null });
    let image: { bytes: Buffer; mimeType: string; sha256: string; model?: string };
    let objectKey = "";
    try {
      image = await generate(prompt);
      if (!Buffer.isBuffer(image?.bytes) || !image.bytes.length || !/^[a-f0-9]{64}$/.test(String(image.sha256))) {
        throw new googleImages.GoogleImageError("image_output_missing", 502);
      }
      objectKey = imageKey({ organizationId: request.organizationId, assetId: id, mimeType: image.mimeType });
      await store(objectKey, image.bytes, image.mimeType);
    } catch (error) {
      // A failed provider or storage call must never burn the customer's slot.
      await refundImageSlot(client, request.organizationId, month).catch(() => 0);
      const recorded = await recordPostImage(client, {
        id, organizationId: request.organizationId, workspaceId: request.workspaceId, postIndex: post.index,
        month, status: "fallback", fallbackReason: "provider_error", model: null,
        objectKey: null, mimeType: null, byteSize: null, sha256: null, promptSummary: null,
      });
      log({
        event: "workspace_post_image_failed",
        organization_id: request.organizationId,
        workspace_id: request.workspaceId,
        post_index: post.index,
        reason: "provider_error",
        error_code: typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "image_generation_failed",
      });
      if (recorded) results.push(publicRow(recorded, request.workspaceId)); else { const settled = await existingRow(client, request.organizationId, request.workspaceId, post.index); if (settled) results.push(settled); }
      continue;
    }

    const recorded = await recordPostImage(client, {
      id, organizationId: request.organizationId, workspaceId: request.workspaceId, postIndex: post.index,
      month, status: "generated", fallbackReason: null,
      model: typeof image.model === "string" && image.model.length <= 120 ? image.model : googleImages.DEFAULT_IMAGE_MODEL,
      objectKey, mimeType: image.mimeType, byteSize: image.bytes.length, sha256: image.sha256,
      promptSummary: prompt.slice(0, 280),
    });
    log({
      event: "workspace_post_image_generated",
      organization_id: request.organizationId,
      workspace_id: request.workspaceId,
      post_index: post.index,
      byte_size: image.bytes.length,
      images_limit: imagesLimit,
    });
    if (recorded) results.push(publicRow(recorded, request.workspaceId)); else { const settled = await existingRow(client, request.organizationId, request.workspaceId, post.index); if (settled) results.push(settled); }
  }
  return results;
}
