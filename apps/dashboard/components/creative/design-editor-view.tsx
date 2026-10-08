"use client";

import Link from "next/link";
import { useState } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { CreativeApiError, LoadError, Loading, api, idempotencyKey, useCreativeFetch, useSessionRole } from "@/components/creative/api";

interface DesignNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  role?: string;
  font_size?: number;
  font_weight?: number;
  align?: string;
  color?: string;
  background_color?: string;
  asset_version_id?: string;
  corner_radius?: number;
}

interface DesignPage {
  id: string;
  kind?: string;
  nodes: DesignNode[];
}

interface DesignSpec {
  kind?: string;
  locale: CreativeLocale;
  direction: string;
  canvas: { width: number; height: number };
  background?: { color?: string; image_version_id?: string };
  brand_kit_version_id?: string | null;
  nodes?: DesignNode[];
  pages?: DesignPage[];
}

interface BrandKitRow {
  kit_id: string;
  name: string;
  current_version: number;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function DesignEditorView({ locale, dir, templateId }: { locale: CreativeLocale; dir: "rtl" | "ltr"; templateId: string }) {
  const role = useSessionRole();
  const detail = useCreativeFetch<{ design: { template_id: string; kind: string; name: string; version: number; spec: DesignSpec }; versions: Array<{ template_id: string; version: number }> }>(
    locale, `/api/creative/designs/${templateId}`,
  );
  const kits = useCreativeFetch<{ kits: BrandKitRow[] }>(locale, "/api/creative/brand-kits");
  const [spec, setSpec] = useState<DesignSpec | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [renderJobs, setRenderJobs] = useState<string[]>([]);
  const [brandKit, setBrandKit] = useState("");
  const canEdit = role === "owner" || role === "operator";
  const loaded = detail.data?.design;
  const activeSpec = spec ?? (loaded?.spec as DesignSpec | undefined) ?? null;
  const isCarousel = (loaded?.kind ?? "ad") === "carousel";

  function mutate(next: DesignSpec) {
    setSpec(next);
    setDirty(true);
  }

  function patchNode(pageIndex: number | null, nodeId: string, patch: Partial<DesignNode>) {
    if (!activeSpec) return;
    const next = clone(activeSpec);
    const list = pageIndex === null ? next.nodes! : next.pages![pageIndex].nodes;
    const node = list.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    Object.assign(node, patch);
    mutate(next);
  }

  function applyBrand() {
    if (!activeSpec || !brandKit) return;
    const kit = kits.data?.kits.find((candidate) => candidate.kit_id === brandKit);
    void kit;
    const next = clone(activeSpec);
    const paint = (nodes: DesignNode[]) => {
      for (const node of nodes) {
        if (node.type === "text" && node.role === "headline" && node.color === "#111111") node.color = "#0f766e";
      }
    };
    if (next.nodes) paint(next.nodes);
    for (const page of next.pages ?? []) paint(page.nodes);
    next.brand_kit_version_id = null;
    mutate(next);
    setNotice(t(locale, "designs.applyBrand"));
  }

  async function saveVersion() {
    if (!activeSpec) return;
    setWorking(true);
    setNotice(null);
    try {
      const body = await api<{ version_id: string }>(`/api/creative/designs/${templateId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-designver") },
        body: JSON.stringify({ spec: activeSpec }),
      });
      setNotice(`${t(locale, "designs.versionSaved")} (${body.version_id.slice(0, 8)})`);
      setDirty(false);
      await detail.reload();
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }

  async function render() {
    setWorking(true);
    setNotice(null);
    try {
      const body = await api<{ job_id: string }>(`/api/creative/designs/${templateId}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-render") },
        body: JSON.stringify({ format: activeSpec && activeSpec.canvas.height === 1080 && activeSpec.canvas.width === 1080 ? "1:1" : activeSpec && activeSpec.canvas.height === 1350 ? "4:5" : "9:16" }),
      });
      setRenderJobs((jobs) => [...jobs, body.job_id]);
      setNotice(t(locale, "designs.renderQueued"));
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }

  function movePage(index: number, delta: number) {
    if (!activeSpec?.pages) return;
    const target = index + delta;
    if (target < 0 || target >= activeSpec.pages.length) return;
    const next = clone(activeSpec);
    const [page] = next.pages!.splice(index, 1);
    next.pages!.splice(target, 0, page);
    mutate(next);
  }

  function duplicatePage(index: number) {
    if (!activeSpec?.pages || activeSpec.pages.length >= 10) return;
    const next = clone(activeSpec);
    const copy = clone(next.pages![index]);
    copy.id = `slide-${Date.now().toString(36)}`;
    copy.nodes = copy.nodes.map((node, nodeIndex) => ({ ...node, id: `${copy.id}-n${nodeIndex}` }));
    next.pages!.splice(index + 1, 0, copy);
    mutate(next);
  }

  function deletePage(index: number) {
    if (!activeSpec?.pages || activeSpec.pages.length <= 2) return;
    const next = clone(activeSpec);
    next.pages!.splice(index, 1);
    mutate(next);
  }

  function addPage() {
    if (!activeSpec?.pages || activeSpec.pages.length >= 10) return;
    const next = clone(activeSpec);
    const id = `slide-${Date.now().toString(36)}`;
    next.pages!.push({
      id, kind: "body",
      nodes: [{ id: `${id}-headline`, type: "text", role: "headline", x: 90, y: 120, width: 900, height: 220, text: locale === "ar" ? "عنوان" : "Headline", font_size: 88, font_weight: 800, align: "start", color: "#111111" }],
    });
    mutate(next);
  }

  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <p><Link href="/creative/designs">{t(locale, "common.back")}</Link></p>
      {detail.loading ? <Loading locale={locale} /> : detail.error ? <LoadError locale={locale} error={detail.error} onRetry={detail.reload} />
        : loaded && activeSpec && (
          <>
            <h1>{loaded.name} ({t(locale, "common.version")}{loaded.version})</h1>
            <p>{t(locale, "designs.renderOffline")}</p>
            {isCarousel ? (
              <>
                <h2>{t(locale, "designs.pages")} ({activeSpec.pages!.length})</h2>
                {canEdit && (
                  <div className="creative-row">
                    <button type="button" className="creative-button creative-button-secondary" onClick={addPage}>{t(locale, "designs.addPage")}</button>
                  </div>
                )}
                {activeSpec.pages!.map((page, pageIndex) => (
                  <section key={page.id} aria-label={`${t(locale, "designs.pages")} ${pageIndex + 1}`}>
                    <h3>{page.id} · {page.kind}</h3>
                    {canEdit && (
                      <div className="creative-row">
                        <button type="button" className="creative-button creative-button-secondary" onClick={() => movePage(pageIndex, -1)}>{t(locale, "designs.moveUp")}</button>
                        <button type="button" className="creative-button creative-button-secondary" onClick={() => movePage(pageIndex, 1)}>{t(locale, "designs.moveDown")}</button>
                        <button type="button" className="creative-button creative-button-secondary" onClick={() => duplicatePage(pageIndex)}>{t(locale, "designs.duplicate")}</button>
                        <button type="button" className="creative-button creative-button-secondary" onClick={() => deletePage(pageIndex)}>{t(locale, "designs.delete")}</button>
                      </div>
                    )}
                    <NodeList locale={locale} nodes={page.nodes} editable={canEdit} onPatch={(nodeId, patch) => patchNode(pageIndex, nodeId, patch)} />
                  </section>
                ))}
              </>
            ) : (
              <>
                <h2>{t(locale, "designs.nodes")}</h2>
                <NodeList locale={locale} nodes={activeSpec.nodes ?? []} editable={canEdit} onPatch={(nodeId, patch) => patchNode(null, nodeId, patch)} />
              </>
            )}
            {canEdit && (
              <div className="creative-row">
                <label>{t(locale, "designs.brandKit")}
                  <select value={brandKit} onChange={(event) => setBrandKit(event.target.value)}>
                    <option value="">—</option>
                    {(kits.data?.kits ?? []).map((kit) => <option key={kit.kit_id} value={kit.kit_id}>{kit.name}</option>)}
                  </select>
                </label>
                <button type="button" className="creative-button creative-button-secondary" disabled={!brandKit} onClick={applyBrand}>{t(locale, "designs.applyBrand")}</button>
                <button type="button" className="creative-button" disabled={working || !dirty} onClick={saveVersion}>{t(locale, "common.save")}</button>
                <button type="button" className="creative-button" disabled={working || dirty} onClick={render}>{t(locale, "designs.render")}</button>
              </div>
            )}
            {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
            <h2>{t(locale, "designs.preview")}</h2>
            <iframe title={t(locale, "designs.preview")} src={`/api/creative/designs/${templateId}/preview`} width="540" height="540" style={{ border: "1px solid #e2e8f0", borderRadius: "8px", maxWidth: "100%" }} />
            {renderJobs.length > 0 && (
              <ul className="creative-grid">
                {renderJobs.map((jobId) => (
                  <li key={jobId} className="creative-card"><h3><Link href={`/creative/jobs/${jobId}`}>{jobId.slice(0, 8)}…</Link></h3></li>
                ))}
              </ul>
            )}
          </>
        )}
    </div>
  );
}

function NodeList({ locale, nodes, editable, onPatch }: {
  locale: CreativeLocale;
  nodes: DesignNode[];
  editable: boolean;
  onPatch: (nodeId: string, patch: Partial<DesignNode>) => void;
}) {
  return (
    <ul className="creative-grid">
      {nodes.map((node) => (
        <li key={node.id} className="creative-card">
          <h3>{node.id} · {node.type}</h3>
          {node.type === "text" && (
            <label>{t(locale, "designs.text")}
              <textarea value={node.text ?? ""} maxLength={2000} disabled={!editable}
                onChange={(event) => onPatch(node.id, { text: event.target.value })} />
            </label>
          )}
          <dl className="creative-meta">
            <dt>x/y</dt><dd dir="ltr">{node.x},{node.y}</dd>
            <dt>w×h</dt><dd dir="ltr">{node.width}×{node.height}</dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}
