"use client";

import {
  ArchiveRestore,
  BookCheck,
  CheckCircle2,
  CircleAlert,
  FilePlus2,
  Languages,
  RefreshCw,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { useLocale } from "@/lib/client/use-locale";
import { formatDateTime } from "@/lib/i18n/format";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import type { Tone } from "@/data/fixtures";

type KnowledgeStatus = "draft" | "reviewed" | "approved" | "active" | "superseded" | "revoked";
type LifecycleAction = "review" | "approve" | "activate" | "revoke" | "rollback";

interface KnowledgeVersion {
  source_id: string;
  source_key: string;
  title: string;
  category: string;
  provenance_type: string;
  provenance_ref: string | null;
  version_id: string;
  version_number: number;
  status: KnowledgeStatus;
  language: "en" | "ar" | "und";
  content: string;
  content_fingerprint: string;
  created_at: string;
  activated_at: string | null;
  revoked_reason: string | null;
  created_by_name: string;
}

interface KnowledgePayload {
  versions: KnowledgeVersion[];
  counts: { sources: number; active: number; awaiting_review: number; revoked: number };
  policy: null | {
    version_number: number;
    confidence_threshold: string;
    supported_languages: string[];
    mandatory_escalations: string[];
    forbidden_topics: string[];
    sensitive_data_rules: string[];
    prompt_version: string;
    activated_at: string;
  };
  proposal_stats: { total: number; escalated: number; ungrounded: number };
}

const statusTone: Record<KnowledgeStatus, Tone> = {
  draft: "neutral", reviewed: "working", approved: "attention", active: "success",
  superseded: "neutral", revoked: "danger",
};
const categoryLabels: Record<string, string> = {
  product: "Product", service: "Service", pricing: "Pricing", faq: "FAQ",
  policy: "Policy", offer: "Offer", objection: "Objection handling",
  qualification: "Qualification", location: "Location", hours: "Hours",
  escalation_rule: "Escalation rule", disclaimer: "Disclaimer",
  dialect_example: "Dialect example",
};
const actionLabels: Record<LifecycleAction, string> = {
  review: "Mark reviewed", approve: "Approve", activate: "Activate",
  revoke: "Revoke", rollback: "Restore version",
};
const actionLabelsAr: Record<LifecycleAction, string> = {
  review: "تعليم كمُراجَع", approve: "اعتماد", activate: "تفعيل",
  revoke: "إلغاء", rollback: "استعادة نسخة",
};
const statusLabelsAr: Record<KnowledgeStatus, string> = {
  draft: "مسودة", reviewed: "مُراجَعة", approved: "معتمدة", active: "نشطة",
  superseded: "مستبدلة", revoked: "ملغاة",
};
const categoryLabelsAr: Record<string, string> = {
  product: "منتج", service: "خدمة", pricing: "تسعير", faq: "أسئلة شائعة",
  policy: "سياسة", offer: "عرض", objection: "معالجة اعتراضات",
  qualification: "تأهيل", location: "الموقع", hours: "ساعات العمل",
  escalation_rule: "قاعدة تصعيد", disclaimer: "إخلاء مسؤولية",
  dialect_example: "مثال لهجة",
};
const nextActions: Record<KnowledgeStatus, LifecycleAction[]> = {
  draft: ["review"], reviewed: ["approve", "revoke"], approved: ["activate", "revoke"],
  active: ["revoke"], superseded: ["rollback"], revoked: [],
};

function formatted(value: string | null, locale: "ar" | "en") {
  return value ? formatDateTime(value, locale) : (locale === "ar" ? "لم يبدأ بعد" : "Not yet");
}

export function KnowledgeManagement() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [payload, setPayload] = useState<KnowledgePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [composerOpen, setComposerOpen] = useState(false);
  const [filter, setFilter] = useState<KnowledgeStatus | "all">("all");
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await authenticatedFetch("/api/admin/knowledge");
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error("knowledge_load_failed");
      setPayload(await response.json() as KnowledgePayload);
      setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => payload?.versions.filter((version) => filter === "all" || version.status === filter) || [], [filter, payload]);

  return <div className="page-stack knowledge-page">
    <PageHeading
      title={ar ? "معرفة المبيعات" : "Sales knowledge"}
      description={ar ? "تحكم بدقة في الحقائق والسياسات والعروض وأمثلة اللغة التي يجوز لوكيل المبيعات استخدامها في مقترحات الردود." : "Control exactly which customer facts, policies, offers, and language examples the Sales Agent may use in response proposals."}
      actions={<button className="primary-button" type="button" onClick={() => setComposerOpen((value) => !value)}><FilePlus2 size={17} /> {composerOpen ? (ar ? "إغلاق المسودة" : "Close draft") : (ar ? "إضافة معرفة" : "Add knowledge")}</button>}
    />

    {state === "loading" ? <KnowledgeLoading /> : null}
    {state === "forbidden" ? <KnowledgeState icon={<ShieldCheck />} title="Admin access required" copy="Only an E3lani Admin can review, approve, activate, revoke, or restore customer knowledge." /> : null}
    {state === "error" ? <KnowledgeState icon={<CircleAlert />} title="Knowledge catalog unavailable" copy="E3lani could not load the protected organization catalog." action={<button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={16} /> Try again</button>} /> : null}

    {state === "ready" && payload ? <>
      <section className="knowledge-safety" aria-label={ar ? "حدود أمان المعرفة" : "Knowledge safety boundary"}>
        <ShieldCheck size={20} />
        <div><strong>{ar ? "الاعتماد على الحقائق الموثقة مفعّل" : "Strict factual grounding is enforced"}</strong><p>{ar ? "لا تُستخدم إلا النسخ النشطة، ويجب أن يستند كل رد إلى المعرفة الموثقة. الحالات غير المؤكدة أو الحساسة تُحال إلى مراجعة بشرية." : "Only active versions can be retrieved, and every factual response must rely on verified knowledge. Uncertain or sensitive cases go to a person for review."}</p></div>
        <StatusPill tone="success">{ar ? "لا رد تلقائي" : "No auto-reply"}</StatusPill>
      </section>

      {composerOpen ? <KnowledgeComposer hasExisting={payload.counts.sources > 0 || payload.versions.length > 0} onCreated={async () => { setComposerOpen(false); setFeedback(ar ? "أُنشئت المسودة. راجعها وفعّلها قبل أن يتمكن الوكلاء من استرجاعها." : "Draft created. Review and activate it before agents can retrieve it."); await load(); }} /> : null}

      <section className="knowledge-overview" aria-label={ar ? "ملخص دليل المعرفة" : "Knowledge catalog summary"}>
        <dl>
          <div><dt>{ar ? "المصادر" : "Sources"}</dt><dd>{payload.counts.sources}</dd></div>
          <div><dt>{ar ? "النسخ النشطة" : "Active versions"}</dt><dd>{payload.counts.active}</dd></div>
          <div><dt>{ar ? "بانتظار المراجعة" : "Awaiting review"}</dt><dd>{payload.counts.awaiting_review}</dd></div>
          <div><dt>{ar ? "الملغاة" : "Revoked"}</dt><dd>{payload.counts.revoked}</dd></div>
        </dl>
        <div className="knowledge-policy-summary">
          <Languages size={18} />
          <span><strong>{ar ? `سياسة المعرفة العربية والإنجليزية — الإصدار ${payload.policy?.version_number || "—"}` : `English and Arabic knowledge policy v${payload.policy?.version_number || "—"}`}</strong><small>{ar ? "الاعتماد على الحقائق الموثقة: تتطلب ردود الذكاء الاصطناعي معرفة موثقة ومراجعة بشرية عند عدم اليقين." : "Strict factual grounding: AI responses require verified knowledge and human review when uncertain."}</small></span>
        </div>
      </section>

      <section className="knowledge-catalog" aria-labelledby="knowledge-catalog-title">
        <header className="knowledge-catalog-header">
          <div><h2 id="knowledge-catalog-title">{ar ? "دليل النسخ" : "Version catalog"}</h2><p>{ar ? "تبقى المسودات غير مرئية للوكلاء حتى تتم مراجعتها واعتمادها وتفعيلها." : "Drafts are invisible to agents until reviewed, approved, and activated."}</p></div>
          <label><span className="sr-only">{ar ? "تصفية النسخ حسب الحالة" : "Filter versions by status"}</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">{ar ? "جميع الحالات" : "All statuses"}</option>{Object.keys(nextActions).map((status) => <option value={status} key={status}>{ar ? ({ draft: "مسودة", reviewed: "مُراجعة", approved: "معتمدة", active: "نشطة", superseded: "مستبدلة", revoked: "ملغاة" } as Record<string, string>)[status] : status[0].toUpperCase() + status.slice(1)}</option>)}</select></label>
        </header>
        {visible.length ? <div className="knowledge-version-list">{visible.map((version) => <KnowledgeRow key={version.version_id} version={version} onChanged={async (message) => { setFeedback(message); await load(); }} />)}</div> : <div className="knowledge-empty"><BookCheck size={22} /><div><h3>{payload.versions.length ? (ar ? "لا توجد نسخ تطابق هذا التصفية" : "No versions match this filter") : (ar ? "ابنِ مجموعة الإجابات المعتمدة" : "Build the approved answer set")}</h3><p>{payload.versions.length ? (ar ? "اختر حالة دورة حياة أخرى للمتابعة." : "Choose another lifecycle status to continue.") : (ar ? "أضف حقيقة أو سياسة أو سؤالاً شائعاً أو عرضاً قدّمه العميل كمسودة." : "Add a customer-supplied fact, policy, FAQ, offer, or language example as a draft.")}</p></div>{!payload.versions.length ? <button className="primary-button" type="button" onClick={() => { setComposerOpen(true); window.setTimeout(() => document.getElementById("knowledge-composer")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }}><FilePlus2 size={16} />{ar ? "أضف أول إجابة معتمدة" : "Add first approved answer"}</button> : null}</div>}
      </section>
      {feedback ? <p className="integration-feedback" role="status" aria-live="polite">{feedback}</p> : null}
    </> : null}
  </div>;
}

