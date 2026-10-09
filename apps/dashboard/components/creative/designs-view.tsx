"use client";

import Link from "next/link";
import { useState } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { CreativeApiError, LoadError, Loading, api, idempotencyKey, useCreativeFetch, useSessionRole } from "@/components/creative/api";

interface DesignRow {
  template_id: string;
  organization_id: string | null;
  kind: string;
  name: string;
  version: number;
  is_active: boolean;
}

const FORMATS = [
  { label: "1:1", width: 1080, height: 1080 },
  { label: "4:5", width: 1080, height: 1350 },
  { label: "9:16", width: 1080, height: 1920 },
];

export function blankAdSpec(locale: CreativeLocale, width: number, height: number) {
  const ar = locale === "ar";
  return {
    locale, direction: locale === "ar" ? "rtl" : "ltr",
    canvas: { width, height },
    background: { color: "#ffffff" },
    nodes: [
      { id: "headline-1", type: "text", role: "headline", x: 90, y: 120, width: 900, height: 220, text: ar ? "عنوان رئيسي" : "Headline", font_size: 96, font_weight: 800, align: "start", color: "#111111" },
      { id: "body-1", type: "text", role: "body", x: 90, y: 380, width: 900, height: 160, text: ar ? "نص توضيحي قصير" : "Short supporting copy", font_size: 44, font_weight: 400, align: "start", color: "#334155" },
      { id: "cta-1", type: "badge", role: "cta", x: 90, y: 580, width: 420, height: 110, text: ar ? "اطلب الآن" : "Shop now", font_size: 44, font_weight: 700, align: "center", color: "#ffffff", background_color: "#0f766e", corner_radius: 55 },
    ],
  };
}

export function blankCarouselSpec(locale: CreativeLocale, width: number, height: number) {
  const ar = locale === "ar";
  const page = (id: string, kind: string, headline: string, body: string) => ({
    id, kind,
    nodes: [
      { id: `${id}-headline`, type: "text", role: "headline", x: 90, y: 120, width: 900, height: 220, text: headline, font_size: 88, font_weight: 800, align: "start", color: "#111111" },
      { id: `${id}-body`, type: "text", role: "body", x: 90, y: 380, width: 900, height: 220, text: body, font_size: 44, font_weight: 400, align: "start", color: "#334155" },
    ],
  });
  return {
    locale, direction: locale === "ar" ? "rtl" : "ltr",
    canvas: { width, height },
    background: { color: "#ffffff" },
    pages: [
      page("slide-1", "cover", ar ? "غلاف" : "Cover", ar ? "ابدأ من هنا" : "Start here"),
      page("slide-2", "body", ar ? "الفكرة" : "The idea", ar ? "شرح مختصر" : "Brief explainer"),
      page("slide-3", "end", ar ? "الخطوة التالية" : "Next step", ar ? "تواصل معنا" : "Get in touch"),
    ],
  };
}

export function DesignsView({ locale, dir }: { locale: CreativeLocale; dir: "rtl" | "ltr" }) {
  const role = useSessionRole();
  const designs = useCreativeFetch<{ designs: DesignRow[] }>(locale, "/api/creative/designs");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("ad");
  const [designLocale, setDesignLocale] = useState<CreativeLocale>(locale);
  const [formatIndex, setFormatIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const canAdmin = role === "owner";
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setNotice(null);
    try {
      const format = FORMATS[formatIndex];
      const spec = kind === "ad"
        ? blankAdSpec(designLocale, format.width, format.height)
        : blankCarouselSpec(designLocale, format.width, format.height);
      const body = await api<{ template_id: string }>(`/api/creative/designs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-design") },
        body: JSON.stringify({ kind, name: name.trim(), spec }),
      });
      setNotice(t(locale, "designs.created"));
      setName("");
      window.location.assign(`/creative/designs/${body.template_id}`);
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <div className="creative-head"><h1>{t(locale, "designs.title")}</h1></div>
      {canAdmin && (
        <form className="creative-form" onSubmit={create}>
          <h2>{t(locale, "designs.create")}</h2>
          <label>{t(locale, "designs.name")}<input type="text" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
          <label>{t(locale, "designs.kind")}
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="ad">{t(locale, "designs.ad")}</option>
              <option value="carousel">{t(locale, "designs.carousel")}</option>
            </select>
          </label>
          <label>{t(locale, "designs.locale")}
            <select value={designLocale} onChange={(event) => setDesignLocale(event.target.value as CreativeLocale)}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </label>
          <label>{t(locale, "designs.format")}
            <select value={formatIndex} onChange={(event) => setFormatIndex(Number(event.target.value))}>
              {FORMATS.map((option, index) => <option key={option.label} value={index}>{option.label}</option>)}
            </select>
          </label>
          <button type="submit" className="creative-button" disabled={working || !name.trim()}>{t(locale, "common.save")}</button>
        </form>
      )}
      {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
      {designs.loading ? <Loading locale={locale} /> : designs.error ? <LoadError locale={locale} error={designs.error} onRetry={designs.reload} />
        : !designs.data?.designs.length ? <p>{t(locale, "designs.empty")}</p>
        : (
          <ul className="creative-grid">
            {designs.data.designs.map((design) => (
              <li key={`${design.template_id}`} className="creative-card">
                <h2><Link href={`/creative/designs/${design.template_id}`}>{design.name}</Link></h2>
                <p>{design.kind} · {t(locale, "common.version")}{design.version} · {design.organization_id ? "org" : "global"}</p>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
