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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function objectField(value: unknown, code: string) {
  if (value !== undefined && (!isRecord(value))) throw new CreativeJobRequestError(code, 400);
  return (value ?? {}) as Record<string, unknown>;
}

function textField(value: unknown, max: number, code: string) {
  if (value !== undefined && value !== null && (typeof value !== "string" || value.length < 1 || value.length > max)) {
    throw new CreativeJobRequestError(code, 400);
  }
  return (value as string | null) ?? null;
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

async function audit(client: { query: (text: string, params: unknown[]) => Promise<unknown> }, userId: string, action: string, kitId: string, payload: unknown) {
  const correlationId = randomUUID();
  await client.query(
    `INSERT INTO tanaghom.agent_actions_log (
       correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result
     ) VALUES ($1, $2, $3, 'brand_kit', $4, $5::jsonb, 'success')`,
    [correlationId, userId, action, kitId, JSON.stringify(payload)],
  );
  return correlationId;
}

function mapDbError(error: unknown): never {
  if (error instanceof Error) {
    if (/brand kit requires owner/.test(error.message)) throw new CreativeJobRequestError("forbidden", 403);
    if (/unknown brand kit/.test(error.message)) throw new CreativeJobRequestError("kit_not_found", 404);
    if (/unknown brand kit version/.test(error.message)) throw new CreativeJobRequestError("version_not_found", 404);
    if (/duplicate key|unique/i.test(error.message)) throw new CreativeJobRequestError("duplicate_name", 409);
    if (/invalid brand kit|brand kit fields|brand kit text/.test(error.message)) throw new CreativeJobRequestError("invalid_brand_kit", 400);
  }
  throw error;
}

export async function createBrandKit(request: NextRequest) {
  try {
    requireCreativeStudio();
    enforceSameOriginForCookieMutation(request);
    const [user, body] = await Promise.all([authorize(request, ["owner"]), bodyJson(request)]);
    const name = textField(body.name, 120, "invalid_name");
    if (!name || !name.trim()) throw new CreativeJobRequestError("invalid_name", 400);
    const headerKey = idempotencyKey(request);
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ ...body, headerKey })).digest("hex")}`;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.brand_kit.create", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      let kitId: string;
      try {
        const created = await client.query<{ id: string }>(
          `SELECT tanaghom.create_brand_kit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS id`,
          [user.id, name.trim(), JSON.stringify(objectField(body.colors, "invalid_colors")),
            JSON.stringify(objectField(body.typography, "invalid_typography")),
            textField(body.arabic_font, 120, "invalid_font"), textField(body.latin_font, 120, "invalid_font"),
            JSON.stringify(objectField(body.logos, "invalid_logos")), textField(body.tone, 500, "invalid_tone"),
            JSON.stringify(objectField(body.rules, "invalid_rules")), JSON.stringify(objectField(body.cta, "invalid_cta")),
            JSON.stringify(objectField(body.channels, "invalid_channels"))],
        );
        kitId = created.rows[0].id;
      } catch (error) { mapDbError(error); }
      const responseBody = { ok: true, kit_id: kitId! };
      await audit(client, user.id, "creative.brand_kit_created_api", kitId!, { name: name.trim() });
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

export async function listBrandKits(request: NextRequest) {
  try {
    requireCreativeStudio();
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const result = await database().query(
      `SELECT kit.id AS kit_id, kit.name, kit.current_version, kit.created_at,
              (SELECT count(*)::int FROM tanaghom.brand_kit_versions WHERE kit_id = kit.id) AS versions
         FROM tanaghom.brand_kits kit
        WHERE kit.organization_id = $1
        ORDER BY kit.created_at DESC
        LIMIT 50`,
      [user.organizationId],
    );
    return noStore({ kits: result.rows });
  } catch (error) {
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    throw error;
  }
}

export async function getBrandKit(request: NextRequest, kitId: string) {
  try {
    requireCreativeStudio();
    if (!/^[0-9a-f-]{36}$/i.test(kitId)) return noStore({ error: "invalid_kit_id" }, { status: 400 });
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const kit = await database().query(
      `SELECT id AS kit_id, name, current_version, created_at, updated_at
         FROM tanaghom.brand_kits WHERE id = $1 AND organization_id = $2`,
      [kitId, user.organizationId],
    );
    if (!kit.rows[0]) return noStore({ error: "kit_not_found" }, { status: 404 });
    const versions = await database().query(
      `SELECT id AS version_id, version, colors, typography, arabic_font, latin_font,
              logos, tone, rules, cta, channels, created_at
         FROM tanaghom.brand_kit_versions WHERE kit_id = $1 ORDER BY version ASC`,
      [kitId],
    );
    return noStore({ kit: kit.rows[0], versions: versions.rows });
  } catch (error) {
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    throw error;
  }
}

export async function createBrandKitVersion(request: NextRequest, kitId: string) {
  try {
    requireCreativeStudio();
    enforceSameOriginForCookieMutation(request);
    if (!/^[0-9a-f-]{36}$/i.test(kitId)) return noStore({ error: "invalid_kit_id" }, { status: 400 });
    const [user, body] = await Promise.all([authorize(request, ["owner"]), bodyJson(request)]);
    const headerKey = idempotencyKey(request);
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ kit_id: kitId, ...body, headerKey })).digest("hex")}`;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.brand_kit.version", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      let versionId: string;
      try {
        const created = await client.query<{ id: string }>(
          `SELECT tanaghom.create_brand_kit_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS id`,
          [user.id, kitId, JSON.stringify(objectField(body.colors, "invalid_colors")),
            JSON.stringify(objectField(body.typography, "invalid_typography")),
            textField(body.arabic_font, 120, "invalid_font"), textField(body.latin_font, 120, "invalid_font"),
            JSON.stringify(objectField(body.logos, "invalid_logos")), textField(body.tone, 500, "invalid_tone"),
            JSON.stringify(objectField(body.rules, "invalid_rules")), JSON.stringify(objectField(body.cta, "invalid_cta")),
            JSON.stringify(objectField(body.channels, "invalid_channels"))],
        );
        versionId = created.rows[0].id;
      } catch (error) { mapDbError(error); }
      const responseBody = { ok: true, kit_id: kitId, version_id: versionId! };
      await audit(client, user.id, "creative.brand_kit_version_created_api", kitId, { version_id: versionId! });
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

export async function setBrandKitCurrent(request: NextRequest, kitId: string) {
  try {
    requireCreativeStudio();
    enforceSameOriginForCookieMutation(request);
    if (!/^[0-9a-f-]{36}$/i.test(kitId)) return noStore({ error: "invalid_kit_id" }, { status: 400 });
    const [user, body] = await Promise.all([authorize(request, ["owner"]), bodyJson(request)]);
    if (!Number.isInteger(body.version) || (body.version as number) < 1) {
      return noStore({ error: "invalid_version" }, { status: 400 });
    }
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      let version: number;
      try {
        const updated = await client.query<{ version: number }>(
          `SELECT tanaghom.set_brand_kit_current($1,$2,$3) AS version`,
          [user.id, kitId, body.version],
        );
        version = updated.rows[0].version;
      } catch (error) { mapDbError(error); }
      const responseBody = { ok: true, kit_id: kitId, current_version: version! };
      await audit(client, user.id, "creative.brand_kit_current_set_api", kitId, { version: version! });
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