function KnowledgeComposer({ hasExisting, onCreated }: { hasExisting: boolean; onCreated: () => Promise<void> }) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("faq");
  const [language, setLanguage] = useState("en");
  const [provenanceType, setProvenanceType] = useState("customer_entry");
  const [provenanceRef, setProvenanceRef] = useState("");
  const [content, setContent] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await authenticatedFetch("/api/admin/knowledge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_key: sourceKey, title, category, language, content,
          provenance_type: provenanceType, provenance_ref: provenanceRef, structured_facts: [] }),
      });
      if (!response.ok) throw new Error(ar ? "تعذّر إنشاء المسودة. تحقّق من المعرّف المرجعي والحقول المطلوبة." : "The draft could not be created. Check the source key and required fields.");
      await onCreated();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The draft could not be created."); }
    finally { setBusy(false); }
  }

  return <form id="knowledge-composer" className="knowledge-composer" onSubmit={(event) => void submit(event)} dir={ar ? "rtl" : "ltr"} lang={locale}>
    <header><div><h2>{hasExisting ? (ar ? "أضف مسودة إجابة معتمدة أخرى" : "Add another approved answer draft") : (ar ? "ابدأ مسودة جديدة" : "Start a new draft")}</h2><p>{hasExisting ? (ar ? "استخدم المعرّف المرجعي نفسه لإضافة نسخة جديدة. ولا يُعدَّل النص المعتمد الحالي في مكانه أبدًا." : "Reuse a source key to add a new version. Existing approved text is never edited in place.") : (ar ? "لم يُحفظ شيء بعد — ابدأ مسودة جديدة." : "Nothing saved yet — start a blank draft.")}</p></div><StatusPill tone="neutral">{ar ? "مسودة" : "Draft"}</StatusPill></header>
    <div className="knowledge-form-grid">
      <label><span>{ar ? "المعرّف المرجعي" : "Source key"}</span><input value={sourceKey} onChange={(event) => setSourceKey(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} pattern="[a-z][a-z0-9_-]{2,79}" placeholder={ar ? "مثال: pricing_standard" : "e.g. pricing_standard"} required /><small>{ar ? "معرّف ثابت يتكوّن من حروف إنجليزية صغيرة وأرقام وشرطات أو شرطات سفلية." : "Stable identifier; lowercase letters, numbers, dashes, or underscores."}</small></label>
      <label><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={200} placeholder={ar ? "مثال: التسعير القياسي للخدمة" : "e.g. Standard service pricing"} required /></label>
      <label><span>{ar ? "التصنيف" : "Category"}</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{Object.entries(ar ? categoryLabelsAr : categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>{ar ? "اللغة" : "Language"}</span><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="en">{ar ? "الإنجليزية" : "English"}</option><option value="ar">{ar ? "العربية" : "Arabic"}</option><option value="und">{ar ? "محايد لغويًا" : "Language-neutral"}</option></select></label>
      <label><span>{ar ? "المصدر" : "Provenance"}</span><select value={provenanceType} onChange={(event) => setProvenanceType(event.target.value)}><option value="customer_entry">{ar ? "إدخال العميل" : "Customer entry"}</option><option value="customer_document">{ar ? "مستند من العميل" : "Customer document"}</option><option value="approved_url">{ar ? "رابط معتمد" : "Approved URL"}</option><option value="legal_policy">{ar ? "سياسة قانونية" : "Legal policy"}</option><option value="operator_note">{ar ? "ملاحظة المشغّل" : "Operator note"}</option></select></label>
      <label><span>{ar ? "المرجع المصدر" : "Source reference"} <em>{ar ? "اختياري" : "Optional"}</em></span><input value={provenanceRef} onChange={(event) => setProvenanceRef(event.target.value)} maxLength={1000} placeholder={ar ? "اسم المستند أو الرابط المعتمد" : "Document name or approved URL"} /></label>
      <label className="knowledge-content-field"><span>{ar ? "نص الإجابة المعتمدة" : "Approved-answer material"}</span><textarea dir={language === "ar" ? "rtl" : "ltr"} value={content} onChange={(event) => setContent(event.target.value)} minLength={3} maxLength={30000} rows={7} placeholder={ar ? "اكتب فقط الحقائق والصياغة التي قدّمها العميل ويمكن للمراجع التحقق منها." : "Enter only customer-supplied facts and wording that reviewers can verify."} required /><small>{ar ? "لا تُدرج كلمات مرور أو رموز وصول أو بيانات بطاقات دفع أو معلومات شخصية غير ضرورية." : "Do not include passwords, access tokens, payment card data, or unnecessary personal information."}</small></label>
    </div>
    <footer><div>{error ? <p role="alert">{error}</p> : <p>{ar ? "الحفظ ينشئ مسودة فقط. لا يمكن للوكلاء استرجاعها." : "Saving creates a draft only. Agents cannot retrieve it."}</p>}</div><button className="primary-button" type="submit" disabled={busy}>{busy ? (ar ? "جارٍ إنشاء المسودة…" : "Creating draft…") : (ar ? "إنشاء مسودة" : "Create draft")}</button></footer>
  </form>;
}

function KnowledgeRow({ version, onChanged }: { version: KnowledgeVersion; onChanged: (message: string) => Promise<void> }) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [busy, setBusy] = useState<LifecycleAction | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function transition(action: LifecycleAction) {
    if (action === "revoke" && !revokeOpen) { setRevokeOpen(true); return; }
    setBusy(action); setError("");
    try {
      const response = await authenticatedFetch(`/api/admin/knowledge/${version.version_id}/transition`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: action === "revoke" ? reason : undefined }),
      });
      if (!response.ok) throw new Error("This lifecycle transition was rejected. Refresh and verify the current version state.");
      setRevokeOpen(false); setReason("");
      await onChanged(ar
        ? action === "activate" ? "تم تفعيل المعرفة للمقترحات المقبلة." : action === "rollback" ? "تمت استعادة النسخة السابقة واستُبدلت النسخة النشطة." : actionLabelsAr[action] + "."
        : action === "activate" ? "Knowledge activated for future proposals." : action === "rollback" ? "Earlier version restored; the previous active version was superseded." : `Version ${actionLabels[action].toLowerCase()}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The version could not be updated."); }
    finally { setBusy(null); }
  }

  return <article className="knowledge-version-row">
    <div className="knowledge-version-main">
      <div className="knowledge-version-title"><div><h3>{version.title}</h3><p>{ar ? categoryLabelsAr[version.category] || version.category : categoryLabels[version.category] || version.category} · {version.language === "ar" ? "العربية" : version.language === "en" ? "الإنجليزية" : (ar ? "محايد لغويًا" : "Language-neutral")} · v{version.version_number}</p></div><StatusPill tone={statusTone[version.status]}>{ar ? statusLabelsAr[version.status] : version.status}</StatusPill></div>
      <details><summary>{ar ? "عرض النص والمصدر" : "View source content and provenance"}</summary><div className="knowledge-version-detail"><p dir={version.language === "ar" ? "rtl" : "ltr"}>{version.content}</p><dl><div><dt>{ar ? "المعرّف المرجعي" : "Source key"}</dt><dd>{version.source_key}</dd></div><div><dt>{ar ? "أنشأها" : "Created by"}</dt><dd>{version.created_by_name}</dd></div><div><dt>{ar ? "المصدر" : "Provenance"}</dt><dd>{version.provenance_ref || version.provenance_type.replaceAll("_", " ")}</dd></div><div><dt>{ar ? "البصمة" : "Fingerprint"}</dt><dd><code>{version.content_fingerprint}</code></dd></div><div><dt>{ar ? "تاريخ التفعيل" : "Activated"}</dt><dd>{formatted(version.activated_at, locale)}</dd></div></dl>{version.revoked_reason ? <p className="knowledge-revoked-reason"><ShieldX size={15} /> {version.revoked_reason}</p> : null}</div></details>
    </div>
    <div className="knowledge-version-actions">
      {nextActions[version.status].map((action) => <button key={action} className={action === "revoke" ? "text-danger-button compact-button" : action === "activate" ? "primary-button compact-button" : "secondary-button compact-button"} type="button" disabled={Boolean(busy)} onClick={() => void transition(action)}>{action === "rollback" ? <ArchiveRestore size={15} /> : action === "activate" ? <CheckCircle2 size={15} /> : null}{busy === action ? (ar ? "جارٍ التنفيذ…" : "Working…") : (ar ? actionLabelsAr[action] : actionLabels[action])}</button>)}
      {revokeOpen ? <div className="knowledge-revoke"><label><span>{ar ? "سبب الإلغاء" : "Reason for revocation"}</span><input value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={1000} autoFocus /></label><div><button className="danger-button compact-button" type="button" disabled={reason.trim().length < 3 || Boolean(busy)} onClick={() => void transition("revoke")}>{ar ? "تأكيد الإلغاء" : "Confirm revoke"}</button><button className="ghost-button compact-button" type="button" onClick={() => { setRevokeOpen(false); setReason(""); }}>{ar ? "إلغاء" : "Cancel"}</button></div></div> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </article>;
}

function KnowledgeState({ icon, title, copy, action }: { icon: React.ReactNode; title: string; copy: string; action?: React.ReactNode }) {
  return <section className="domain-empty">{icon}<div><h2>{title}</h2><p>{copy}</p></div>{action}</section>;
}

function KnowledgeLoading() {
  return <div className="knowledge-loading" aria-label="Loading sales knowledge"><div className="state-skeleton" /><div className="state-skeleton" /><div className="state-skeleton" /></div>;
}
