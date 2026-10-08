import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { noStore } from "@/lib/server/responses";
import { requireCreativeStudio, CreativeDisabledError } from "@/lib/server/creative/feature-control";
import {
  IdempotencyRequestError,
  completeIdempotency,
  idempotencyKey,
  reserveIdempotency,
} from "@/lib/server/creative/idempotency";
import { CreativeJobRequestError } from "@/lib/server/creative/jobs";
import { imageGenerationEnabled, productStudioEnabled } from "@/lib/server/creative/generations";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let presetCache: { codes: Set<string>; doc: unknown } | null = null;

export async function imagePresets() {
  if (!presetCache) {
    const raw = await readFile(path.join(process.cwd(), "config", "creative-image-presets.v1.json"), "utf8");
    const doc = JSON.parse(raw) as { presets?: Array<{ code?: string }> };
    presetCache = { codes: new Set((doc.presets ?? []).map((preset) => preset.code ?? "")), doc };
  }
  return presetCache;
}

export async function listImagePresets(request: NextRequest) {
  try {
    requireCreativeStudio();
    if (!imageGenerationEnabled() && !productStudioEnabled()) {
      return noStore({ error: "image_generation_disabled" }, { status: 503 });
    }
    await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const { doc } = await imagePresets();
    return noStore(doc);
  } catch (error) {
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    throw error;
  }
}

export async function submitProductScene(request: NextRequest) {
  try {
    requireCreativeStudio();
    if (!productStudioEnabled()) {
      return noStore({ error: "product_studio_disabled" }, { status: 503 });
    }
    enforceSameOriginForCookieMutation(request);
    const [user, body] = await Promise.all([
      authorize(request, ["owner", "operator"]),
      request.json().catch(() => { throw new CreativeJobRequestError("invalid_json", 400); }),
    ]);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CreativeJobRequestError("invalid_request", 400);
    const record = body as Record<string, unknown>;
    if (typeof record.source_version_id !== "string" || !UUID_RE.test(record.source_version_id)) {
      throw new CreativeJobRequestError("invalid_source_version", 400);
    }
    if (typeof record.preset !== "string" || !record.preset) throw new CreativeJobRequestError("invalid_preset", 400);
    const presets = await imagePresets();
    if (!presets.codes.has(record.preset)) throw new CreativeJobRequestError("unknown_preset", 400);
    if (record.prompt !== undefined && (typeof record.prompt !== "string" || record.prompt.length > 4000)) {
      throw new CreativeJobRequestError("invalid_prompt", 400);
    }
    const source = await database().query<{ mime: string }>(
      `SELECT version.mime
         FROM tanaghom.creative_asset_versions version
         JOIN tanaghom.creative_assets asset ON asset.id = version.asset_id
        WHERE version.id = $1 AND asset.organization_id = $2`,
      [record.source_version_id, user.organizationId],
    );
    if (!source.rows[0]) throw new CreativeJobRequestError("source_not_found", 404);
    if (!["image/png", "image/jpeg", "image/webp"].includes(source.rows[0].mime)) {
      throw new CreativeJobRequestError("source_mime_unsupported", 415);
    }
    const headerKey = idempotencyKey(request);
    const correlationId = randomUUID();
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ ...record, headerKey })).digest("hex")}`;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.product", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      const params = {
        product_source_version_id: record.source_version_id,
        preset: record.preset,
        ...(typeof record.prompt === "string" && record.prompt.trim() ? { prompt: record.prompt.trim() } : {}),
      };
      let jobId: string;
      try {
        const created = await client.query<{ job_id: string }>(
          `SELECT tanaghom.create_creative_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS job_id`,
          [user.id, "product_shoot", "cpu", JSON.stringify(params), randomUUID(), correlationId, 0, 3, null, null, null],
        );
        jobId = created.rows[0].job_id;
      } catch (error) {
        if (error instanceof Error && /creative (open job limit|enqueue requires)/.test(error.message)) {
          throw new CreativeJobRequestError("open_job_limit_reached", 429);
        }
        throw error;
      }
      const responseBody = { ok: true, job_id: jobId, correlation_id: correlationId, preset: record.preset };
      await client.query(
        `INSERT INTO tanaghom.agent_actions_log (
           correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result
         ) VALUES ($1, $2, 'creative.job_enqueued', 'creative_job', $3, $4::jsonb, 'success')`,
        [correlationId, user.id, jobId, JSON.stringify({ capability: "product_shoot", preset: record.preset })],
      );
      await completeIdempotency(client, (slot as { reservation_id: string }).reservation_id, 200, responseBody);
      await client.query("COMMIT");
      return noStore(responseBody);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof CreativeJobRequestError || error instanceof IdempotencyRequestError) {
      return noStore({ error: error.code }, { status: error.status });
    }
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    throw error;
  }
}
