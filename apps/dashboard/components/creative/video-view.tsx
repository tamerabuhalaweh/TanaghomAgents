"use client";

import Link from "next/link";
import { useState } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { CreativeApiError, LoadError, Loading, api, idempotencyKey, useCreativeFetch, useSessionRole } from "@/components/creative/api";

interface VideoJobRow {
  job_id: string;
  capability: string;
  lane: string;
  status: string;
  attempt: number;
  correlation_id: string;
  created_at: string;
}

const DURATIONS = [5, 8, 10];
const RATIOS = ["16:9", "9:16", "1:1"];
const UNIT_PRICE_USD = 0.08;

export function VideoView({ locale, dir }: { locale: CreativeLocale; dir: "rtl" | "ltr" }) {
  const role = useSessionRole();
  const jobs = useCreativeFetch<{ jobs: VideoJobRow[] }>(locale, "/api/creative/video/jobs");
  const [operation, setOperation] = useState("text_to_video");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(5);
  const [ratio, setRatio] = useState("16:9");
  const [sourceVersionId, setSourceVersionId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const canSubmit = role === "owner" || role === "operator";
  const estimate = Math.round(duration * UNIT_PRICE_USD * 1000) / 1000;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setNotice(null);
    try {
      const body = await api<{ job_ids: string[] }>(`/api/creative/video/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-video") },
        body: JSON.stringify({
          operation,
          prompt: prompt.trim(),
          duration,
          ...(operation === "text_to_video" ? { ratio } : {}),
          ...(operation === "image_to_video" ? { source_version_id: sourceVersionId } : {}),
          correlation_id: crypto.randomUUID(),
        }),
      });
      setNotice(t(locale, "video.submitted"));
      setPrompt("");
      await jobs.reload();
      window.location.assign(`/creative/jobs/${body.job_ids[0]}`);
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <div className="creative-head"><h1>{t(locale, "video.title")}</h1></div>
      <p>{t(locale, "video.informational")}</p>
      <p>{t(locale, "video.noPublish")}</p>
      {canSubmit && (
        <form className="creative-form" onSubmit={submit}>
          <h2>{t(locale, "video.submit")}</h2>
          <label>{t(locale, "video.operation")}
            <select value={operation} onChange={(event) => setOperation(event.target.value)}>
              <option value="text_to_video">{t(locale, "video.textToVideo")}</option>
              <option value="image_to_video">{t(locale, "video.imageToVideo")}</option>
            </select>
          </label>
          <label>{t(locale, "video.prompt")}<textarea value={prompt} maxLength={7000} onChange={(event) => setPrompt(event.target.value)} /></label>
          {operation === "image_to_video" && (
            <label>{t(locale, "video.source")}<input type="text" value={sourceVersionId} placeholder="uuid" onChange={(event) => setSourceVersionId(event.target.value)} /></label>
          )}
          <label>{t(locale, "video.duration")}
            <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
              {DURATIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          {operation === "text_to_video" && (
            <label>{t(locale, "video.ratio")}
              <select value={ratio} onChange={(event) => setRatio(event.target.value)}>
                {RATIOS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          )}
          <p>{t(locale, "video.estimate")}: ${estimate.toFixed(3)} ({duration}s × ${UNIT_PRICE_USD.toFixed(2)}/s)</p>
          <button
            type="submit"
            className="creative-button"
            disabled={working || !prompt.trim() || (operation === "image_to_video" && !sourceVersionId.trim())}
          >{t(locale, "video.submit")}</button>
        </form>
      )}
      {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
      <h2>{t(locale, "video.jobs")}</h2>
      {jobs.loading ? <Loading locale={locale} /> : jobs.error ? <LoadError locale={locale} error={jobs.error} onRetry={jobs.reload} />
        : !jobs.data?.jobs.length ? <p>{t(locale, "video.empty")}</p>
        : (
          <ul className="creative-grid">
            {jobs.data.jobs.map((job) => (
              <li key={job.job_id} className="creative-card">
                <h2><Link href={`/creative/jobs/${job.job_id}`}>{job.job_id.slice(0, 8)} · {job.status}</Link></h2>
                <p>{job.capability} · {job.lane}</p>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
