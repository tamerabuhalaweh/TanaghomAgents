import "server-only";

import { createHash } from "node:crypto";
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

export function imageGenerationEnabled() {
  return process.env.IMAGE_GENERATION_ENABLED === "true";
}

export function productStudioEnabled() {
  return process.env.PRODUCT_STUDIO_ENABLED === "true";
}

// Informational estimate only: no credits exist in P2a. schnell pricing is
// $0.003 per megapixel rounded up, per fal.ai schnell pricing.
export const IMAGE_UNIT_PRICE_USD_PER_MP = 0.003;

export function estimateImageCostUsd(width: number, height: number, variants: number) {
  return Math.ceil((width * height) / 1_000_000) * IMAGE_UNIT_PRICE_USD_PER_MP * variants;
}

function derivedUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const IMAGE_CAPABILITIES = new Set(["image", "product_shoot"]);

export async function submitGeneration(request: NextRequest) {
  try {
    requireCreativeStudio();
    if (!imageGenerationEnabled()) {
      return noStore({ error: "image_generation_disabled" }, { status: 503 });
    }
    enforceSameOriginForCookieMutation(request);
    const [user, body] = await Promise.all([
      authorize(request, ["owner", "operator"]),
      request.json().catch(() => { throw new CreativeJobRequestError("invalid_json", 400); }),
    ]);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CreativeJobRequestError("invalid_request", 400);
    const record = body as Record<string, unknown>;
    if (!IMAGE_CAPABILITIES.has(record.capability as string)) throw new CreativeJobRequestError("invalid_capability", 400);
    const capability = record.capability as string;
    if (capability === "product_shoot" && !productStudioEnabled()) {
      return noStore({ error: "product_studio_disabled" }, { status: 503 });
    }
    if (typeof record.prompt !== "string" || !record.prompt.trim() || record.prompt.length > 4000) {
      throw new CreativeJobRequestError("invalid_prompt", 400);
    }
    const width = record.width === undefined ? 1024 : record.width;
    const height = record.height === undefined ? 1024 : record.height;
    const variants = record.variants === undefined ? 1 : record.variants;
    if (!Number.isInteger(width) || (width as number) < 256 || (width as number) > 2048) {
      throw new CreativeJobRequestError("invalid_size", 400);
    }
    if (!Number.isInteger(height) || (height as number) < 256 || (height as number) > 2048) {
      throw new CreativeJobRequestError("invalid_size", 400);
    }
    if (!Number.isInteger(variants) || (variants as number) < 1 || (variants as number) > 4) {
      throw new CreativeJobRequestError("invalid_variants", 400);
    }
    if (typeof record.correlation_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.correlation_id)) {
      throw new CreativeJobRequestError("invalid_correlation_id", 400);
    }
    const headerKey = idempotencyKey(request);
    const correlationId = record.correlation_id as string;
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ ...record, headerKey })).digest("hex")}`;
    const lane = capability === "product_shoot" ? "cpu" : "gpu_image";
    const estimate = estimateImageCostUsd(width as number, height as number, variants as number);
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.generate", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      const jobIds: string[] = [];
      for (let index = 0; index < (variants as number); index += 1) {
        const created = await client.query<{ job_id: string }>(
          `SELECT tanaghom.create_creative_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS job_id`,
          [user.id, capability, lane,
            JSON.stringify({
              prompt: (record.prompt as string).trim(), width, height, variant_index: index,
              variants: variants as number,
              ...(typeof record.preset === "string" ? { preset: record.preset } : {}),
              ...(typeof record.source_version_id === "string" ? { source_version_id: record.source_version_id } : {}),
              ...(typeof record.brand_kit_version_id === "string" ? { brand_kit_version_id: record.brand_kit_version_id } : {}),
            }),
            derivedUuid(`${headerKey}:${index}`), correlationId,
            0, 3, null, null, null],
        );
        jobIds.push(created.rows[0].job_id);
        await client.query(
          `INSERT INTO tanaghom.agent_actions_log (
             correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result
           ) VALUES ($1, $2, 'creative.job_enqueued', 'creative_job', $3, $4::jsonb, 'success')`,
          [correlationId, user.id, created.rows[0].job_id, JSON.stringify({ capability, lane, variant_index: index })],
        );
      }
      const responseBody = {
        ok: true, correlation_id: correlationId, job_ids: jobIds,
        estimate: { unit: "megapixel", unit_price_usd: IMAGE_UNIT_PRICE_USD_PER_MP, estimated_cost_usd: estimate, informational_only: true },
      };
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
