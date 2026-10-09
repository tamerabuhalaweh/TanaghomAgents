import type { NextRequest } from "next/server";

import { buildMotionFrameHtml, type MotionDocument } from "@tanaghom/creative-runtime/render/motion";
import { bundledFontCss, type DesignDocument } from "@tanaghom/creative-runtime/render/document";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";
import { requireCreativeStudio, CreativeDisabledError } from "@/lib/server/creative/feature-control";
import { localStorage } from "@/lib/server/creative/storage";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Animated preview: the first scene plays live (real CSS animations, no
// frozen delays). The MP4 export renders every scene deterministically.
// Same self-contained guarantees as the design preview: data-URI
// fonts/images, inline styles, restrictive CSP, no network sources.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireCreativeStudio();
    const { id } = await params;
    if (!UUID_RE.test(id)) return noStore({ error: "invalid_template_id" }, { status: 400 });
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const head = await database().query<{ spec: unknown; kind: string; organization_id: string | null }>(
      `SELECT spec, kind, organization_id FROM tanaghom.creative_templates WHERE id = $1`,
      [id],
    );
    const row = head.rows[0];
    if (!row || row.kind !== "motion") return noStore({ error: "motion_not_found" }, { status: 404 });
    if (row.organization_id !== null && row.organization_id !== user.organizationId) {
      return noStore({ error: "motion_not_found" }, { status: 404 });
    }
    const motion = row.spec as Record<string, unknown>;
    const designId = motion.design_template_id as string;
    if (typeof designId !== "string" || !UUID_RE.test(designId)) {
      return noStore({ error: "motion_design_ref_invalid" }, { status: 400 });
    }
    const design = await database().query<{ spec: unknown; kind: string }>(
      `SELECT spec, kind FROM tanaghom.creative_templates WHERE id = $1`,
      [designId],
    );
    const designRow = design.rows[0];
    if (!designRow || (designRow.kind !== "ad" && designRow.kind !== "carousel")) {
      return noStore({ error: "motion_design_not_found" }, { status: 404 });
    }
    const designSpec = designRow.spec as Record<string, unknown>;
    const refs = new Set<string>();
    const pushNode = (node: Record<string, unknown>) => {
      if (typeof node.asset_version_id === "string") refs.add(node.asset_version_id);
    };
    if (designRow.kind === "carousel") {
      for (const page of (designSpec.pages ?? []) as Array<{ nodes?: unknown[] }>) {
        for (const node of (page.nodes ?? []) as Array<Record<string, unknown>>) pushNode(node);
      }
    } else {
      for (const node of (designSpec.nodes ?? []) as Array<Record<string, unknown>>) pushNode(node);
    }
    const background = designSpec.background as Record<string, unknown> | undefined;
    if (background && typeof background.image_version_id === "string") refs.add(background.image_version_id);
    const assets = new Map<string, { bytes: Buffer; mime: string }>();
    const storage = localStorage();
    for (const ref of refs) {
      if (!UUID_RE.test(ref)) return noStore({ error: "invalid_motion:asset_ref" }, { status: 400 });
      const found = await database().query<{ object_key: string; mime: string }>(
        `SELECT version.object_key, version.mime
           FROM tanaghom.creative_asset_versions version
           JOIN tanaghom.creative_assets asset ON asset.id = version.asset_id
          WHERE version.id = $1 AND asset.organization_id = $2`,
        [ref, user.organizationId],
      );
      if (!found.rows[0]) return noStore({ error: "motion_asset_not_found" }, { status: 404 });
      const stored = await storage.get(found.rows[0].object_key);
      if (!stored) return noStore({ error: "artifact_missing" }, { status: 410 });
      assets.set(ref, stored);
    }
    const { html } = buildMotionFrameHtml({
      motion: motion as unknown as MotionDocument,
      designDoc: designSpec as unknown as DesignDocument,
      assets,
      fontCss: bundledFontCss(),
      fontFamily: "Cairo",
      t: null,
    });
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  } catch (error) {
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    return apiFailure(error);
  }
}
