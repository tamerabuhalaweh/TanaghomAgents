"use client";

import Link from "next/link";
import { useState } from "react";

import { CreativeApiError, LoadError, Loading, api, idempotencyKey, useCreativeFetch, useSessionRole } from "@/components/creative/api";
import { CreativeSubnav } from "@/components/creative/creative-subnav";
import {
  TEMPLATE_FORMATS,
  buildTemplateSpec,
  type TemplateFormat,
  type TemplateKind,
} from "@/lib/creative-template-spec";
import { t, type CreativeLocale } from "@/lib/i18n/creative";

interface TemplateRow {
  template_id: string;
  organization_id: string | null;
  kind: string;
  name: string;
  version: number;
  is_active: boolean;
  spec?: Record<string, unknown> | null;
}

const KINDS: readonly TemplateKind[] = ["ad", "carousel", "motion", "landing", "caption"];

const KIND_COPY: Record<string, { en: [string, string]; ar: [string, string] }> = {
  ad: { en: ["Ad creative", "A single campaign visual with headline, offer, and call to action."], ar: ["إعلان إبداعي", "تصميم حملة واحد بعنوان وعرض ودعوة لاتخاذ إجراء."] },
  carousel: { en: ["Carousel", "A swipeable sequence for stories, launches, and explainers."], ar: ["كاروسيل", "سلسلة قابلة للتمرير للقصص والإطلاقات والشرح."] },
  motion: { en: ["Motion", "A short animated treatment built from an existing design."], ar: ["حركة", "معالجة متحركة قصيرة مبنية على تصميم موجود."] },
  landing: { en: ["Landing page", "A structured page layout for a campaign destination."], ar: ["صفحة هبوط", "تخطيط صفحة منظم لوجهة الحملة."] },
  caption: { en: ["Caption", "A bilingual caption frame for social publishing."], ar: ["نص منشور", "قالب نصّي ثنائي اللغة لمنشورات التواصل الاجتماعي."] },
};

function kindCopy(locale: CreativeLocale, kind: string) {
  const entry = KIND_COPY[kind];
  if (!entry) return { title: kind, description: "" };
  const [title, description] = entry[locale];
  return { title, description };
}

function specNodes(spec: Record<string, unknown>): Array<Record<string, unknown>> {
  const list: Array<Record<string, unknown>> = [];
  const push = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (item && typeof item === "object") list.push(item as Record<string, unknown>);
    }
  };
  push(spec.nodes);
  if (Array.isArray(spec.pages)) {
    for (const page of spec.pages) {
      if (page && typeof page === "object") push((page as Record<string, unknown>).nodes);
    }
  }
  return list;
}

/** Reads one text layer out of a stored template spec so the guided form can reopen it. */
function specText(spec: Record<string, unknown> | null | undefined, role: string): string {
  if (!spec) return "";
  const node = specNodes(spec).find((item) => item.role === role);
  if (typeof node?.text === "string") return node.text;
  const flat = spec[role];
  return typeof flat === "string" ? flat : "";
}

function specFormat(spec: Record<string, unknown> | null | undefined): TemplateFormat {
  const canvas = spec && typeof spec.canvas === "object" ? spec.canvas as Record<string, unknown> : null;
  const height = typeof canvas?.height === "number" ? canvas.height : 0;
  if (height >= 1600) return "9:16";
  if (height >= 1200) return "4:5";
  return "1:1";
}

function specBackground(spec: Record<string, unknown> | null | undefined): string {
  const background = spec && typeof spec.background === "object" ? spec.background as Record<string, unknown> : null;
  return typeof background?.color === "string" ? background.color : "#FFFFFF";
}

