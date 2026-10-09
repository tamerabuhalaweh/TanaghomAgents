import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { noStore } from "@/lib/server/responses";
import { requireCreativeStudio, CreativeDisabledError, designStudioEnabled, carouselBuilderEnabled } from "@/lib/server/creative/feature-control";
import {
  IdempotencyRequestError,
  completeIdempotency,
  idempotencyKey,
  reserveIdempotency,
} from "@/lib/server/creative/idempotency";
import { CreativeJobRequestError } from "@/lib/server/creative/jobs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const NODE_KEYS = new Set([
  "id", "type", "x", "y", "width", "height", "text", "role", "font_size",
  "font_weight", "align", "color", "background_color", "asset_version_id", "corner_radius",
]);
const NODE_TYPES = new Set(["text", "image", "shape", "badge"]);
export const DESIGN_FORMATS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Rejects anything that could smuggle code, styling, or remote references
// into a design document: URLs, schemes, markup, and unknown properties
// are all refused before persistence.
const UNSAFE_STRING = /https?:|javascript:|data:text\/html|<script|<\/script|<iframe|<style|on\w+\s*=/i;

function assertSafeValue(value: unknown, path: string) {
  if (typeof value === "string") {
    if (value.length > 2000) throw new CreativeJobRequestError(`invalid_design:${path}_too_long`, 400);
    if (UNSAFE_STRING.test(value)) throw new CreativeJobRequestError(`invalid_design:unsafe_${path}`, 400);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 24) throw new CreativeJobRequestError(`invalid_design:${path}_too_many`, 400);
    value.forEach((entry, index) => assertSafeValue(entry, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (!/^[A-Za-z0-9_]{1,80}$/.test(key)) throw new CreativeJobRequestError(`invalid_design:bad_key_${path}`, 400);
      assertSafeValue(entry, `${path}.${key}`);
    }
  }
}

function assertInt(value: unknown, min: number, max: number, code: string) {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new CreativeJobRequestError(code, 400);
  }
}

function validateNode(node: unknown, canvas: { width: number; height: number }) {
  if (!isRecord(node)) throw new CreativeJobRequestError("invalid_design:node_shape", 400);
  for (const key of Object.keys(node)) {
    if (!NODE_KEYS.has(key)) throw new CreativeJobRequestError("invalid_design:unknown_node_property", 400);
  }
  if (typeof node.id !== "string" || !ID_RE.test(node.id)) throw new CreativeJobRequestError("invalid_design:node_id", 400);
  if (!NODE_TYPES.has(node.type as string)) throw new CreativeJobRequestError("invalid_design:node_type", 400);
  assertInt(node.x, 0, canvas.width, "invalid_design:node_x");
  assertInt(node.y, 0, canvas.height, "invalid_design:node_y");
  assertInt(node.width, 8, canvas.width, "invalid_design:node_width");
  assertInt(node.height, 8, canvas.height, "invalid_design:node_height");
  if ((node.x as number) + (node.width as number) > canvas.width
    || (node.y as number) + (node.height as number) > canvas.height) {
    throw new CreativeJobRequestError("invalid_design:node_out_of_canvas", 400);
  }
  if (node.type === "text") {
    if (typeof node.text !== "string" || !node.text.length || node.text.length > 2000) {
      throw new CreativeJobRequestError("invalid_design:node_text", 400);
    }
  }
  if (node.type === "image" && (typeof node.asset_version_id !== "string" || !UUID_RE.test(node.asset_version_id))) {
    throw new CreativeJobRequestError("invalid_design:image_asset_ref", 400);
  }
  for (const field of ["color", "background_color"] as const) {
    if (node[field] !== undefined && (typeof node[field] !== "string" || !HEX_COLOR.test(node[field] as string))) {
      throw new CreativeJobRequestError("invalid_design:node_color", 400);
    }
  }
  if (node.font_size !== undefined) assertInt(node.font_size, 10, 220, "invalid_design:font_size");
  if (node.font_weight !== undefined && ![400, 500, 600, 700, 800].includes(node.font_weight as number)) {
    throw new CreativeJobRequestError("invalid_design:font_weight", 400);
  }
  if (node.align !== undefined && !["start", "end", "center"].includes(node.align as string)) {
    throw new CreativeJobRequestError("invalid_design:node_align", 400);
  }
  if (node.corner_radius !== undefined) assertInt(node.corner_radius, 0, 540, "invalid_design:corner_radius");
  if (node.role !== undefined && typeof node.role !== "string") throw new CreativeJobRequestError("invalid_design:node_role", 400);
}

