"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { CreativeApiError, LoadError, Loading, api, idempotencyKey, useCreativeFetch, useSessionRole } from "@/components/creative/api";

interface MotionSpec {
  locale: CreativeLocale;
  direction: "rtl" | "ltr";
  design_template_id: string;
  fps: number;
  scenes: Array<{ id: string; page_id: string; duration_ms: number; transition?: { preset: string; direction?: string; duration_ms?: number } }>;
  elements: Array<{ node_id: string; scene_id?: string; preset: string; direction?: string; delay_ms?: number; duration_ms?: number; easing?: string }>;
  captions?: Array<{ text: string; start_ms: number; end_ms: number }>;
}

interface MotionDetail {
  motion: { template_id: string; name: string; version: number; spec: MotionSpec };
  versions: Array<{ template_id: string; version: number }>;
}

const PRESETS = ["none", "fade", "slide", "scale", "reveal"] as const;
const DIRECTIONS = ["up", "down", "start", "end"] as const;
const EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"] as const;

export function MotionEditorView({ locale, dir, templateId }: { locale: CreativeLocale; dir: "rtl" | "ltr"; templateId: string }) {
  const role = useSessionRole();
  const detail = useCreativeFetch<MotionDetail>(locale, `/api/creative/motions/${templateId}`);
  const [spec, setSpec] = useState<MotionSpec | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const canEdit = role === "owner";
  const canRender = role === "owner" || role === "operator";

  useEffect(() => {
    if (detail.data && !spec) setSpec(structuredClone(detail.data.motion.spec));
  }, [detail.data, spec]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    async function poll() {
      try {
        const body = await api<{ job: { status: string } }>(`/api/creative/jobs/${jobId}`);
        if (!cancelled) {
          setJobStatus(body.job.status);
          if (["succeeded", "failed", "cancelled", "expired"].includes(body.job.status)) return;
          window.setTimeout(() => { if (!cancelled) void poll(); }, 2000);
        }
      } catch {
        if (!cancelled) setJobStatus("unknown");
      }
    }
    void poll();
    return () => { cancelled = true; };
  }, [jobId]);

  function mutate(next: MotionSpec) {
    setSpec(next);
    setDirty(true);
  }

  async function saveVersion() {
    if (!spec) return;
    setWorking(true);
    setNotice(null);
    try {
      const body = await api<{ version_id: string }>(`/api/creative/motions/${templateId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-motionver") },
        body: JSON.stringify({ spec }),
      });
      setNotice(`${t(locale, "motions.created")} (${body.version_id.slice(0, 8)})`);
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
      const body = await api<{ job_id: string }>(`/api/creative/motions/${templateId}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-motionrender") },
        body: JSON.stringify({ format: "1:1" }),
      });
      setJobId(body.job_id);
      setJobStatus("queued");
      setNotice(t(locale, "motions.renderQueued"));
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }

  const loaded = detail.data?.motion;
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <p><Link href="/creative/motion">{t(locale, "common.back")}</Link></p>
      {detail.loading ? <Loading locale={locale} /> : detail.error ? <LoadError locale={locale} error={detail.error} onRetry={detail.reload} />
        : loaded && spec && (
          <>
            <h1>{loaded.name} ({t(locale, "common.version")}{loaded.version})</h1>
            <p>{t(locale, "motions.renderOffline")}</p>
            <p>{t(locale, "motions.noPublish")}</p>
            <h2>{t(locale, "motions.preview")}</h2>
            <iframe title="motion-preview" src={`/api/creative/motions/${templateId}/preview`} width={360} height={360} />
            <h2>{t(locale, "motions.scenes")} ({spec.scenes.length})</h2>
            {spec.scenes.map((scene, sceneIndex) => (
              <section key={scene.id} aria-label={`${t(locale, "motions.scenes")} ${sceneIndex + 1}`}>
                <h3>{scene.id} · {scene.page_id}</h3>
                {canEdit && (
                  <label>{t(locale, "motions.duration")}
                    <input type="number" value={scene.duration_ms} min={500} max={10000} step={100} onChange={(event) => {
                      const next = structuredClone(spec);
                      next.scenes[sceneIndex].duration_ms = Number(event.target.value);
                      mutate(next);
                    }} />
                  </label>
                )}
              </section>
            ))}
            <h2>{t(locale, "motions.elements")} ({spec.elements.length})</h2>
            {spec.elements.map((element, elementIndex) => (
              <div key={`${element.node_id}-${elementIndex}`} className="creative-row">
                <span>{element.node_id}</span>
                {canEdit ? (
                  <>
                    <select value={element.preset} onChange={(event) => {
                      const next = structuredClone(spec);
                      next.elements[elementIndex].preset = event.target.value;
                      mutate(next);
                    }}>
                      {PRESETS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <select value={element.direction ?? "start"} onChange={(event) => {
                      const next = structuredClone(spec);
                      next.elements[elementIndex].direction = event.target.value;
                      mutate(next);
                    }}>
                      {DIRECTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <select value={element.easing ?? "ease-out"} onChange={(event) => {
                      const next = structuredClone(spec);
                      next.elements[elementIndex].easing = event.target.value;
                      mutate(next);
                    }}>
                      {EASINGS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </>
                ) : <span>{element.preset}</span>}
              </div>
            ))}
            {canEdit && (
              <div className="creative-row">
                <button type="button" className="creative-button" disabled={working || !dirty} onClick={saveVersion}>{t(locale, "common.save")}</button>
              </div>
            )}
            {canRender && (
              <div className="creative-row">
                <button type="button" className="creative-button" disabled={working} onClick={render}>{t(locale, "motions.render")}</button>
              </div>
            )}
            {jobId && (
              <p>{t(locale, "motions.progress")}: <Link href={`/creative/jobs/${jobId}`}>{jobStatus ?? jobId.slice(0, 8)}</Link></p>
            )}
            {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
          </>
        )}
    </div>
  );
}
