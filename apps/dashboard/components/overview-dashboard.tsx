"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { DomainEmpty, OperationsError, OperationsLoading } from "./operations-state";
import { useOperations, type OperationsCampaign } from "./operations-context";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";
import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import type { OnboardingProfile } from "@/lib/onboarding-types";
import { useLocale } from "@/lib/client/use-locale";

function campaignTone(status: string) {
  if (status === "blocked_missing_info") return "danger" as const;
  if (status === "paused" || status === "awaiting_approval") return "attention" as const;
  if (status === "active") return "success" as const;
  return "neutral" as const;
}

function campaignStage(campaign: OperationsCampaign) {
  return campaign.status.replaceAll("_", " ");
}

const quickStart = [
  {
    step: "1",
    stepAr: "١",
    title: "Brief AI Team",
    titleAr: "وجّه فريق الذكاء الاصطناعي",
    cta: "Open AI workspace",
    ctaAr: "افتح مساحة الذكاء الاصطناعي",
    href: "/workspace",
  },
  {
    step: "2",
    stepAr: "٢",
    title: "Design Visuals",
    titleAr: "صمّم الإعلانات البصرية",
    cta: "Open Design Studio",
    ctaAr: "افتح استوديو التصاميم",
    href: "/creative/designs",
  },
  {
    step: "3",
    stepAr: "٣",
    title: "Review & Approve",
    titleAr: "راجع واعتمد المحتوى",
    cta: "Review approvals",
    ctaAr: "راجع الاعتمادات",
    href: "/approvals",
  },
] as const;

type SetupProgress = {
  profileDone: boolean;
  brandDone: boolean;
  knowledgeDone: boolean;
  finished: boolean;
};

