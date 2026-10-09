import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { noStore } from "@/lib/server/responses";
import {
  requireCreativeStudio,
  CreativeDisabledError,
  designStudioEnabled,
  carouselBuilderEnabled,
} from "@/lib/server/creative/feature-control";
import {
  IdempotencyRequestError,
  completeIdempotency,
  idempotencyKey,
  reserveIdempotency,
} from "@/lib/server/creative/idempotency";
import { CreativeJobRequestError } from "@/lib/server/creative/jobs";
import { DESIGN_FORMATS } from "@/lib/server/creative/designs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requestDesignRender(request: NextRequest, templateId: string) {
  try {
    requireCreativeStudio();
    enforceSameOriginForCookieMutation(request);
    if (!UUID_RE.test(templateId)) return noStore({ error: "invalid_template_id" }, { status: 400 });
    const [user, body] = await Promise.all([
      authorize(request, ["owner", "operator"]),
      request.json().catch(() => { throw new CreativeJobRequestError("invalid_json", 400); }),
    ]);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CreativeJobRequestError("invalid_request", 400);
    const record = body as Record<string, unknown>;
    const format = record.format as string;
    if (!DESIGN_FORMATS[format]) throw new CreativeJobRequestError("invalid_format", 400);
    if (record.version !== undefined && (!Number.isInteger(record.version) || (record.version as number) < 1)) {
      throw new CreativeJobRequestError("invalid_version", 400);
    }
    for (const field of ["brand_kit_version_id", "asset_id"] as const) {
      const value = record[field];
      if (value !== undefined && value !== null && (typeof value !== "string" || !UUID_RE.test(value))) {
        throw new CreativeJobRequestError(`invalid_${field}`, 400);
      }
    }
    const template = await database().query<{
      id: string; organization_id: string | null; kind: string; name: string;
      version: number; is_active: boolean; spec: unknown;
    }>(
      `SELECT id, organization_id, kind, name, version, is_active, spec
         FROM tanaghom.creative_templates
        WHERE id = $1 AND (kind = 'ad' OR kind = 'carousel')`,
      [templateId],
    );
    const row = template.rows[0];
    if (!row) return noStore({ error: "design_not_found" }, { status: 404 });
    if (row.organization_id !== null && row.organization_id !== user.organizationId) {
      return noStore({ error: "design_not_found" }, { status: 404 });
    }
    if (row.kind === "carousel" && !carouselBuilderEnabled()) {
      return noStore({ error: "carousel_builder_disabled" }, { status: 503 });
    }
    if (row.kind === "ad" && !designStudioEnabled()) {
      return noStore({ error: "design_studio_disabled" }, { status: 503 });
    }
    if (!row.is_active) return noStore({ error: "design_inactive" }, { status: 409 });
    const wanted = typeof record.version === "number" ? record.version : row.version;
    // Exact scope match only: org rows never resolve globals and vice versa.
    const scoped = await database().query<{ id: string; version: number; spec: unknown }>(
      row.organization_id === null
        ? `SELECT id, version, spec FROM tanaghom.creative_templates
            WHERE kind = $1 AND name = $2 AND version = $3 AND organization_id IS NULL`
        : `SELECT id, version, spec FROM tanaghom.creative_templates
            WHERE kind = $1 AND name = $2 AND version = $3 AND organization_id = $4`,
      row.organization_id === null ? [row.kind, row.name, wanted] : [row.kind, row.name, wanted, row.organization_id],
    );
    const target = scoped.rows[0] as { id: string; version: number; spec: unknown } | undefined;
    if (!target) return noStore({ error: "design_version_not_found" }, { status: 404 });
    const spec = target.spec as Record<string, unknown>;
    const canvas = spec.canvas as { width: number; height: number };
    const expected = DESIGN_FORMATS[format];
    if (!canvas || canvas.width !== expected.width || canvas.height !== expected.height) {
      return noStore({ error: "format_canvas_mismatch" }, { status: 400 });
    }
    if (record.brand_kit_version_id) {
      const brand = await database().query(
        `SELECT 1 FROM tanaghom.brand_kit_versions v JOIN tanaghom.brand_kits k ON k.id = v.kit_id
          WHERE v.id = $1 AND k.organization_id = $2`,
        [record.brand_kit_version_id, user.organizationId],
      );
      if (!brand.rows[0]) return noStore({ error: "brand_kit_not_found" }, { status: 404 });
    }
    if (record.asset_id) {
      const asset = await database().query(
        `SELECT 1 FROM tanaghom.creative_assets WHERE id = $1 AND organization_id = $2`,
        [record.asset_id, user.organizationId],
      );
      if (!asset.rows[0]) return noStore({ error: "asset_not_found" }, { status: 404 });
    }
    const headerKey = idempotencyKey(request);
    const correlationId = randomUUID();
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ template_id: templateId, ...record, headerKey })).digest("hex")}`;
    const capability = row.kind === "carousel" ? "carousel" : "design";
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.render", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      const created = await client.query<{ job_id: string }>(
        `SELECT tanaghom.create_creative_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS job_id`,
        [user.id, capability, "cpu",
          JSON.stringify({
            design_template_id: target.id, design_version: target.version, format,
            width: expected.width, height: expected.height,
            ...(record.brand_kit_version_id ? { brand_kit_version_id: record.brand_kit_version_id } : {}),
            ...(record.asset_id ? { asset_id: record.asset_id } : {}),
          }),
          randomUUID(), correlationId, 0, 3, null, null, null],
      );
      const jobId = created.rows[0].job_id;
      const responseBody = { ok: true, job_id: jobId, correlation_id: correlationId, format };
      await client.query(
        `INSERT INTO tanaghom.agent_actions_log (
           correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result
         ) VALUES ($1, $2, 'creative.job_enqueued', 'creative_job', $3, $4::jsonb, 'success')`,
        [correlationId, user.id, jobId, JSON.stringify({ capability, format, design_version: target.version })],
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
