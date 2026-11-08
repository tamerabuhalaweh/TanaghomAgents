"use client";

import Link from "next/link";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { LoadError, Loading, useCreativeFetch } from "@/components/creative/api";
import { CreativeSubnav } from "@/components/creative/creative-subnav";

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

interface DesignRow {
  template_id: string;
  kind: string;
  name: string;
  version: number;
  organization_id: string | null;
}

const coreTools = [
  { href: "/creative/designs", titleKey: "designs.title", en: "Ads and carousels ready to edit", ar: "إعلانات وكاروسيل جاهزة للتعديل" },
  { href: "/creative/motion", titleKey: "motions.title", en: "Animate an existing design", ar: "حرّك تصميماً موجوداً" },
  { href: "/creative/brand-kits", titleKey: "nav.brands", en: "Colors, tone and fonts", ar: "الألوان والنبرة والخطوط" },
  { href: "/creative/templates", titleKey: "nav.templates", en: "Reusable layout templates", ar: "قوالب تخطيط قابلة لإعادة الاستخدام" },
] as const;

export function CreativeOverview({ locale, dir }: { locale: CreativeLocale; dir: "rtl" | "ltr" }) {
  const ar = locale === "ar";
  const designs = useCreativeFetch<{ designs: DesignRow[] }>(locale, "/api/creative/designs");
  const jobs = useCreativeFetch<{ jobs: JobRow[] }>(locale, "/api/creative/jobs");
  const assets = useCreativeFetch<{ assets: AssetRow[] }>(locale, "/api/creative/assets");
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <CreativeSubnav locale={locale} />
      <div className="creative-head">
        <div>
          <h1>{t(locale, "overview.title")}</h1>
          <p className="creative-lede">{t(locale, "overview.lede")}</p>
        </div>
      </div>

      <section className="creative-gallery" aria-label={ar ? "معرض التصاميم" : "Designs gallery"}>
        <div className="creative-head">
          <div>
            <h2>{ar ? "معرض التصاميم" : "Designs Gallery"}</h2>
            <p className="creative-lede">{ar ? "تصاميم جاهزة للتعديل تظهر كما ستُنشر." : "Ready-to-edit designs, shown as they will render."}</p>
          </div>
          <Link className="creative-button creative-button-secondary" href="/creative/designs">{ar ? "كل التصاميم" : "All designs"}</Link>
        </div>
        {designs.loading ? <Loading locale={locale} /> : designs.error ? <LoadError locale={locale} error={designs.error} onRetry={designs.reload} />
          : !designs.data?.designs.length ? <p>{t(locale, "designs.empty")}</p>
          : (
            <ul className="creative-grid">
              {designs.data.designs.slice(0, 4).map((design) => (
                <li key={design.template_id} className="creative-card">
                  <div className="creative-thumb">
                    <iframe title={design.name} src={`/api/creative/designs/${design.template_id}/preview?format=1:1`} loading="lazy" tabIndex={-1} />
                  </div>
                  <h3><Link href={`/creative/designs/${design.template_id}`}>{design.name}</Link></h3>
                  <p>{design.kind} · {t(locale, "common.version")}{design.version}</p>
                  <Link className="creative-card-action" href={`/creative/designs/${design.template_id}`}>{ar ? "تعديل التصميم" : "Edit design"}</Link>
                </li>
              ))}
            </ul>
          )}
      </section>

      <ul className="creative-grid creative-grid-core">
        {coreTools.map((tool) => (
          <li key={tool.href} className="creative-card">
            <h2>{t(locale, tool.titleKey)}</h2>
            <p>{ar ? tool.ar : tool.en}</p>
            <Link className="creative-card-action" href={tool.href}>{ar ? "فتح" : "Open"}</Link>
          </li>
        ))}
      </ul>

      <details className="creative-more">
        <summary>{ar ? "أدوات المشغّل والمزيد" : "More creative tools"}</summary>
        <ul className="creative-grid">
          <li className="creative-card"><h2>{t(locale, "nav.jobs")}</h2><Link href="/creative/jobs">{t(locale, "overview.jobs")}</Link></li>
          <li className="creative-card"><h2>{t(locale, "nav.assets")}</h2><Link href="/creative/assets">{t(locale, "overview.assets")}</Link></li>
          <li className="creative-card"><h2>{t(locale, "video.title")}</h2><Link href="/creative/video">{t(locale, "video.title")}</Link></li>
          <li className="creative-card"><h2>{ar ? "استوديو المتحدث" : "Talking Head Studio"}</h2><Link href="/creative/presenters">{ar ? "متحدث ومزامنة الشفاه" : "Talking head and lip sync"}</Link><p>{ar ? "معطل افتراضيًا؛ قبول المزود قيد الانتظار" : "Default off; provider acceptance pending"}</p></li>
          <li className="creative-card"><h2>{ar ? "إدارة الشخصيات" : "Avatar Management"}</h2><Link href="/creative/avatars">{ar ? "الهويات والربط والموافقة" : "Identity, bindings and consent"}</Link></li>
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
      </details>
    </div>
  );
}
