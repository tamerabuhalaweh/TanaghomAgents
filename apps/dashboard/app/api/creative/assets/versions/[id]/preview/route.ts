import type { NextRequest } from "next/server";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";
import { requireCreativeStudio, CreativeDisabledError } from "@/lib/server/creative/feature-control";
import { localStorage } from "@/lib/server/creative/storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireCreativeStudio();
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return noStore({ error: "invalid_version_id" }, { status: 400 });
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const found = await database().query<{ object_key: string; mime: string }>(
      `SELECT version.object_key, version.mime
         FROM tanaghom.creative_asset_versions version
         JOIN tanaghom.creative_assets asset ON asset.id = version.asset_id
        WHERE version.id = $1 AND asset.organization_id = $2`,
      [id, user.organizationId],
    );
    if (!found.rows[0]) return noStore({ error: "version_not_found" }, { status: 404 });
    const stored = await localStorage().get(found.rows[0].object_key);
    if (!stored) return noStore({ error: "artifact_missing" }, { status: 410 });
    return new Response(new Uint8Array(stored.bytes), {
      status: 200,
      headers: {
        "Content-Type": stored.mime,
        "Content-Disposition": "inline",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    return apiFailure(error);
  }
}