export function validateDesignSpec(kind: string, spec: unknown) {
  if (!isRecord(spec)) throw new CreativeJobRequestError("invalid_design:spec_shape", 400);
  assertSafeValue(spec, "spec");
  if (spec.locale !== "ar" && spec.locale !== "en") throw new CreativeJobRequestError("invalid_design:locale", 400);
  if (spec.direction !== "rtl" && spec.direction !== "ltr") throw new CreativeJobRequestError("invalid_design:direction", 400);
  if ((spec.locale === "ar" && spec.direction !== "rtl") || (spec.locale === "en" && spec.direction !== "ltr")) {
    throw new CreativeJobRequestError("invalid_design:locale_direction_mismatch", 400);
  }
  const canvas = spec.canvas as Record<string, unknown> | undefined;
  if (!isRecord(canvas) || canvas.width !== 1080 || ![1080, 1350, 1920].includes(canvas.height as number)) {
    throw new CreativeJobRequestError("invalid_design:canvas_size", 400);
  }
  const canvasSize = { width: 1080, height: canvas.height as number };
  if (kind === "carousel") {
    if (!Array.isArray(spec.pages) || spec.pages.length < 2 || spec.pages.length > 10) {
      throw new CreativeJobRequestError("invalid_design:page_count", 400);
    }
    const seen = new Set<string>();
    for (const page of spec.pages) {
      if (!isRecord(page) || typeof page.id !== "string" || !ID_RE.test(page.id)) {
        throw new CreativeJobRequestError("invalid_design:page_id", 400);
      }
      if (seen.has(page.id)) throw new CreativeJobRequestError("invalid_design:duplicate_page_id", 400);
      seen.add(page.id);
      if (!["cover", "body", "end"].includes(page.kind as string)) throw new CreativeJobRequestError("invalid_design:page_kind", 400);
      if (!Array.isArray(page.nodes) || page.nodes.length < 1 || page.nodes.length > 24) {
        throw new CreativeJobRequestError("invalid_design:page_node_count", 400);
      }
      const nodeIds = new Set<string>();
      for (const node of page.nodes) {
        validateNode(node, canvasSize);
        if (nodeIds.has((node as Record<string, string>).id)) throw new CreativeJobRequestError("invalid_design:duplicate_node_id", 400);
        nodeIds.add((node as Record<string, string>).id);
      }
    }
    return;
  }
  if (!Array.isArray(spec.nodes) || spec.nodes.length < 1 || spec.nodes.length > 24) {
    throw new CreativeJobRequestError("invalid_design:node_count", 400);
  }
  const nodeIds = new Set<string>();
  for (const node of spec.nodes) {
    validateNode(node, canvasSize);
    if (nodeIds.has((node as Record<string, string>).id)) throw new CreativeJobRequestError("invalid_design:duplicate_node_id", 400);
    nodeIds.add((node as Record<string, string>).id);
  }
}

async function bodyJson(request: NextRequest) {
  try {
    const body = await request.json();
    if (!isRecord(body)) throw new CreativeJobRequestError("invalid_json", 400);
    return body;
  } catch (error) {
    if (error instanceof CreativeJobRequestError) throw error;
    throw new CreativeJobRequestError("invalid_json", 400);
  }
}

async function audit(client: { query: (text: string, params: unknown[]) => Promise<unknown> }, userId: string, action: string, templateId: string, payload: unknown) {
  await client.query(
    `INSERT INTO tanaghom.agent_actions_log (
       correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result
     ) VALUES ($1, $2, $3, 'creative_template', $4, $5::jsonb, 'success')`,
    [randomUUID(), userId, action, templateId, JSON.stringify(payload)],
  );
}

function requireDesignKind(kind: string) {
  if (kind === "carousel" && !carouselBuilderEnabled()) {
    throw new CreativeJobRequestError("carousel_builder_disabled", 503);
  }
  if (kind === "ad" && !designStudioEnabled()) {
    throw new CreativeJobRequestError("design_studio_disabled", 503);
  }
}

function mapDbError(error: unknown): never {
  if (error instanceof Error) {
    if (/template requires owner/.test(error.message)) throw new CreativeJobRequestError("forbidden", 403);
    if (/unknown creative template/.test(error.message)) throw new CreativeJobRequestError("template_not_found", 404);
    if (/cross-tenant template/.test(error.message)) throw new CreativeJobRequestError("forbidden", 403);
    if (/global template is read-only/.test(error.message)) throw new CreativeJobRequestError("forbidden", 403);
    if (/duplicate key|unique/i.test(error.message)) throw new CreativeJobRequestError("duplicate_version", 409);
    if (/invalid creative template|oversized template/.test(error.message)) throw new CreativeJobRequestError("invalid_template", 400);
  }
  throw error;
}

