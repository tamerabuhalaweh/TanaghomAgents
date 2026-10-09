import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { noStore } from "@/lib/server/responses";
import { requireCreativeStudio, CreativeDisabledError, motionStudioEnabled } from "@/lib/server/creative/feature-control";
import {
  IdempotencyRequestError,
  completeIdempotency,
  idempotencyKey,
  reserveIdempotency,
} from "@/lib/server/creative/idempotency";
import { CreativeJobRequestError } from "@/lib/server/creative/jobs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MOTION_PRESETS = new Set(["none", "fade", "slide", "scale", "reveal"]);
const TRANSITION_PRESETS = new Set(["none", "fade", "slide", "scale"]);
const DIRECTIONS = new Set(["up", "down", "start", "end"]);
const EASINGS = new Set(["linear", "ease", "ease-in", "ease-out", "ease-in-out"]);

// Same smuggling guard as designs: URLs, schemes, markup, and handler
// attributes are refused before persistence (the renderer escapes anyway).
const UNSAFE_STRING = /https?:|javascript:|data:text\/html|<script|<\/script|<iframe|<style|on\w+\s*=/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertSafeValue(value: unknown, path: string) {
  if (typeof value === "string") {
    if (value.length > 2000) throw new CreativeJobRequestError(`invalid_motion:${path}_too_long`, 400);
    if (UNSAFE_STRING.test(value)) throw new CreativeJobRequestError(`invalid_motion:unsafe_${path}`, 400);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 48) throw new CreativeJobRequestError(`invalid_motion:${path}_too_many`, 400);
    value.forEach((entry, index) => assertSafeValue(entry, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (!/^[A-Za-z0-9_]{1,80}$/.test(key)) throw new CreativeJobRequestError(`invalid_motion:bad_key_${path}`, 400);
      assertSafeValue(entry, `${path}.${key}`);
    }
  }
}

function assertInt(value: unknown, min: number, max: number, code: string) {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new CreativeJobRequestError(code, 400);
  }
}

interface DesignRef {
  kind: string;
  name: string;
  version: number;
  spec: Record<string, unknown>;
}

