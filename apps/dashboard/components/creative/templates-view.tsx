"use client";

import { useState } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { CreativeApiError, LoadError, Loading, api, idempotencyKey, useCreativeFetch, useSessionRole } from "@/components/creative/api";
import { CreativeSubnav } from "@/components/creative/creative-subnav";

interface TemplateRow {
  template_id: string;
  organization_id: string | null;
  kind: string;
  name: string;
  version: number;
  is_active: boolean;
}

const KINDS = ["ad", "carousel", "motion", "landing", "caption"] as const;

const KIND_COPY: Record<string, { en: [string, string]; ar: [string, string] }> = {
  ad: { en: ["Ad creative", "A single campaign visual with headline, offer, and call to action."], ar: ["إعلان إبداعي", "تصميم حملة واحد بعنوان وعرض ودعوة لاتخاذ إجراء."] },
  carousel: { en: ["Carousel", "A swipeable sequence for stories, launches, and explainers."], ar: ["كاروسيل", "سلسلة قابلة للتمرير للقصص والإطلاقات والشرح."] },
  motion: { en: ["Motion", "A short animated treatment built from an existing design."], ar: ["حركة", "معالجة قصيرة متحركة مبنية على تصميم موجود."] },
  landing: { en: ["Landing page", "A structured page layout for a campaign destination."], ar: ["صفحة هبوط", "تخطيط صفحة منظم لوجهة الحملة."] },
  caption: { en: ["Caption", "A bilingual caption frame for social publishing."], ar: ["نص منشور", "قالب نص ثنائي اللغة للنشر الاجتماعي."] },
};

function kindCopy(locale: CreativeLocale, kind: string) {
  const entry = KIND_COPY[kind];
  if (!entry) return { title: kind, description: "" };
  const [title, description] = entry[locale];
  return { title, description };
}

export function TemplatesView({ locale, dir }: { locale: CreativeLocale; dir: "rtl" | "ltr" }) {
  const role = useSessionRole();
  const templates = useCreativeFetch<{ templates: TemplateRow[] }>(locale, "/api/creative/templates");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("ad");
  const [spec, setSpec] = useState('{"headline":"Hello"}');
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const canAdmin = role === "owner";
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setNotice(null);
    try {
      const parsed = JSON.parse(spec) as Record<string, unknown>;
      const body = await api<{ template_id: string }>(`/api/creative/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-tpl") },
        body: JSON.stringify({ kind, name: name.trim(), spec: parsed }),
      });
      setNotice(`${t(locale, "templates.created")} (${body.template_id})`);
      setName("");
      await templates.reload();
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  async function toggle(template: TemplateRow) {
    setWorking(true);
    setNotice(null);
    try {
      await api(`/api/creative/templates/${template.template_id}/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-tplact") },
        body: JSON.stringify({ active: !template.is_active }),
      });
      setNotice(t(locale, "templates.toggled"));
      await templates.reload();
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <CreativeSubnav locale={locale} />
      <div className="creative-head"><h1>{t(locale, "templates.title")}</h1></div>
      {canAdmin && (
        <form className="creative-form" onSubmit={create}>
          <h2>{t(locale, "templates.create")}</h2>
          <label>{t(locale, "templates.name")}<input type="text" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
          <label>{t(locale, "templates.kind")}
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              {KINDS.map((value) => <option key={value} value={value}>{kindCopy(locale, value).title}</option>)}
            </select>
          </label>
          <label>{t(locale, "templates.spec")}<textarea value={spec} onChange={(event) => setSpec(event.target.value)} dir="ltr" /></label>
          <button type="submit" className="creative-button" disabled={working || !name.trim()}>{t(locale, "common.save")}</button>
        </form>
      )}
      {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
      {templates.loading ? <Loading locale={locale} /> : templates.error ? <LoadError locale={locale} error={templates.error} onRetry={templates.reload} />
        : !templates.data?.templates.length ? <p>{t(locale, "templates.empty")}</p>
        : (
          <ul className="creative-grid">
            {templates.data.templates.map((template) => {
              const kind = kindCopy(locale, template.kind);
              return (
              <li key={template.template_id} className="creative-card">
                <h2>{kind.title} · {template.name}</h2>
                <p>{kind.description}</p>
                <p>{t(locale, "common.version")}{template.version} · {template.organization_id ? (locale === "ar" ? "خاص بالمؤسسة" : "organization") : (locale === "ar" ? "عام" : "global")} · {template.is_active ? (locale === "ar" ? "نشط" : "active") : (locale === "ar" ? "غير نشط" : "inactive")}</p>
                {canAdmin && (
                  <button type="button" className="creative-button creative-button-secondary" disabled={working} onClick={() => toggle(template)}>
                    {template.is_active ? t(locale, "templates.deactivate") : t(locale, "templates.activate")}
                  </button>
                )}
              </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
