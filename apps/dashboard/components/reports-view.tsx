"use client";

import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, ShieldAlert } from "lucide-react";

import { useLocale } from "@/lib/client/use-locale";
import { useOperations, type OperationsSnapshot } from "./operations-context";
import { DomainEmpty, OperationsError, OperationsLoading } from "./operations-state";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

function number(value: string | number) { return new Intl.NumberFormat("en-US").format(Number(value)); }

function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }

export function ReportsView() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const operations = useOperations();
  return <div className="page-stack">
    <PageHeading title={ar ? "التقارير" : "Reports"} description={ar ? "تابع كيف يتحول عمل الحملات إلى انتباه وعملاء محتملين وإيرادات." : "Understand how campaign work becomes attention, leads, and revenue."} actions={<button className="secondary-button" type="button" disabled title={ar ? "تصدير التقارير غير متاح بعد" : "Report export is not available yet"}>{ar ? "تصدير التقرير" : "Export report"}</button>} />
    {operations.status === "loading" ? <OperationsLoading label={ar ? "جارٍ تحميل التقارير" : "Loading reports"} /> : null}
    {operations.status === "error" ? <OperationsError retry={operations.retry} /> : null}
    {operations.status === "ready" ? <ReportContent data={operations.data} /> : null}
  </div>;
}

