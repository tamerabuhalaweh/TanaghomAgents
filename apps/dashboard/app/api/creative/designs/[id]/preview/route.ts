import type { NextRequest } from "next/server";

import { buildDocumentHtml, buildPageHtml, bundledFontCss, type DesignDocument } from "@tanaghom/creative-runtime/render/document";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";
import { requireCreativeStudio, CreativeDisabledError } from "@/lib/server/creative/feature-control";
import { localStorage } from "@/lib/server/creative/storage";
import { DESIGN_FORMATS } from "@/lib/server/creative/designs";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireCreativeStudio();
    const { id } = await params;
    if (!UUID_RE.test(id)) return noStore({ error: "invalid_template_id" }, { status: 400 });
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const versionParam = request.nextUrl.searchParams.get("version");
    const formatParam = request.nextUrl.searchParams.get("format") ?? "1:1";
    const format = DESIGN_FORMATS[formatParam];
    if (!format) return noStore({ error: "invalid_format" }, { status: 400 });
    const head = await database().query<{ spec: unknown; kind: string; version: number; organization_id: string | null }>(
      `SELECT spec, kind, version, organization_id FROM tanaghom.creative_templates WHERE id = $1`,
      [id],
    );
    const row = head.rows[0];
    if (!row || (row.kind !== "ad" && row.kind !== "carousel")) return noStore({ error: "design_not_found" }, { status: 404 });
    if (row.organization_id !== null && row.organization_id !== user.organizationId) {
      return noStore({ error: "design_not_found" }, { status: 404 });
    }
    let spec = row.spec as Record<string, unknown>;
    let version = row.version as number;
    if (versionParam !== null) {
      const wanted = Number(versionParam);
      if (!Number.isInteger(wanted) || wanted < 1) return noStore({ error: "invalid_version" }, { status: 400 });
      const pinned = await database().query<{ spec: unknown; version: number }>(
        row.organization_id === null
          ? `SELECT spec, version FROM tanaghom.creative_templates WHERE kind = $1 AND name = (SELECT name FROM tanaghom.creative_templates WHERE id = $2) AND version = $3 AND organization_id IS NULL`
          : `SELECT spec, version FROM tanaghom.creative_templates WHERE kind = $1 AND name = (SELECT name FROM tanaghom.creative_templates WHERE id = $2) AND version = $3 AND organization_id = $4`,
        row.organization_id === null ? [row.kind, id, wanted] : [row.kind, id, wanted, row.organization_id],
      );
      if (!pinned.rows[0]) return noStore({ error: "design_version_not_found" }, { status: 404 });
      spec = pinned.rows[0].spec as Record<string, unknown>;
      version = pinned.rows[0].version as number;
    }
    void version;
    const canvas = (spec.canvas ?? {}) as { width: number; height: number };
    if (canvas.width !== format.width || canvas.height !== format.height) {
      return noStore({ error: "format_canvas_mismatch" }, { status: 400 });
    }
    // Collect every referenced asset version id from the validated shape.
    const refs = new Set<string>();
    const pages = row.kind === "carousel"
      ? ((spec.pages ?? []) as Array<{ nodes?: unknown[] }>)
      : [{ nodes: spec.nodes as unknown[] }];
    for (const page of pages) {
      for (const node of (page.nodes ?? []) as Array<Record<string, unknown>>) {
        if (typeof node.asset_version_id === "string") refs.add(node.asset_version_id);
      }
    }
    const background = spec.background as Record<string, unknown> | undefined;
    if (background && typeof background.image_version_id === "string") refs.add(background.image_version_id);
    const assets = new Map<string, { bytes: Buffer; mime: string }>();
    const storage = localStorage();
    for (const ref of refs) {
      if (!UUID_RE.test(ref)) return noStore({ error: "invalid_design:asset_ref" }, { status: 400 });
      const found = await database().query<{ object_key: string; mime: string }>(
        `SELECT version.object_key, version.mime
           FROM tanaghom.creative_asset_versions version
           JOIN tanaghom.creative_assets asset ON asset.id = version.asset_id
          WHERE version.id = $1 AND asset.organization_id = $2`,
        [ref, user.organizationId],
      );
      if (!found.rows[0]) return noStore({ error: "design_asset_not_found" }, { status: 404 });
      const stored = await storage.get(found.rows[0].object_key);
      if (!stored) return noStore({ error: "artifact_missing" }, { status: 410 });
      assets.set(ref, stored);
    }
    const first = buildDocumentHtml({
      doc: spec as unknown as DesignDocument,
      assets,
      fontCss: bundledFontCss(),
      fontFamily: "Cairo",
    })[0];
    if (!first) return noStore({ error: "design_empty" }, { status: 400 });
    const pageParam = request.nextUrl.searchParams.get("page");
    let html = first.html;
    if (pageParam !== null) {
      const wanted = Number(pageParam);
      const pages = (spec.pages as Array<{ id: string }> | undefined) ?? [{ id: "page-1" }];
      if (!Number.isInteger(wanted) || wanted < 1 || wanted > pages.length) {
        return noStore({ error: "invalid_page" }, { status: 400 });
      }
      html = buildPageHtml({
        doc: spec as unknown as DesignDocument,
        pageId: pages[wanted - 1].id,
        assets,
        fontCss: bundledFontCss(),
        fontFamily: "Cairo",
      });
    }
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    return apiFailure(error);
  }
}