async function loadDesign(templateId: string, organizationId: string): Promise<DesignRef | null> {
  const result = await database().query(
    `SELECT kind, name, version, spec, organization_id FROM tanaghom.creative_templates WHERE id = $1`,
    [templateId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || (row.kind !== "ad" && row.kind !== "carousel")) return null;
  if (row.organization_id !== null && row.organization_id !== organizationId) return null;
  return row as unknown as DesignRef;
}

function designPageNodeIds(design: DesignRef): Map<string, Set<string>> {
  const spec = design.spec;
  const pages = new Map<string, Set<string>>();
  if (design.kind === "carousel") {
    for (const page of (spec.pages ?? []) as Array<{ id: string; nodes: Array<{ id: string }> }>) {
      pages.set(page.id, new Set((page.nodes ?? []).map((node) => node.id)));
    }
    return pages;
  }
  pages.set("page-1", new Set(((spec.nodes ?? []) as Array<{ id: string }>).map((node) => node.id)));
  return pages;
}

export function validateMotionSpec(spec: unknown, design: DesignRef) {
  if (!isRecord(spec)) throw new CreativeJobRequestError("invalid_motion:spec_shape", 400);
  assertSafeValue(spec, "spec");
  if (spec.locale !== "ar" && spec.locale !== "en") throw new CreativeJobRequestError("invalid_motion:locale", 400);
  if (spec.direction !== "rtl" && spec.direction !== "ltr") throw new CreativeJobRequestError("invalid_motion:direction", 400);
  if ((spec.locale === "ar" && spec.direction !== "rtl") || (spec.locale === "en" && spec.direction !== "ltr")) {
    throw new CreativeJobRequestError("invalid_motion:locale_direction_mismatch", 400);
  }
  const designSpec = design.spec;
  if (spec.locale !== designSpec.locale || spec.direction !== designSpec.direction) {
    throw new CreativeJobRequestError("invalid_motion:locale_direction_design_mismatch", 400);
  }
  if (spec.fps !== 24 && spec.fps !== 30) throw new CreativeJobRequestError("invalid_motion:fps_allowlist", 400);
  const pages = designPageNodeIds(design);
  if (!Array.isArray(spec.scenes) || spec.scenes.length < 1 || spec.scenes.length > 10) {
    throw new CreativeJobRequestError("invalid_motion:scene_count", 400);
  }
  const seenScenes = new Set<string>();
  let totalMs = 0;
  for (const scene of spec.scenes) {
    if (!isRecord(scene) || typeof scene.id !== "string" || !ID_RE.test(scene.id)) {
      throw new CreativeJobRequestError("invalid_motion:scene_id", 400);
    }
    if (seenScenes.has(scene.id)) throw new CreativeJobRequestError("invalid_motion:duplicate_scene_id", 400);
    seenScenes.add(scene.id);
    if (typeof scene.page_id !== "string" || !pages.has(scene.page_id)) {
      throw new CreativeJobRequestError("invalid_motion:scene_page_unknown", 400);
    }
    assertInt(scene.duration_ms, 500, 10000, "invalid_motion:scene_duration");
    totalMs += scene.duration_ms as number;
    const transition = (scene.transition ?? { preset: "none" }) as Record<string, unknown>;
    if (!isRecord(transition) || !TRANSITION_PRESETS.has(transition.preset as string)) {
      throw new CreativeJobRequestError("invalid_motion:transition_preset", 400);
    }
    if (transition.direction !== undefined && !DIRECTIONS.has(transition.direction as string)) {
      throw new CreativeJobRequestError("invalid_motion:transition_direction", 400);
    }
    if (transition.duration_ms !== undefined) assertInt(transition.duration_ms, 200, 2000, "invalid_motion:transition_duration");
  }
  if (totalMs > 30000) throw new CreativeJobRequestError("invalid_motion:total_duration", 400);
  if (Math.round((totalMs * (spec.fps as number)) / 1000) > 900 || Math.round((totalMs * (spec.fps as number)) / 1000) < 1) {
    throw new CreativeJobRequestError("invalid_motion:frame_count", 400);
  }
  if (!Array.isArray(spec.elements) || spec.elements.length < 1 || spec.elements.length > 48) {
    throw new CreativeJobRequestError("invalid_motion:element_count", 400);
  }
  const allNodes = new Set<string>();
  for (const ids of pages.values()) for (const id of ids) allNodes.add(id);
  for (const element of spec.elements) {
    if (!isRecord(element) || typeof element.node_id !== "string" || !allNodes.has(element.node_id)) {
      throw new CreativeJobRequestError("invalid_motion:element_node_unknown", 400);
    }
    if (!MOTION_PRESETS.has(element.preset as string)) throw new CreativeJobRequestError("invalid_motion:element_preset", 400);
    if (element.direction !== undefined && !DIRECTIONS.has(element.direction as string)) {
      throw new CreativeJobRequestError("invalid_motion:element_direction", 400);
    }
    if (element.delay_ms !== undefined) assertInt(element.delay_ms, 0, 30000, "invalid_motion:element_delay");
    if (element.duration_ms !== undefined) assertInt(element.duration_ms, 200, 10000, "invalid_motion:element_duration");
    if (element.easing !== undefined && !EASINGS.has(element.easing as string)) {
      throw new CreativeJobRequestError("invalid_motion:element_easing", 400);
    }
    if (element.scene_id !== undefined) {
      if (typeof element.scene_id !== "string" || !seenScenes.has(element.scene_id)) {
        throw new CreativeJobRequestError("invalid_motion:element_scene_unknown", 400);
      }
      const scene = (spec.scenes as Array<Record<string, unknown>>).find((candidate) => candidate.id === element.scene_id);
      const sceneNodes = pages.get(scene?.page_id as string) ?? new Set<string>();
      if (!sceneNodes.has(element.node_id as string)) {
        throw new CreativeJobRequestError("invalid_motion:element_node_not_in_scene", 400);
      }
    }
  }
  if (spec.captions !== undefined) {
    if (!Array.isArray(spec.captions) || spec.captions.length > 12) {
      throw new CreativeJobRequestError("invalid_motion:caption_count", 400);
    }
    for (const caption of spec.captions) {
      if (!isRecord(caption) || typeof caption.text !== "string" || !caption.text.length || caption.text.length > 280) {
        throw new CreativeJobRequestError("invalid_motion:caption_text", 400);
      }
      assertInt(caption.start_ms, 0, 30000, "invalid_motion:caption_start");
      assertInt(caption.end_ms, 1, 30000, "invalid_motion:caption_end");
      if ((caption.end_ms as number) <= (caption.start_ms as number)) {
        throw new CreativeJobRequestError("invalid_motion:caption_range", 400);
      }
      if ((caption.end_ms as number) > totalMs) throw new CreativeJobRequestError("invalid_motion:caption_beyond_timeline", 400);
    }
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

function requireMotionStudio() {
  if (!motionStudioEnabled()) throw new CreativeJobRequestError("motion_studio_disabled", 503);
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

export async function createMotion(request: NextRequest) {
  try {
    requireCreativeStudio();
    requireMotionStudio();
    enforceSameOriginForCookieMutation(request);
    const [user, body] = await Promise.all([authorize(request, ["owner"]), bodyJson(request)]);
    if (typeof body.design_template_id !== "string" || !UUID_RE.test(body.design_template_id)) {
      throw new CreativeJobRequestError("invalid_design_template_id", 400);
    }
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) {
      throw new CreativeJobRequestError("invalid_name", 400);
    }
    const design = await loadDesign(body.design_template_id, user.organizationId);
    if (!design) return noStore({ error: "design_not_found" }, { status: 404 });
    validateMotionSpec(body.spec, design);
    const headerKey = idempotencyKey(request);
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ ...body, headerKey })).digest("hex")}`;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.motion.create", headerKey, requestHash);
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
          [user.id, "motion", (body.name as string).trim(), JSON.stringify({ kind: "motion", ...(body.spec as Record<string, unknown>), design_template_id: body.design_template_id, design_version: design.version })],
        );
        templateId = created.rows[0].id;
      } catch (error) { mapDbError(error); }
      const responseBody = { ok: true, template_id: templateId! };
      await audit(client, user.id, "creative.motion_created_api", templateId!, { design_template_id: body.design_template_id });
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

export async function createMotionVersion(request: NextRequest, templateId: string) {
  try {
    requireCreativeStudio();
    requireMotionStudio();
    enforceSameOriginForCookieMutation(request);
    if (!UUID_RE.test(templateId)) return noStore({ error: "invalid_template_id" }, { status: 400 });
    const [user, body] = await Promise.all([authorize(request, ["owner"]), bodyJson(request)]);
    const current = await database().query<{ kind: string; name: string; organization_id: string | null; spec: unknown }>(
      `SELECT kind, name, organization_id, spec FROM tanaghom.creative_templates WHERE id = $1`,
      [templateId],
    );
    const row = current.rows[0];
    if (!row || row.kind !== "motion") return noStore({ error: "template_not_found" }, { status: 404 });
    if (row.organization_id !== null && row.organization_id !== user.organizationId) {
      return noStore({ error: "forbidden" }, { status: 403 });
    }
    if (row.organization_id === null) return noStore({ error: "forbidden" }, { status: 403 });
    const designTemplateId = (row.spec as Record<string, unknown>).design_template_id as string
      ?? (body.spec as Record<string, unknown>)?.design_template_id as string;
    const design = designTemplateId ? await loadDesign(designTemplateId, user.organizationId) : null;
    if (!design) return noStore({ error: "design_not_found" }, { status: 404 });
    validateMotionSpec({ ...(body.spec as Record<string, unknown>), design_template_id: designTemplateId }, design);
    const headerKey = idempotencyKey(request);
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ template_id: templateId, ...body, headerKey })).digest("hex")}`;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.motion.version", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      let versionId: string;
      try {
        const created = await client.query<{ id: string }>(
          `SELECT tanaghom.create_creative_template($1,$2,$3,$4) AS id`,
          [user.id, row.kind, row.name, JSON.stringify({ kind: "motion", ...((body as Record<string, unknown>).spec as Record<string, unknown>), design_template_id: designTemplateId, design_version: design.version })],
        );
        versionId = created.rows[0].id;
      } catch (error) { mapDbError(error); }
      const responseBody = { ok: true, template_id: templateId, version_id: versionId! };
      await audit(client, user.id, "creative.motion_version_created_api", templateId, { version_id: versionId! });
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

export async function listMotions(request: NextRequest) {
  try {
    requireCreativeStudio();
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const result = await database().query(
      `SELECT id AS template_id, organization_id, kind, name, version, is_active, created_at
         FROM tanaghom.creative_templates
        WHERE kind = 'motion'
          AND (organization_id = $1 OR organization_id IS NULL)
        ORDER BY name, version DESC
        LIMIT 100`,
      [user.organizationId],
    );
    return noStore({ motions: result.rows });
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

export async function getMotion(request: NextRequest, templateId: string) {
  try {
    requireCreativeStudio();
    if (!UUID_RE.test(templateId)) return noStore({ error: "invalid_template_id" }, { status: 400 });
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const head = await database().query(
      `SELECT id AS template_id, organization_id, kind, name, version, is_active, spec, created_at
         FROM tanaghom.creative_templates WHERE id = $1 AND kind = 'motion'`,
      [templateId],
    );
    const row = head.rows[0] as Record<string, unknown> | undefined;
    if (!row) return noStore({ error: "motion_not_found" }, { status: 404 });
    if (row.organization_id !== null && row.organization_id !== user.organizationId) {
      return noStore({ error: "motion_not_found" }, { status: 404 });
    }
    const versions = row.organization_id === null
      ? await database().query(
        `SELECT id AS template_id, version, is_active, created_at
           FROM tanaghom.creative_templates
          WHERE kind = 'motion' AND name = $1 AND organization_id IS NULL
          ORDER BY version ASC`,
        [row.name],
      )
      : await database().query(
        `SELECT id AS template_id, version, is_active, created_at
           FROM tanaghom.creative_templates
          WHERE kind = 'motion' AND name = $1 AND organization_id = $2
          ORDER BY version ASC`,
        [row.name, row.organization_id],
      );
    return noStore({ motion: row, versions: versions.rows });
  } catch (error) {
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    throw error;
  }
}
