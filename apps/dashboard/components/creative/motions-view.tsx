"use client";

import Link from "next/link";
import { useState } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { CreativeApiError, LoadError, Loading, api, idempotencyKey, useCreativeFetch, useSessionRole } from "@/components/creative/api";

interface MotionRow {
  template_id: string;
  organization_id: string | null;
  kind: string;
  name: string;
  version: number;
  is_active: boolean;
}

interface DesignRow {
  template_id: string;
  kind: string;
  name: string;
  version: number;
}

const PRESETS = ["fade", "slide", "scale", "reveal"] as const;

export function MotionsView({ locale, dir }: { locale: CreativeLocale; dir: "rtl" | "ltr" }) {
  const role = useSessionRole();
  const motions = useCreativeFetch<{ motions: MotionRow[] }>(locale, "/api/creative/motions");
  const designs = useCreativeFetch<{ designs: DesignRow[] }>(locale, "/api/creative/designs");
  const [name, setName] = useState("");
  const [designId, setDesignId] = useState("");
  const [preset, setPreset] = useState<string>("fade");
  const [durationMs, setDurationMs] = useState(2000);
  const [fps, setFps] = useState(24);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const canAdmin = role === "owner";
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setNotice(null);
    try {
      const design = await api<{ design: { kind: string; spec: Record<string, unknown> } }>(`/api/creative/designs/${designId}`);
      const designSpec = design.design.spec;
      const pages = design.design.kind === "carousel"
        ? (designSpec.pages as Array<{ id: string; nodes: Array<{ id: string }> }>)
        : [{ id: "page-1", nodes: (designSpec.nodes as Array<{ id: string }>) ?? [] }];
      const scenes = pages.map((page) => ({ id: `scene-${page.id}`, page_id: page.id, duration_ms: durationMs, transition: { preset: "fade", duration_ms: 500 } }));
      const elements = pages.flatMap((page, pageIndex) =>
        (page.nodes ?? []).slice(0, 8).map((node) => ({
          node_id: node.id,
          scene_id: pages.length > 1 ? scenes[pageIndex].id : undefined,
          preset,
          direction: "start",
          delay_ms: 0,
          duration_ms: 800,
          easing: "ease-out",
        })),
      );
      const body = await api<{ template_id: string }>(`/api/creative/motions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-motion") },
        body: JSON.stringify({
          name: name.trim(),
          design_template_id: designId,
          spec: {
            locale, direction: locale === "ar" ? "rtl" : "ltr",
            fps, scenes, elements,
          },
        }),
      });
      setNotice(t(locale, "motions.created"));
      setName("");
      window.location.assign(`/creative/motion/${body.template_id}`);
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <div className="creative-head"><h1>{t(locale, "motions.title")}</h1></div>
      <p>{t(locale, "motions.noPublish")}</p>
      {canAdmin && (
        <form className="creative-form" onSubmit={create}>
          <h2>{t(locale, "motions.create")}</h2>
          <label>{t(locale, "motions.name")}<input type="text" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
          <label>{t(locale, "motions.design")}
            <select value={designId} onChange={(event) => setDesignId(event.target.value)}>
              <option value="">—</option>
              {(designs.data?.designs ?? []).map((design) => (
                <option key={design.template_id} value={design.template_id}>{design.name} ({design.kind})</option>
              ))}
            </select>
          </label>
          <label>{t(locale, "motions.preset")}
            <select value={preset} onChange={(event) => setPreset(event.target.value)}>
              {PRESETS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>{t(locale, "motions.duration")}<input type="number" value={durationMs} min={500} max={10000} step={100} onChange={(event) => setDurationMs(Number(event.target.value))} /></label>
          <label>{t(locale, "motions.fps")}
            <select value={fps} onChange={(event) => setFps(Number(event.target.value))}>
              <option value={24}>24</option>
              <option value={30}>30</option>
            </select>
          </label>
          <button type="submit" className="creative-button" disabled={working || !name.trim() || !designId}>{t(locale, "common.save")}</button>
        </form>
      )}
      {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
      {motions.loading ? <Loading locale={locale} /> : motions.error ? <LoadError locale={locale} error={motions.error} onRetry={motions.reload} />
        : !motions.data?.motions.length ? <p>{t(locale, "motions.empty")}</p>
        : (
          <ul className="creative-grid">
            {motions.data.motions.map((motion) => (
              <li key={`${motion.template_id}`} className="creative-card">
                <h2><Link href={`/creative/motion/${motion.template_id}`}>{motion.name}</Link></h2>
                <p>{t(locale, "common.version")}{motion.version} · {motion.organization_id ? "org" : "global"}</p>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