export function TemplatesView({ locale, dir }: { locale: CreativeLocale; dir: "rtl" | "ltr" }) {
  const role = useSessionRole();
  const templates = useCreativeFetch<{ templates: TemplateRow[] }>(locale, "/api/creative/templates");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TemplateKind>("ad");
  const [format, setFormat] = useState<TemplateFormat>("1:1");
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [cta, setCta] = useState("");
  const [backgroundColor, setBackgroundColor] = useState("#FFFFFF");
  const [useCustomJson, setUseCustomJson] = useState(false);
  const [spec, setSpec] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const canAdmin = role === "owner";
  const visualLayoutKind = kind === "ad" || kind === "carousel";
  const guidedReady = kind !== "motion" && Boolean(headline.trim());
  const canSubmit = !working && Boolean(name.trim()) && (useCustomJson ? Boolean(spec.trim()) : guidedReady);

  function startEditing(template: TemplateRow) {
    setEditing(template.template_id);
    setViewing(null);
    setNotice(null);
    setName(template.name);
    setKind(template.kind as TemplateKind);
    setFormat(specFormat(template.spec));
    setHeadline(specText(template.spec, "headline"));
    setBody(specText(template.spec, "body"));
    setCta(specText(template.spec, "cta"));
    setBackgroundColor(specBackground(template.spec));
    setUseCustomJson(false);
    setSpec("");
  }

  function stopEditing() {
    setEditing(null);
    setName("");
    setHeadline("");
    setBody("");
    setCta("");
    setNotice(null);
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setNotice(null);
    try {
      let resolvedSpec: Record<string, unknown>;
      if (useCustomJson) {
        try {
          const parsed = JSON.parse(spec) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            setNotice(t(locale, "templates.invalidJson"));
            return;
          }
          resolvedSpec = parsed as Record<string, unknown>;
        } catch {
          setNotice(t(locale, "templates.invalidJson"));
          return;
        }
      } else {
        if (kind === "motion") return;
        resolvedSpec = buildTemplateSpec({
          kind,
          locale,
          format,
          headline,
          body,
          cta,
          backgroundColor,
        });
      }
      const response = await api<{ template_id: string }>(`/api/creative/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-tpl") },
        body: JSON.stringify({ kind, name: name.trim(), spec: resolvedSpec }),
      });
      setNotice(`${t(locale, "templates.created")} (${response.template_id})`);
      setName("");
      setHeadline("");
      setBody("");
      setCta("");
      if (useCustomJson) setSpec("");
      setEditing(null);
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
          <h2>{editing ? t(locale, "templates.edit") : t(locale, "templates.create")}</h2>
          {editing ? <p className="creative-helper">{t(locale, "templates.editHint")}</p> : null}
          <label>{t(locale, "templates.name")}<input type="text" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
          <label>{t(locale, "templates.kind")}
            <select value={kind} onChange={(event) => setKind(event.target.value as TemplateKind)}>
              {KINDS.map((value) => <option key={value} value={value}>{kindCopy(locale, value).title}</option>)}
            </select>
          </label>
          {kind === "motion" && !useCustomJson ? (
            <div className="creative-notice" role="note">
              <p>{t(locale, "templates.motionRedirect")}</p>
              <Link className="creative-card-action" href="/creative/motion">{t(locale, "templates.openMotionStudio")}</Link>
            </div>
          ) : !useCustomJson ? (
            <>
              {visualLayoutKind ? (
                <>
                  <label>{t(locale, "templates.format")}
                    <select value={format} onChange={(event) => setFormat(event.target.value as TemplateFormat)}>
                      {TEMPLATE_FORMATS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                  <label>{t(locale, "templates.backgroundColor")}
                    <input type="text" value={backgroundColor} maxLength={7} onChange={(event) => setBackgroundColor(event.target.value)} dir="ltr" placeholder="#FFFFFF" />
                  </label>
                </>
              ) : null}
              <label>{t(locale, "templates.headline")}
                <input type="text" value={headline} maxLength={240} onChange={(event) => setHeadline(event.target.value)} placeholder={t(locale, "templates.headlinePlaceholder")} />
              </label>
              <label>{t(locale, "templates.body")}
                <textarea value={body} maxLength={1000} onChange={(event) => setBody(event.target.value)} placeholder={t(locale, "templates.bodyPlaceholder")} />
              </label>
              <label>{t(locale, "templates.cta")}
                <input type="text" value={cta} maxLength={90} onChange={(event) => setCta(event.target.value)} placeholder={t(locale, "templates.ctaPlaceholder")} />
              </label>
            </>
          ) : null}
          <details className="creative-more">
            <summary>{t(locale, "templates.advanced")}</summary>
            <p className="creative-helper">{t(locale, "templates.advancedHint")}</p>
            <label className="creative-row">
              <input
                type="checkbox"
                checked={useCustomJson}
                style={{ inlineSize: "auto" }}
                onChange={(event) => setUseCustomJson(event.target.checked)}
              />
              <span>{t(locale, "templates.useCustomJson")}</span>
            </label>
            {useCustomJson ? (
              <label>{t(locale, "templates.spec")}
                <textarea value={spec} onChange={(event) => setSpec(event.target.value)} dir="ltr" />
              </label>
            ) : null}
          </details>
          <div className="creative-row">
            <button type="submit" className="creative-button" disabled={!canSubmit}>{t(locale, "common.save")}</button>
            {editing ? <button type="button" className="creative-button creative-button-secondary" onClick={stopEditing}>{t(locale, "templates.cancelEdit")}</button> : null}
          </div>
        </form>
      )}
      {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
      {templates.loading ? <Loading locale={locale} /> : templates.error ? <LoadError locale={locale} error={templates.error} onRetry={templates.reload} />
        : !templates.data?.templates.length ? <p>{t(locale, "templates.empty")}</p>
        : (
          <ul className="creative-grid">
            {templates.data.templates.map((template) => {
              const entry = kindCopy(locale, template.kind);
              return (
              <li key={template.template_id} className="creative-card">
                <h2>{entry.title} · {template.name}</h2>
                <p>{entry.description}</p>
                <p>{t(locale, "common.version")}{template.version} · {template.organization_id ? (locale === "ar" ? "خاص بالمؤسسة" : "organization") : (locale === "ar" ? "عام" : "global")} · {template.is_active ? (locale === "ar" ? "نشط" : "active") : (locale === "ar" ? "غير نشط" : "inactive")}</p>
                <div className="creative-card-actions">
                  <button
                    type="button"
                    className="creative-button creative-button-secondary"
                    aria-expanded={viewing === template.template_id}
                    onClick={() => setViewing(viewing === template.template_id ? null : template.template_id)}
                  >
                    {viewing === template.template_id ? t(locale, "templates.close") : t(locale, "templates.view")}
                  </button>
                  {canAdmin && (
                    <button type="button" className="creative-button creative-button-secondary" disabled={working} onClick={() => startEditing(template)}>
                      {t(locale, "templates.edit")}
                    </button>
                  )}
                  {canAdmin && (
                    <button type="button" className="creative-button creative-button-secondary" disabled={working} onClick={() => toggle(template)}>
                      {template.is_active ? t(locale, "templates.deactivate") : t(locale, "templates.activate")}
                    </button>
                  )}
                </div>
                {viewing === template.template_id && (
                  <section className="creative-card-detail" aria-label={t(locale, "templates.details")}>
                    <h3>{t(locale, "templates.details")}</h3>
                    <dl>
                      <div><dt>{t(locale, "templates.name")}</dt><dd>{template.name}</dd></div>
                      <div><dt>{t(locale, "templates.kind")}</dt><dd>{entry.title}</dd></div>
                      <div><dt>{t(locale, "common.version")}</dt><dd>{template.version}</dd></div>
                      <div><dt>{t(locale, "templates.specLabel")}</dt><dd><pre dir="ltr">{JSON.stringify(template.spec ?? {}, null, 2)}</pre></dd></div>
                    </dl>
                  </section>
                )}
              </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
