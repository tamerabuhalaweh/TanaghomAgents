"use client";

import Link from "next/link";
import { useState } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { LoadError, Loading, useCreativeFetch } from "@/components/creative/api";

interface JobRow {
  job_id: string;
  capability: string;
  lane: string;
  status: string;
  created_at: string;
}

const STATUSES = ["", "queued", "claimed", "running", "succeeded", "failed", "cancelled", "expired"];

export function JobsView({ locale, dir }: { locale: CreativeLocale; dir: "rtl" | "ltr" }) {
  const [status, setStatus] = useState("");
  const path = status ? `/api/creative/jobs?status=${status}` : "/api/creative/jobs";
  const jobs = useCreativeFetch<{ jobs: JobRow[] }>(locale, path);
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <div className="creative-head">
        <h1>{t(locale, "jobs.title")}</h1>
        <label>
          {t(locale, "jobs.status")}{" "}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUSES.map((value) => (
              <option key={value} value={value}>{value === "" ? t(locale, "jobs.all") : value}</option>
            ))}
          </select>
        </label>
      </div>
      {jobs.loading ? <Loading locale={locale} /> : jobs.error ? <LoadError locale={locale} error={jobs.error} onRetry={jobs.reload} />
        : !jobs.data?.jobs.length ? <p>{t(locale, "jobs.empty")}</p>
        : (
          <ul className="creative-grid">
            {jobs.data.jobs.map((job) => (
              <li key={job.job_id} className="creative-card">
                <h2><Link href={`/creative/jobs/${job.job_id}`}>{job.capability} · {job.status}</Link></h2>
                <dl className="creative-meta">
                  <dt>{t(locale, "jobs.lane")}</dt><dd>{job.lane}</dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
