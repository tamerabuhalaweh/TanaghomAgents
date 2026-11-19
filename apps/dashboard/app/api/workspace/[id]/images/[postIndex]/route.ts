import type { NextRequest } from "next/server";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { creativeStorage } from "@/lib/server/creative/storage";
import { apiFailure } from "@/lib/server/responses";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

function notFound() {
  return new Response(null, { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; postIndex: string }> }) {
  try {
    // The tenant comes from the session, never from the URL. A workspace or
    // image belonging to another organization is reported as not found.
    const actor = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const { id, postIndex } = await params;
    const index = Number(postIndex);
    if (!UUID_RE.test(id) || ![1, 2, 3].includes(index)) return notFound();
    const result = await database().query<{ object_key: string; mime_type: string | null }>(
      `SELECT object_key, mime_type
         FROM tanaghom.workspace_post_images
        WHERE workspace_id = $1::uuid AND organization_id = $2::uuid
          AND post_index = $3::int AND status = 'generated'`,
      [id, actor.organizationId, index],
    );
    const row = result.rows[0];
    if (!row?.object_key) return notFound();
    const object = await creativeStorage().get(row.object_key, MAX_IMAGE_BYTES);
    if (!object?.bytes?.length) return notFound();
    return new Response(new Uint8Array(object.bytes), {
      status: 200,
      headers: {
        "content-type": row.mime_type || object.mime,
        "content-length": String(object.bytes.length),
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return apiFailure(error);
  }
}