export function OverviewDashboard() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const operations = useOperations();
  const [setup, setSetup] = useState<SetupProgress | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      authenticatedFetch("/api/settings/onboarding", { cache: "no-store" }),
      authenticatedFetch("/api/creative/brand-kits", { cache: "no-store" }),
      authenticatedFetch("/api/admin/knowledge", { cache: "no-store" }),
    ])
      .then(async ([profileResponse, kitsResponse, knowledgeResponse]) => {
        if (!active) return;
        if (!profileResponse.ok || !kitsResponse.ok || !knowledgeResponse.ok) return;
        const [profile, kits, knowledge] = await Promise.all([
          profileResponse.json() as Promise<OnboardingProfile>,
          kitsResponse.json() as Promise<{ kits?: Array<{ kit_id: string }> }>,
          knowledgeResponse.json() as Promise<{ counts?: { sources?: number } }>,
        ]);
        if (!active) return;
        const profileDone = Boolean(
          profile.businessNameEn
          && profile.businessNameAr
          && profile.industry
          && profile.location,
        );
        setSetup({
          profileDone,
          brandDone: Boolean(kits.kits?.length),
          knowledgeDone: (knowledge.counts?.sources ?? 0) > 0,
          finished: Boolean(profile.completedAt),
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (operations.status === "loading") return <div className="page-stack"><PageHeading title={ar ? "نظرة عامة" : "Overview"} description={ar ? "جارٍ تحميل الحالة المعتمدة الحالية." : "Loading the current source-of-truth state."} /><OperationsLoading /></div>;
  if (operations.status === "error") return <div className="page-stack"><PageHeading title={ar ? "نظرة عامة" : "Overview"} description={ar ? "حالة المصدر المعتمد مطلوبة قبل تشغيل الوكلاء." : "Source-of-truth status is required before operating agents."} /><OperationsError retry={operations.retry} /></div>;

  const { data } = operations;
  const description = data.summary.campaigns_total
    ? (ar
      ? `${data.summary.campaigns_active} حملة نشطة، ${data.summary.jobs_open} مهمة مفتوحة، و${data.summary.approvals_pending} قرار بانتظارك.`
      : `${data.summary.campaigns_active} active campaigns, ${data.summary.jobs_open} open jobs, and ${data.summary.approvals_pending} decisions waiting.`)
    : (ar ? "لم تبدأ أي حملة أو مهمة وكيل بعد." : "No campaign or agent work has started yet.");
  const setupSteps = setup ? [
    { done: setup.profileDone, en: "Business profile", ar: "ملف النشاط التجاري" },
    { done: setup.brandDone, en: "Brand Kit", ar: "الهوية البصرية" },
    { done: setup.knowledgeDone, en: "Knowledge", ar: "المعرفة" },
    { done: setup.finished, en: "Finish setup", ar: "إكمال الإعداد" },
  ] : [];
  const nextStepIndex = setupSteps.findIndex((step) => !step.done);
  const nextStep = nextStepIndex >= 0 ? setupSteps[nextStepIndex] : null;
  const remainingCount = setupSteps.filter((step) => !step.done).length;

  return (
    <div className="page-stack">
      <PageHeading title={ar ? "نظرة عامة" : "Overview"} description={description} actions={<Link className="primary-button" href="/workspace">{ar ? "موجز حملة جديد" : "New campaign brief"}<ArrowRight size={16} /></Link>} />

      {nextStep ? <section className="setup-banner" aria-labelledby="setup-banner-title">
        <CircleAlert size={22} aria-hidden="true" />
        <div>
          <h2 id="setup-banner-title">{ar ? "أكمل إعداد مساحة عملك" : "Continue workspace setup"}</h2>
          <p className="setup-banner-next">
            <strong>{ar ? `الخطوة ${nextStepIndex + 1} من 4: ${nextStep.ar}` : `Step ${nextStepIndex + 1} of 4: ${nextStep.en}`}</strong>
            <span>{ar ? `${remainingCount} خطوات متبقية قبل أن يعمل فريقك بأكمل طاقته.` : `${remainingCount} ${remainingCount === 1 ? "step remains" : "steps remain"} before your workspace is fully ready.`}</span>
          </p>
        </div>
        <Link className="primary-button" href="/onboarding">{ar ? "أكمل الإعداد" : "Continue setup"}<ArrowRight size={16} /></Link>
      </section> : null}

      <section className="quick-start-strip" aria-label={ar ? "بداية سريعة" : "Quick start"}>
        {quickStart.map((entry) => (
          <Link key={entry.href} href={entry.href} className="quick-start-step">
            <span className="quick-start-number" aria-hidden="true">{ar ? entry.stepAr : entry.step}</span>
            <span className="quick-start-copy">
              <strong>{ar ? `${entry.stepAr}. ${entry.titleAr}` : `${entry.step}. ${entry.title}`}</strong>
              <span className="quick-start-cta">{ar ? entry.ctaAr : entry.cta} <ArrowRight size={14} aria-hidden="true" /></span>
            </span>
          </Link>
        ))}
      </section>

      <section className="attention-section" aria-labelledby="attention-title">
        <div className="section-heading">
          <div><div className="title-with-count"><h2 id="attention-title">{ar ? "بحاجة إلى انتباهك" : "Needs your attention"}</h2><span>{data.summary.approvals_pending}</span></div><p>{ar ? "قرارات بشرية تعيق أعمال النشر حالياً." : "Human decisions that currently block publishing work."}</p></div>
          <Link href="/approvals" className="text-link">{ar ? "فتح الاعتمادات" : "Open approvals"} <ArrowRight size={16} /></Link>
        </div>
        {data.summary.approvals_pending === 0 ? <div className="attention-clear"><CheckCircle2 size={20} /><div><strong>{ar ? "لا قرارات معلّقة" : "No decisions are waiting"}</strong><span>{ar ? "ستظهر المسودات الجديدة بعد بدء عمل الوكلاء في المرحلة الثالثة." : "New drafts will appear after Phase 3 agent work begins."}</span></div></div> : <div className="attention-clear"><div><strong>{ar ? `${data.summary.approvals_pending} قرار بانتظارك` : `${data.summary.approvals_pending} decisions are waiting`}</strong><span>{ar ? "افتح مساحة الاعتمادات لمراجعة المصدر والسياق." : "Open the approval workspace to review source content and context."}</span></div></div>}
      </section>

      <section className="handoff-section" aria-labelledby="handoff-title">
        <div className="section-heading compact-heading"><div><h2 id="handoff-title">{ar ? "تسليم الوكلاء" : "Agent handoff"}</h2><p>{ar ? "المهام الحالية من قائمة الوكلاء المعتمدة." : "Current jobs from the authoritative agent queue."}</p></div><Link href="/agents" className="text-link">{ar ? "عرض الوكلاء" : "View agents"} <ArrowRight size={16} /></Link></div>
        {data.agents.length ? <ol className="handoff-rail">{data.agents.map((agent, index) => <li key={agent.id}><div className="agent-identity"><span className="agent-avatar">{agent.code.slice(0, 2).toUpperCase()}</span><div><strong>{agent.name}</strong><StatusPill tone={agent.current_job_status === "running" ? "working" : "neutral"}>{agent.current_job_status || agent.status}</StatusPill></div></div><p>{agent.current_job_type ? agent.current_job_type.replaceAll("_", " ") : (ar ? "لا مهمة نشطة" : "No live job")}</p>{index < data.agents.length - 1 ? <ArrowRight className="handoff-arrow" size={18} aria-hidden="true" /> : null}</li>)}</ol> : <DomainEmpty title={ar ? "لا وكلاء مفعّلون" : "No agents are activated"} description={ar ? "أدوار الوكلاء محددة، لكن سير العمل يبدأ في المرحلة الثالثة." : "Agent roles are defined, but the live workflows begin in Phase 3."} detail={ar ? "لا تُعرض مهام مخفية أو محاكاة." : "No hidden or simulated jobs are shown."} />}
      </section>

      <section className="campaign-section" aria-labelledby="campaign-title">
        <div className="section-heading compact-heading"><div><h2 id="campaign-title">{ar ? "الحملات" : "Campaigns"}</h2><p>{ar ? "التقدم والمخاطر والمحتوى وإجمالي العملاء المحتملين." : "Live progress, risk, content, and lead totals."}</p></div><Link href="/campaigns" className="text-link">{ar ? "عرض الحملات" : "View campaigns"} <ArrowRight size={16} /></Link></div>
        {data.campaigns.length ? <div className="table-scroll" tabIndex={0} aria-label={ar ? "جدول الحملات، قابل للتمرير أفقياً على الشاشات الصغيرة" : "Campaign table, horizontally scrollable on small screens"}><table><thead><tr><th>{ar ? "الحملة" : "Campaign"}</th><th>{ar ? "الحالة" : "Status"}</th><th>{ar ? "المرحلة" : "Stage"}</th><th>{ar ? "المحتوى" : "Content"}</th><th>{ar ? "الاعتمادات" : "Approvals"}</th><th>{ar ? "العملاء المحتملون" : "Leads"}</th></tr></thead><tbody>{data.campaigns.map((campaign) => <tr key={campaign.id}><td><Link href="/campaigns">{campaign.name}</Link></td><td><StatusPill tone={campaignTone(campaign.status)}>{campaignStage(campaign)}</StatusPill></td><td>{campaignStage(campaign)}</td><td>{campaign.content_total}</td><td>{campaign.content_pending}</td><td>{campaign.leads_total}</td></tr>)}</tbody></table></div> : <DomainEmpty title={ar ? "لا حملات بعد" : "No campaigns yet"} description={ar ? "محفظة الحملات الحالية فارغة." : "The live campaign portfolio is empty."} detail={ar ? "موجز الحملة هو أول سجل تشغيلي." : "A campaign brief is the first operational record."} />}
      </section>

      <div className="overview-footer-grid">
        <section className="performance-section" aria-labelledby="performance-title">
          <div className="section-heading compact-heading"><div><h2 id="performance-title">{ar ? "الأداء المسجّل" : "Recorded performance"}</h2><p>{ar ? "إجماليات من سجلات النشر والعملاء المحتملين الفعلية." : "Totals from live published-post and lead records."}</p></div><Link href="/reports" className="text-link">{ar ? "التقرير الكامل" : "Full report"} <ArrowRight size={16} /></Link></div>
          <dl className="metric-line"><div><dt>{ar ? "الظهور" : "Impressions"}</dt><dd>{Number(data.performance.impressions).toLocaleString()}</dd><span>{ar ? "مسجّل" : "Recorded"}</span></div><div><dt>{ar ? "النقرات" : "Clicks"}</dt><dd>{Number(data.performance.clicks).toLocaleString()}</dd><span>{ar ? "مسجّل" : "Recorded"}</span></div><div><dt>{ar ? "الإنفاق" : "Spend"}</dt><dd>${Number(data.performance.spend).toLocaleString()}</dd><span>{ar ? "مسجّل" : "Recorded"}</span></div><div><dt>{ar ? "العملاء المحتملون" : "Leads"}</dt><dd>{data.summary.leads_total}</dd><span>{data.summary.leads_won} {ar ? "فوز" : "won"}</span></div></dl>
        </section>
        <section className="alerts-section" aria-labelledby="alerts-title">
          <div className="section-heading compact-heading"><div><h2 id="alerts-title">{ar ? "التنبيهات" : "Alerts"}</h2><p>{ar ? `${data.summary.notifications_unread} إشعار تشغيلي غير مقروء.` : `${data.summary.notifications_unread} unread operational notifications.`}</p></div></div>
          {data.notifications.length ? <ul className="alert-list">{data.notifications.slice(0, 5).map((notification) => <li key={notification.id}><div><strong>{notification.title}</strong><span>{notification.body}</span></div><time>{new Date(notification.created_at).toLocaleDateString()}</time></li>)}</ul> : <DomainEmpty title={ar ? "لا تنبيهات نشطة" : "No active alerts"} description={ar ? "لا يوجد إشعار تشغيلي غير مقروء يحتاج انتباهك." : "No unread operational notification requires attention."} />}
        </section>
      </div>
    </div>
  );
}
