"use client";

import { ArrowRight, CircleDollarSign, FileCheck2, Plus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Tone } from "@/data/fixtures";
import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { useLocale } from "@/lib/client/use-locale";
import { formatArabicCount, formatNumber } from "@/lib/i18n/format";
import { CampaignForm, type CampaignFormValue } from "./campaign-form";
import { useOperations } from "./operations-context";
import { DomainEmpty, OperationsError, OperationsLoading } from "./operations-state";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

function campaignTone(status: string): Tone {
  if (status === "active" || status === "closed") return "success";
  if (status === "blocked_missing_info") return "danger";
  if (status === "awaiting_approval" || status === "paused") return "attention";
  if (status === "draft") return "neutral";
  return "working";
}
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function money(value: string | null, currency: string, ar: boolean) {
  if (!value) return ar ? "غير محددة" : "Not set";
  if (ar) return `${formatNumber(Number(value), "ar", { maximumFractionDigits: 0 })} ${currency.toUpperCase() === "USD" ? "دولارًا" : currency.toUpperCase()}`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value));
}
// Work packs share the workspace vocabulary, so /campaigns never calls a pack
// "Rejected" while /workspace calls the same state "Changes requested".
const statusLabels: Record<string, string> = { draft: "Brief", blocked_missing_info: "Missing information", strategy_ready: "Strategy ready", content_in_progress: "Preparing content", awaiting_approval: "Awaiting approval", active: "Active", paused: "Paused", closed: "Closed", queued: "Queued", running: "Working", in_progress: "Working", waiting_review: "Ready for your review", approved: "Approved", rejected: "Changes requested", failed: "Needs attention", cancelled: "Cancelled" };
const statusLabelsAr: Record<string, string> = { draft: "موجز", blocked_missing_info: "ناقصة المعلومات", strategy_ready: "الاستراتيجية جاهزة", content_in_progress: "المحتوى قيد الإعداد", awaiting_approval: "بانتظار الاعتماد", active: "نشطة", paused: "متوقفة", closed: "مغلقة", queued: "في الانتظار", running: "قيد العمل", in_progress: "قيد العمل", waiting_review: "جاهز لمراجعتك", approved: "معتمدة", rejected: "طُلب التعديل", failed: "يحتاج إلى انتباه", cancelled: "أُلغي" };
function statusLabel(value: string, ar: boolean) {
  const table = ar ? statusLabelsAr : statusLabels;
  return table[value] || label(value);
}
function stage(status: string, jobType: string | null, jobStatus: string | null, ar: boolean) {
  if (ar) {
    if (jobType === "campaign.strategy.generate") return `الاستراتيجية · ${statusLabel(jobStatus || "queued", true)}`;
    if (jobType === "campaign.content.generate" && status !== "awaiting_approval") return `المحتوى · ${statusLabel(jobStatus || "queued", true)}`;
    if (status === "draft" || status === "blocked_missing_info") return "الموجز";
    if (status === "strategy_ready") return "الاستراتيجية";
    if (status === "content_in_progress" || status === "awaiting_approval") return "مراجعة المحتوى";
    if (status === "active") return "جاهزة للتسليم";
    return statusLabel(status, true);
  }
  if (jobType === "campaign.strategy.generate") return `Strategy · ${label(jobStatus || "queued")}`;
  if (jobType === "campaign.content.generate" && status !== "awaiting_approval") return `Content · ${label(jobStatus || "queued")}`;
  if (status === "draft" || status === "blocked_missing_info") return "Brief";
  if (status === "strategy_ready") return "Strategy";
  if (status === "content_in_progress" || status === "awaiting_approval") return "Content review";
  if (status === "active") return "Ready for handoff";
  return label(status);
}

const errorMessages: Record<string, string> = {
  campaign_input_invalid: "Review the brief, audience, geography, targets, and content count.",
  valid_idempotency_key_required: "We could not safely identify this request. Try again.",
  forbidden: "Only an owner or operator can create a campaign.",
  service_unavailable: "E3lani could not create the campaign. Try again.",
};

