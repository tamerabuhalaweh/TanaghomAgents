import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { noStore } from "@/lib/server/responses";
import {
  CreativeDisabledError,
  requireCreativeStudio,
} from "@/lib/server/creative/feature-control";
import {
  IdempotencyRequestError,
  completeIdempotency,
  idempotencyKey,
  reserveIdempotency,
} from "@/lib/server/creative/idempotency";
import { CreativeJobRequestError } from "@/lib/server/creative/jobs";

const KINDS = new Set(["ad", "carousel", "motion", "landing", "caption"]);

async function bodyJson(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CreativeJobRequestError("invalid_json", 400);
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof CreativeJobRequestError) throw error;
    throw new CreativeJobRequestError("invalid_json", 400);
  }
}

function mapDbError(error: unknown): never {
  if (error instanceof Error) {
    if (/template requires owner/.test(error.message)) throw new CreativeJobRequestError("forbidden", 403);
    if (/global template is read-only/.test(error.message)) throw new CreativeJobRequestError("forbidden", 403);
    if (/unknown creative template/.test(error.message)) throw new CreativeJobRequestError("template_not_found", 404);
    if (/cross-tenant template/.test(error.message)) throw new CreativeJobRequestError("forbidden", 403);
    if (/duplicate key|unique/i.test(error.message)) throw new CreativeJobRequestError("duplicate_version", 409);
    if (/invalid creative template|oversized template/.test(error.message)) throw new CreativeJobRequestError("invalid_template", 400);
  }
  throw error;
}

async function audit(client: { query: (text: string, params: unknown[]) => Promise<unknown> }, userId: string, action: string, templateId: string, payload: unknown) {
  await client.query(
    `INSERT INTO tanaghom.agent_actions_log (
       correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result
     ) VALUES ($1, $2, $3, 'creative_template', $4, $5::jsonb, 'success')`,
    [randomUUID(), userId, action, templateId, JSON.stringify(payload)],
  );
}

export async function createCreativeTemplate(request: NextRequest) {
  try {
    requireCreativeStudio();
    enforceSameOriginForCookieMutation(request);
    const [user, body] = await Promise.all([authorize(request, ["owner"]), bodyJson(request)]);
    if (!KINDS.has(body.kind as string)) throw new CreativeJobRequestError("invalid_kind", 400);
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) {
      throw new CreativeJobRequestError("invalid_name", 400);
    }
    if (!body.spec || typeof body.spec !== "object" || Array.isArray(body.spec)) {
      throw new CreativeJobRequestError("invalid_spec", 400);
    }
    if (body.global === true) {
      // Platform-global rows are read-only to organization users; globals
      // are seeded only by a future explicit platform-admin authority.
      throw new CreativeJobRequestError("global_templates_read_only", 400);
    }
    const headerKey = idempotencyKey(request);
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ ...body, headerKey })).digest("hex")}`;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.template.create", headerKey, requestHash);
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
          [user.id, body.kind, (body.name as string).trim(), JSON.stringify(body.spec)],
        );
        templateId = created.rows[0].id;
      } catch (error) { mapDbError(error); }
      const responseBody = { ok: true, template_id: templateId! };
      await audit(client, user.id, "creative.template_version_created_api", templateId!, { kind: body.kind });
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

export async function listCreativeTemplates(request: NextRequest) {
  try {
    requireCreativeStudio();
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const result = await database().query(
      `SELECT id AS template_id, organization_id, kind, name, version, is_active, created_at
         FROM tanaghom.creative_templates
        WHERE organization_id = $1 OR organization_id IS NULL
        ORDER BY kind, name, version DESC
        LIMIT 100`,
      [user.organizationId],
    );
    return noStore({ templates: result.rows });
  } catch (error) {
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    throw error;
  }
}

export async function setCreativeTemplateActive(request: NextRequest, templateId: string) {
  try {
    requireCreativeStudio();
    enforceSameOriginForCookieMutation(request);
    if (!/^[0-9a-f-]{36}$/i.test(templateId)) return noStore({ error: "invalid_template_id" }, { status: 400 });
    const [user, body] = await Promise.all([authorize(request, ["owner"]), bodyJson(request)]);
    if (typeof body.active !== "boolean") return noStore({ error: "invalid_active" }, { status: 400 });
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      let active: boolean;
      try {
        const updated = await client.query<{ active: boolean }>(
          `SELECT tanaghom.set_creative_template_active($1,$2,$3) AS active`,
          [user.id, templateId, body.active],
        );
        active = updated.rows[0].active;
      } catch (error) { mapDbError(error); }
      const responseBody = { ok: true, template_id: templateId, is_active: active! };
      await audit(client, user.id, "creative.template_active_set_api", templateId, { active: active! });
      await client.query("COMMIT");
      return noStore(responseBody);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
