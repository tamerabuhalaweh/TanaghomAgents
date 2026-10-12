import type { NextRequest } from "next/server";
import {createHash} from "node:crypto";
import {validateMp4} from "@tanaghom/creative-runtime/render/mp4";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";
import { requireCreativeStudio, CreativeDisabledError } from "@/lib/server/creative/feature-control";
import { localStorage } from "@/lib/server/creative/storage";

export const runtime = "nodejs";

// Inline preview is restricted to a safe-image allowlist. Other stored
// MIME types (notably text/html for future landing assets) must never be
// served inline on the dashboard origin: that would be stored XSS with the
// session. HTML preview requires a future sandboxed/separate-origin design.
const PREVIEWABLE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireCreativeStudio();
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return noStore({ error: "invalid_version_id" }, { status: 400 });
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const found = await database().query<{ object_key:string; mime:string; sha256:string; bytes:string; width:number; height:number; duration_ms:number; capability:string }>(
      `SELECT version.object_key, version.mime,version.sha256,version.bytes,version.width,version.height,version.duration_ms,asset.capability
         FROM tanaghom.creative_asset_versions version
         JOIN tanaghom.creative_assets asset ON asset.id = version.asset_id
        WHERE version.id = $1 AND asset.organization_id = $2`,
      [id, user.organizationId],
    );
    if (!found.rows[0]) return noStore({ error: "version_not_found" }, { status: 404 });
    const video=found.rows[0].mime==='video/mp4'&&['talking_head','lip_sync'].includes(found.rows[0].capability);
    if (!PREVIEWABLE_MIME.has(found.rows[0].mime)&&!video) {
      return noStore({ error: "preview_not_supported" }, { status: 415 });
    }
    const stored = await localStorage().get(found.rows[0].object_key);
    if (!stored) return noStore({ error: "artifact_missing" }, { status: 410 });
    if(video){
      const ref=found.rows[0];
      if(stored.mime!==ref.mime||stored.bytes.length!==Number(ref.bytes)||createHash('sha256').update(stored.bytes).digest('hex')!==ref.sha256)return noStore({error:'artifact_integrity_failed'},{status:410});
      try{validateMp4(stored.bytes,{width:ref.width,height:ref.height,expectedDurationSec:ref.duration_ms/1000,allowedCodecs:['avc1','mp4v'],requireAudio:true});}catch{return noStore({error:'invalid_stored_mp4'},{status:415});}
    }
    let start=0,end=stored.bytes.length-1,status=200;
    const range=video?request.headers.get('range'):null;
    if(range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!match||(!match[1]&&!match[2]))return noStore({error:'invalid_range'},{status:416,headers:{'Content-Range':`bytes */${stored.bytes.length}`}});
      start=match[1]?Number(match[1]):Math.max(0,stored.bytes.length-Number(match[2]));end=match[1]&&match[2]?Math.min(Number(match[2]),end):end;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start<0||start>=stored.bytes.length||(!match[1]&&Number(match[2])<=0))return noStore({error:'invalid_range'},{status:416,headers:{'Content-Range':`bytes */${stored.bytes.length}`}});
      status=206;
    }
    return new Response(new Uint8Array(stored.bytes.subarray(start,end+1)), {
      status,
      headers: {
        "Content-Type": found.rows[0].mime,
        "Content-Disposition": "inline",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy":"same-origin",
        ...(video?{"Accept-Ranges":"bytes","Content-Length":String(end-start+1),"Content-Security-Policy":"default-src 'none'",...(status===206?{"Content-Range":`bytes ${start}-${end}/${stored.bytes.length}`}:{})}:{}),
      },
    });
  } catch (error) {
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    return apiFailure(error);
  }
}