function ReportContent({ data }: { data: OperationsSnapshot }) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const text = (en: string, arabic: string) => (ar ? arabic : en);
  const date = (value: string | null) => {
    if (!value) return text("Not synchronized", "لم تتم المزامنة");
    return new Intl.DateTimeFormat(ar ? "ar-JO" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  };
  const statusLabel = (value: string) => ar
    ? ({ succeeded: "ناجح", failed: "فشل", stale: "متأخر", queued: "قيد الانتظار", running: "قيد التشغيل", published: "منشور", draft: "مسودة" } as Record<string, string>)[value] || value
    : label(value);
  const engagement = Number(data.performance.likes) + Number(data.performance.comments) + Number(data.performance.shares);
  const hasMetrics = data.post_performance.some((post) => Object.keys(post.metrics).length > 0);
  return <>
    <section className={`report-freshness ${data.performance.stale_posts > 0 ? "is-warning" : ""}`} aria-label={text("Performance data status", "حالة بيانات الأداء")}>
      <span className="report-freshness-icon" aria-hidden="true">{data.performance.stale_posts > 0 ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}</span>
      <div><strong>{data.performance.stale_posts > 0 ? text("Some performance data needs attention", "بعض بيانات الأداء تحتاج إلى انتباه") : hasMetrics ? text("Performance data is current", "بيانات الأداء محدثة") : text("Monitoring is prepared", "المراقبة جاهزة")}</strong><p>{hasMetrics ? text(`Last successful synchronization: ${date(data.performance.last_synced_at)}.`, `آخر مزامنة ناجحة: ${date(data.performance.last_synced_at)}.`) : text("The inactive monitor is ready for a published social post. No provider schedule is active.", "المراقب غير المفعّل جاهز لمنشور اجتماعي منشور. لا يوجد جدول مزود نشط.")}</p></div>
      {data.performance.stale_posts > 0 ? <StatusPill tone="attention">{ar ? `${data.performance.stale_posts} متأخر` : `${data.performance.stale_posts} stale`}</StatusPill> : null}
    </section>

    <dl className="report-metrics">
      <div><dt>{text("Impressions", "مرات الظهور")}</dt><dd>{number(data.performance.impressions)}</dd><span>{text("Latest provider totals", "أحدث إجماليات المزود")}</span></div>
      <div><dt>{text("Engagements", "التفاعلات")}</dt><dd>{number(engagement)}</dd><span>{text(`${number(data.performance.likes)} likes · ${number(data.performance.comments)} comments`, `${number(data.performance.likes)} إعجاب · ${number(data.performance.comments)} تعليق`)}</span></div>
      <div><dt>{text("Clicks", "النقرات")}</dt><dd>{number(data.performance.clicks)}</dd><span>{text(`${number(data.performance.shares)} shares`, `${number(data.performance.shares)} مشاركة`)}</span></div>
      <div><dt>{text("Leads", "العملاء المحتملون")}</dt><dd>{number(data.summary.leads_total)}</dd><span>{data.performance.quarantined_leads > 0 ? text(`${data.performance.quarantined_leads} need attribution`, `${data.performance.quarantined_leads} بحاجة إلى إسناد`) : text(`${data.summary.leads_won} won`, `${data.summary.leads_won} فوز`)}</span></div>
    </dl>

    {data.campaign_performance.length === 0 ? <DomainEmpty title={text("No campaign performance to report", "لا يوجد أداء حملات للإبلاغ عنه")} description={text("Reporting will begin after a published social post completes its first controlled synchronization.", "يبدأ الإبلاغ بعد أن يكمل منشور اجتماعي منشور أول مزامنة خاضعة للرقابة.")} detail={text("No historical fixtures included", "لا تتضمن بيانات تاريخية")} /> : <section className="data-section" aria-labelledby="campaign-performance-title">
      <div className="section-heading compact-heading"><div><h2 id="campaign-performance-title">{text("Campaign performance", "أداء الحملات")}</h2><p>{text("Latest normalized provider totals, grouped without crossing workspace boundaries.", "أحدث إجماليات المزود الموحّدة، مجمّعة دون تجاوز حدود مساحة العمل.")}</p></div></div>
      <div className="table-scroll" tabIndex={0}><table><thead><tr><th>{text("Campaign", "الحملة")}</th><th>{text("Posts", "المنشورات")}</th><th>{text("Impressions", "مرات الظهور")}</th><th>{text("Engagements", "التفاعلات")}</th><th>{text("Clicks", "النقرات")}</th><th>{text("Freshness", "الحداثة")}</th></tr></thead><tbody>{data.campaign_performance.map((campaign) => <tr key={campaign.campaign_id}><td><strong>{campaign.campaign_name}</strong></td><td>{number(campaign.posts)}</td><td>{number(campaign.impressions)}</td><td>{number(Number(campaign.likes) + Number(campaign.comments) + Number(campaign.shares))}</td><td>{number(campaign.clicks)}</td><td>{campaign.stale_posts > 0 ? <StatusPill tone="attention">{ar ? `${campaign.stale_posts} متأخر` : `${campaign.stale_posts} stale`}</StatusPill> : <span className="cell-detail"><Clock3 size={15} /> {date(campaign.last_synced_at)}</span>}</td></tr>)}</tbody></table></div>
    </section>}

    <section className="data-section" aria-labelledby="post-performance-title">
      <div className="section-heading compact-heading"><div><h2 id="post-performance-title">{text("Post evidence", "أدلة المنشورات")}</h2><p>{text("Each row links provider state, source content, synchronization health, and recorded metrics.", "يربط كل صف حالة المزود ومحتوى المصدر وصحة المزامنة والقياسات المسجلة.")}</p></div></div>
      {data.post_performance.length === 0 ? <div className="inline-empty"><ExternalLink size={18} /><div><strong>{text("No published social records yet", "لا توجد سجلات نشر اجتماعي منشورة بعد")}</strong><p>{text("Approved drafts remain in the Content Library. Performance appears here only after a draft is published and synchronized.", "تبقى المسودات المعتمدة في مكتبة المحتوى. يظهر الأداء هنا فقط بعد نشر المسودة ومزامنتها.")}</p></div></div> : <div className="table-scroll" tabIndex={0}><table><thead><tr><th>{text("Source", "المصدر")}</th><th>{text("Channel", "القناة")}</th><th>{text("Status", "الحالة")}</th><th>{text("Impressions", "مرات الظهور")}</th><th>{text("Engagements", "التفاعلات")}</th><th>{text("Last sync", "آخر مزامنة")}</th></tr></thead><tbody>{data.post_performance.map((post) => <tr key={post.id}><td><strong>{post.campaign_name}</strong><span className="table-subline">{post.content_excerpt}</span></td><td>{label(post.channel)}</td><td><StatusPill tone={post.last_error_code ? "danger" : post.is_stale ? "attention" : post.sync_status === "succeeded" ? "success" : "neutral"}>{post.last_error_code ? text("Failed", "فشل") : post.is_stale ? text("Stale", "متأخر") : statusLabel(post.sync_status || post.status)}</StatusPill></td><td>{number(post.metrics.impressions || 0)}</td><td>{number(Number(post.metrics.likes || 0) + Number(post.metrics.comments || 0) + Number(post.metrics.shares || 0))}</td><td>{date(post.last_success_at)}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="data-section" aria-labelledby="attribution-title">
      <div className="section-heading compact-heading"><div><h2 id="attribution-title">{text("Attribution review", "مراجعة الإسناد")}</h2><p>{text("Provider events that cannot prove campaign and source-post ownership stop here instead of silently creating leads.", "تتوقف هنا أحداث المزود التي لا يمكنها إثبات ملكية الحملة والمنشور المصدر بدلاً من إنشاء عملاء محتملين بصمت.")}</p></div></div>
      {data.attribution_quarantine.length === 0 ? <div className="inline-empty is-positive"><CheckCircle2 size={18} /><div><strong>{text("No leads awaiting attribution", "لا يوجد عملاء محتملون بانتظار الإسناد")}</strong><p>{text("Imported leads must carry an organization, campaign, and source post or fail closed into this review queue.", "يجب أن يحمل كل عميل محتمل مستورد مؤسسة وحملة ومنشوراً مصدراً وإلا يدخل قائمة المراجعة هذه.")}</p></div></div> : <div className="attribution-list">{data.attribution_quarantine.map((record) => <article key={record.id}><ShieldAlert size={18} /><div><strong>{record.quarantine_reason}</strong><p><bdi>{label(record.provider)}</bdi> <span dir="ltr">{record.provider_event_id}</span> · {date(record.received_at)}</p></div><StatusPill tone="attention">{text("Review", "مراجعة")}</StatusPill></article>)}</div>}
    </section>
  </>;
}