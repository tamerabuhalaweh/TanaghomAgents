"use client";

import Link from "next/link";
import { useState } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { CreativeApiError, api, idempotencyKey, useSessionRole } from "@/components/creative/api";

const SIZES = [
  { label: "1024×1024", width: 1024, height: 1024 },
  { label: "1024×768", width: 1024, height: 768 },
  { label: "768×1024", width: 768, height: 1024 },
];

export function GenerateView({ locale, dir }: { locale: CreativeLocale; dir: "rtl" | "ltr" }) {
  const role = useSessionRole();
  const [prompt, setPrompt] = useState("");
  const [sizeIndex, setSizeIndex] = useState(0);
  const [variants, setVariants] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [jobs, setJobs] = useState<string[]>([]);
  const canGenerate = role === "owner" || role === "operator";
  const size = SIZES[sizeIndex];
  const estimate = Math.ceil(((size.width * size.height) / 1_000_000)) * 0.003 * variants;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setNotice(null);
    try {
      const body = await api<{ job_ids: string[]; correlation_id: string }>(`/api/creative/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-gen") },
        body: JSON.stringify({ capability: "image", prompt: prompt.trim(), width: size.width, height: size.height, variants, correlation_id: crypto.randomUUID() }),
      });
      setJobs(body.job_ids);
      setNotice(t(locale, "generate.submitted"));
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <div className="creative-head"><h1>{t(locale, "generate.title")}</h1></div>
      {role !== null && !canGenerate && (
        <div className="creative-notice" role="status"><p>{t(locale, "generate.disabled")}</p></div>
      )}
      {canGenerate && (
        <form className="creative-form" onSubmit={submit}>
          <label>{t(locale, "generate.prompt")}
            <textarea value={prompt} maxLength={4000} onChange={(event) => setPrompt(event.target.value)} />
          </label>
          <label>{t(locale, "generate.size")}
            <select value={sizeIndex} onChange={(event) => setSizeIndex(Number(event.target.value))}>
              {SIZES.map((option, index) => <option key={option.label} value={index}>{option.label}</option>)}
            </select>
          </label>
          <label>{t(locale, "generate.variants")}
            <select value={variants} onChange={(event) => setVariants(Number(event.target.value))}>
              {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <p>{t(locale, "generate.estimate")}: ${estimate.toFixed(4)} ({t(locale, "generate.informational")})</p>
          <button type="submit" className="creative-button" disabled={working || !prompt.trim()}>{t(locale, "generate.submit")}</button>
        </form>
      )}
      {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
      {jobs.length > 0 && (
        <ul className="creative-grid">
          {jobs.map((jobId) => (
            <li key={jobId} className="creative-card">
              <h2><Link href={`/creative/jobs/${jobId}`}>{jobId.slice(0, 8)}…</Link></h2>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GenerateDisabledNotice({ locale }: { locale: CreativeLocale }) {
  return <div className="creative-notice" role="status"><p>{t(locale, "generate.disabled")}</p></div>;
}
