"use client";

import Link from "next/link";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { LoadError, Loading, useCreativeFetch } from "@/components/creative/api";

interface JobRow {
  job_id: string;
  capability: string;
  lane: string;
  status: string;
  created_at: string;
}

interface AssetRow {
  asset_id: string;
  capability: string;
  title: string | null;
  latest_version: number;
  review_status: string;
}

export function CreativeOverview({ locale, dir }: { locale: CreativeLocale; dir: "rtl" | "ltr" }) {
  const jobs = useCreativeFetch<{ jobs: JobRow[] }>(locale, "/api/creative/jobs");
  const assets = useCreativeFetch<{ assets: AssetRow[] }>(locale, "/api/creative/assets");
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <div className="creative-head">
        <div>
          <h1>{t(locale, "overview.title")}</h1>
          <p className="creative-lede">{t(locale, "overview.lede")}</p>
        </div>
      </div>
      <ul className="creative-grid">
        <li className="creative-card"><h2>{t(locale, "nav.jobs")}</h2><Link href="/creative/jobs">{t(locale, "overview.jobs")}</Link></li>
        <li className="creative-card"><h2>{t(locale, "nav.assets")}</h2><Link href="/creative/assets">{t(locale, "overview.assets")}</Link></li>
        <li className="creative-card"><h2>{t(locale, "nav.brands")}</h2><Link href="/creative/brand-kits">{t(locale, "nav.brands")}</Link></li>
        <li className="creative-card"><h2>{t(locale, "nav.templates")}</h2><Link href="/creative/templates">{t(locale, "nav.templates")}</Link></li>
        <li className="creative-card"><h2>{t(locale, "designs.title")}</h2><Link href="/creative/designs">{t(locale, "designs.title")}</Link></li>
        <li className="creative-card"><h2>{t(locale, "motions.title")}</h2><Link href="/creative/motion">{t(locale, "motions.title")}</Link></li>
        <li className="creative-card"><h2>{t(locale, "generate.title")}</h2><Link href="/creative/generate">{t(locale, "generate.title")}</Link></li>
        <li className="creative-card"><h2>{t(locale, "product.title")}</h2><Link href="/creative/product">{t(locale, "product.title")}</Link></li>
      </ul>
      <section aria-label={t(locale, "overview.jobs")}>
        <h2>{t(locale, "overview.jobs")}</h2>
        {jobs.loading ? <Loading locale={locale} /> : jobs.error ? <LoadError locale={locale} error={jobs.error} onRetry={jobs.reload} />
          : !jobs.data?.jobs.length ? <p>{t(locale, "overview.empty")}</p>
          : (
            <ul className="creative-grid">
              {jobs.data.jobs.slice(0, 4).map((job) => (
                <li key={job.job_id} className="creative-card">
                  <h3><Link href={`/creative/jobs/${job.job_id}`}>{job.capability} · {job.status}</Link></h3>
                  <p>{job.lane}</p>
                </li>
              ))}
            </ul>
          )}
      </section>
      <section aria-label={t(locale, "overview.assets")}>
        <h2>{t(locale, "overview.assets")}</h2>
        {assets.loading ? <Loading locale={locale} /> : assets.error ? <LoadError locale={locale} error={assets.error} onRetry={assets.reload} />
          : !assets.data?.assets.length ? <p>{t(locale, "overview.empty")}</p>
          : (
            <ul className="creative-grid">
              {assets.data.assets.slice(0, 4).map((asset) => (
                <li key={asset.asset_id} className="creative-card">
                  <h3><Link href={`/creative/assets/${asset.asset_id}`}>{asset.title ?? asset.capability}</Link></h3>
                  <p>{t(locale, "assets.version")} {asset.latest_version} · {asset.review_status}</p>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