export function CampaignsView() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const operations = useOperations();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canOperate = operations.status === "ready"
    && ["owner", "operator"].includes(operations.data.current_user.role);

  async function createCampaign(value: CampaignFormValue) {
    setBusy(true); setError(null);
    try {
      const response = await authenticatedFetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `campaign-create-${crypto.randomUUID()}` },
        body: JSON.stringify(value),
      });
      const payload = await response.json() as { error?: string; campaign?: { campaign_id: string } };
      if (!response.ok || !payload.campaign) {
        setError(errorMessages[payload.error || "service_unavailable"] || "E3lani rejected this campaign. Review the fields and try again.");
        return;
      }
      operations.retry();
      router.push(`/campaigns/${payload.campaign.campaign_id}`);
    } catch { setError(errorMessages.service_unavailable); }
    finally { setBusy(false); }
  }

  return <div className="page-stack campaigns-page" dir={ar ? "rtl" : "ltr"} lang={locale}>
    <PageHeading title={ar ? "الحملات" : "Campaigns"} description={ar ? "أنشئ موجزًا تجاريًا، ووجّه الوكلاء الأساسيين، وأبقِ كل تسليم واضحًا أمامك." : "Create a business brief, direct the core agents, and keep every handoff visible."} actions={canOperate ? <button className="primary-button" type="button" onClick={() => { setCreating(true); setError(null); }} aria-expanded={creating} aria-controls="campaign-creation"><Plus size={17} /> {ar ? "إنشاء حملة" : "Create campaign"}</button> : undefined} />
    {creating ? <div id="campaign-creation"><CampaignForm title={ar ? "إنشاء مسودة حملة" : "Create campaign draft"} description={ar ? "حدّد السياق التجاري الموثّق الذي سيستخدمه مخطّط الحملات. ستبدأ أعمال الوكلاء من صفحة تفاصيل الحملة." : "Define the verified business context the Campaign Strategist will use. You will start agent work from the campaign detail page."} submitLabel={ar ? "إنشاء مسودة حملة" : "Create campaign draft"} busy={busy} error={error} onSubmit={createCampaign} onClose={() => { if (!busy) setCreating(false); }} /></div> : null}
    {operations.status === "loading" ? <OperationsLoading label={ar ? "جارٍ تحميل الحملات" : "Loading campaigns"} /> : null}
    {operations.status === "error" ? <OperationsError retry={operations.retry} /> : null}
    {operations.status === "ready" && operations.data.campaigns.length === 0 ? <DomainEmpty title={ar ? "لا توجد حملات بعد" : "No campaigns yet"} description={canOperate ? (ar ? "أنشئ أول موجز حملة، ثم ابدأ الاستراتيجية من صفحة تفاصيله." : "Create the first campaign brief, then start Strategy from its detail page.") : (ar ? "يمكن للمالك أو المشغّل إنشاء أول موجز حملة." : "An owner or operator can create the first campaign brief.")} detail={ar ? "يبقى عمل الحملات داخلياً حتى يعتمد شخص كل مسودة." : "Campaign work remains internal until a human approves every draft."} action={<Link className="primary-button" href="/workspace">{ar ? "أنشئ أول موجز حملة" : "Create your first campaign brief"} <ArrowRight size={17} /></Link>} /> : null}
    {operations.status === "ready" && operations.data.campaigns.length > 0 ? <section className="campaign-portfolio" aria-label={ar ? "محفظة الحملات" : "Campaign portfolio"}>{operations.data.campaigns.map((campaign) => {
      const statusText = statusLabel(campaign.status, ar);
      const stageText = stage(campaign.status, campaign.core_job_type, campaign.core_job_status, ar);
      return <article className={`campaign-record campaign-record-${campaign.status}`} key={campaign.id}>
      <header><div><StatusPill tone={campaignTone(campaign.status)}>{statusText}</StatusPill><h2>{campaign.name}</h2>{stageText && stageText !== statusText ? <p>{stageText}</p> : null}</div></header>
      {campaign.blocked_reason ? <div className="campaign-blocked"><strong>{ar ? "الاستراتيجية تحتاج إلى مزيد من المعلومات" : "Strategy needs more information"}</strong><p>{campaign.blocked_reason}</p></div> : null}
      <dl><div><dt><FileCheck2 size={16} /> {ar ? "المحتوى" : "Content"}</dt><dd>{ar ? `الإجمالي: ${formatArabicCount(campaign.content_total, { zero: "لا عناصر", one: "عنصر واحد", two: "عنصران", few: "{count} عناصر", many: "{count} عنصرًا", other: "{count} عنصر" })} · بانتظار الاعتماد: ${formatArabicCount(campaign.content_pending, { zero: "لا عناصر", one: "عنصر واحد", two: "عنصران", few: "{count} عناصر", many: "{count} عنصرًا", other: "{count} عنصر" })}` : `${campaign.content_total} total · ${campaign.content_pending} waiting`}</dd></div><div><dt><CircleDollarSign size={16} /> {ar ? "هدف الإيرادات" : "Revenue target"}</dt><dd><bdi>{money(campaign.revenue_target, campaign.currency, ar)}</bdi></dd></div><div><dt><UsersRound size={16} /> {ar ? "العملاء المحتملون" : "Leads"}</dt><dd>{campaign.leads_total}</dd></div></dl>
      <Link className="secondary-button campaign-open-link" href={campaign.source === "ai_workspace" ? `/workspace?id=${campaign.id}` : `/campaigns/${campaign.id}`}>{campaign.source === "ai_workspace" ? (ar ? "فتح حزمة العمل" : "Open work pack") : (ar ? "فتح الحملة" : "Open campaign")} <ArrowRight size={17} /></Link>
    </article>; })}</section> : null}
  </div>;
}