export async function createDesign(request: NextRequest) {
  try {
    requireCreativeStudio();
    enforceSameOriginForCookieMutation(request);
    const [user, body] = await Promise.all([authorize(request, ["owner"]), bodyJson(request)]);
    const kind = body.kind as string;
    if (kind !== "ad" && kind !== "carousel") throw new CreativeJobRequestError("invalid_kind", 400);
    requireDesignKind(kind);
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) {
      throw new CreativeJobRequestError("invalid_name", 400);
    }
    validateDesignSpec(kind, body.spec);
    const headerKey = idempotencyKey(request);
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ ...body, headerKey })).digest("hex")}`;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.design.create", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      let templateId: string;
      try {
        const created = await client.query<{ id: string }>(
          `SELECT tanaghom.create_creative_template($1,$2,$3,$4) AS id`,
          [user.id, kind, (body.name as string).trim(), JSON.stringify(body.spec)],
        );
        templateId = created.rows[0].id;
      } catch (error) { mapDbError(error); }
      const responseBody = { ok: true, template_id: templateId! };
      await audit(client, user.id, "creative.design_created_api", templateId!, { kind });
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

export async function createDesignVersion(request: NextRequest, templateId: string) {
  try {
    requireCreativeStudio();
    enforceSameOriginForCookieMutation(request);
    if (!UUID_RE.test(templateId)) return noStore({ error: "invalid_template_id" }, { status: 400 });
    const [user, body] = await Promise.all([authorize(request, ["owner"]), bodyJson(request)]);
    const current = await database().query<{ kind: string; name: string; organization_id: string | null }>(
      `SELECT kind, name, organization_id FROM tanaghom.creative_templates WHERE id = $1`,
      [templateId],
    );
    const row = current.rows[0];
    if (!row || (row.kind !== "ad" && row.kind !== "carousel")) return noStore({ error: "template_not_found" }, { status: 404 });
    if (row.organization_id !== null && row.organization_id !== user.organizationId) {
      return noStore({ error: "forbidden" }, { status: 403 });
    }
    if (row.organization_id === null) return noStore({ error: "forbidden" }, { status: 403 });
    requireDesignKind(row.kind as string);
    validateDesignSpec(row.kind, body.spec);
    const headerKey = idempotencyKey(request);
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ template_id: templateId, ...body, headerKey })).digest("hex")}`;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.design.version", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      // New versions reuse the template row identity (kind/name/scope), so
      // version numbering stays scoped exactly like creation.
      let versionId: string;
      try {
        const created = await client.query<{ id: string }>(
          `SELECT tanaghom.create_creative_template($1,$2,$3,$4) AS id`,
          [user.id, row.kind, row.name, JSON.stringify((body as Record<string, unknown>).spec)],
        );
        versionId = created.rows[0].id;
      } catch (error) { mapDbError(error); }
      const responseBody = { ok: true, template_id: templateId, version_id: versionId! };
      await audit(client, user.id, "creative.design_version_created_api", templateId, { version_id: versionId! });
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

export async function listDesigns(request: NextRequest) {
  try {
    requireCreativeStudio();
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const kind = request.nextUrl.searchParams.get("kind") || "";
    if (kind && kind !== "ad" && kind !== "carousel") throw new CreativeJobRequestError("invalid_kind", 400);
    const result = await database().query(
      `SELECT id AS template_id, organization_id, kind, name, version, is_active, created_at
         FROM tanaghom.creative_templates
        WHERE (kind = 'ad' OR kind = 'carousel')
          AND ($1::text IS NULL OR kind = $1)
          AND (organization_id = $2 OR organization_id IS NULL)
        ORDER BY kind, name, version DESC
        LIMIT 100`,
      [kind || null, user.organizationId],
    );
    return noStore({ designs: result.rows });
  } catch (error) {
    if (error instanceof CreativeJobRequestError) {
      return noStore({ error: error.code }, { status: error.status });
    }
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    throw error;
  }
}

export async function getDesign(request: NextRequest, templateId: string) {
  try {
    requireCreativeStudio();
    if (!UUID_RE.test(templateId)) return noStore({ error: "invalid_template_id" }, { status: 400 });
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const head = await database().query(
      `SELECT id AS template_id, organization_id, kind, name, version, is_active, spec, created_at
         FROM tanaghom.creative_templates WHERE id = $1 AND (kind = 'ad' OR kind = 'carousel')`,
      [templateId],
    );
    const row = head.rows[0] as Record<string, unknown> | undefined;
    if (!row) return noStore({ error: "design_not_found" }, { status: 404 });
    if (row.organization_id !== null && row.organization_id !== user.organizationId) {
      return noStore({ error: "design_not_found" }, { status: 404 });
    }
    const versions = row.organization_id === null
      ? await database().query(
        `SELECT id AS template_id, version, is_active, created_at
           FROM tanaghom.creative_templates
          WHERE kind = $1 AND name = $2 AND organization_id IS NULL
          ORDER BY version ASC`,
        [row.kind, row.name],
      )
      : await database().query(
        `SELECT id AS template_id, version, is_active, created_at
           FROM tanaghom.creative_templates
          WHERE kind = $1 AND name = $2 AND organization_id = $3
          ORDER BY version ASC`,
        [row.kind, row.name, row.organization_id],
      );
    return noStore({ design: row, versions: versions.rows });
  } catch (error) {
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    throw error;
  }
}
