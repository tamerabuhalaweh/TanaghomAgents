"use client";

import { RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Tone } from "@/data/fixtures";
import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { useLocale } from "@/lib/client/use-locale";
import { formatDateTime } from "@/lib/i18n/format";
import { useOperations } from "./operations-context";
import { DomainEmpty, OperationsError, OperationsLoading } from "./operations-state";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

function tone(status: string): Tone {
  if (status === "won" || status === "qualified") return "success";
  if (status === "lost") return "danger";
  if (status === "new") return "attention";
  return "working";
}
function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function LeadsView() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const operations = useOperations();
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const text = (en: string, arabic: string) => (ar ? arabic : en);
  const statusName = (value: string) => ar
    ? ({ new: "جديد", contacted: "تم التواصل", qualified: "مؤهل", proposal: "مقترح", negotiation: "تفاوض", won: "مكتسب", lost: "خاسر" } as Record<string, string>)[value] || value
    : label(value);
  const leads = useMemo(() => operations.status === "ready"
    ? operations.data.leads.filter((lead) =>
      [lead.name, lead.contact_email, lead.contact_phone, lead.campaign_name]
        .some((value) => value?.toLowerCase().includes(query.toLowerCase())))
    : [], [operations, query]);

  async function syncContact(leadId: string) {
    setSyncing(leadId);
    setFeedback("");
    try {
      const response = await authenticatedFetch(`/api/leads/${leadId}/ghl-contact`, {
        method: "POST",
        headers: { "Idempotency-Key": `ghl-contact-${leadId}-${crypto.randomUUID()}` },
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "ghl_contact_sync_failed");
      setFeedback(text("Contact synchronization queued for the protected inactive workflow.", "تمت إضافة مزامنة جهة الاتصال إلى قائمة انتظار سير العمل المحمي وغير المفعّل."));
      operations.retry();
    } catch (error) {
      const code = error instanceof Error ? error.message : "ghl_contact_sync_failed";
      setFeedback(code === "ghl_contact_handoff_not_enabled"
        ? text("GHL synchronization is installed but still locked by the platform activation gate.", "تم تثبيت مزامنة GHL، لكنها لا تزال معطّلة إلى حين تفعيل المنصة.")
        : code === "ghl_contact_sync_not_ready"
          ? text("Connect and verify GoHighLevel before synchronizing this lead.", "اربط GoHighLevel وتحقق منه قبل مزامنة هذا العميل المحتمل.")
          : text("E3lani could not queue this CRM contact.", "تعذر على إعلاني جدولة جهة الاتصال هذه في نظام إدارة العملاء."));
    } finally {
      setSyncing(null);
    }
  }

  return <div className="page-stack" dir={ar ? "rtl" : "ltr"} lang={locale}>
    <PageHeading title={text("Leads", "العملاء المحتملون")} description={text("Follow every lead from its source campaign through the sales journey.", "تابع كل عميل محتمل من حملته المصدرية حتى نهاية رحلة المبيعات.")} />
    {operations.status === "ready" && operations.data.leads.length > 0
      ? <div className="toolbar"><label className="search-field"><Search size={17} /><span className="sr-only">{text("Search leads", "البحث في العملاء المحتملين")}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text("ابحث عن…", "ابحث عن…")} /></label></div>
      : null}
    {operations.status === "loading" ? <OperationsLoading label={text("Loading leads", "جارٍ تحميل العملاء المحتملين")} /> : null}
    {operations.status === "error" ? <OperationsError retry={operations.retry} /> : null}
    {operations.status === "ready" && operations.data.leads.length === 0
      ? <DomainEmpty title={text("No leads yet", "لا يوجد عملاء محتملون بعد")} description={text("This table reads directly from the live lead pipeline. Records will appear after campaigns begin collecting responses.", "يعرض هذا الجدول بيانات مسار العملاء المحتملين مباشرةً. ستظهر السجلات بعد أن تبدأ الحملات في جمع الردود.")} detail={text("0 live records", "0 سجل مباشر")} />
      : null}
    {operations.status === "ready" && operations.data.leads.length > 0
      ? <section className="data-section" aria-label={text("Lead pipeline", "مسار العملاء المحتملين")}>
        <div className="table-scroll" tabIndex={0}>
          <table>
            <thead><tr><th>{text("Lead", "العميل المحتمل")}</th><th>{text("Campaign", "الحملة")}</th><th>{text("Status", "الحالة")}</th><th>{text("Temperature", "درجة اهتمام العميل المحتمل")}</th><th>{text("CRM", "إدارة علاقات العملاء (CRM)")}</th><th>{text("Last activity", "آخر نشاط")}</th></tr></thead>
            <tbody>{leads.map((lead) => <tr key={lead.id}>
              <td><strong>{lead.name ?? lead.contact_email ?? lead.contact_phone ?? text("Unnamed lead", "عميل محتمل بلا اسم")}</strong></td>
              <td><bdi>{lead.campaign_name}</bdi></td>
              <td><StatusPill tone={tone(lead.status)}>{statusName(lead.status)}</StatusPill></td>
              <td>{ar ? ({ hot: "ساخن", warm: "دافئ", cold: "بارد" } as Record<string, string>)[lead.temperature] || lead.temperature : label(lead.temperature)}</td>
              <td>{lead.ghl_contact_id
                ? <StatusPill tone="success">{text("Synced", "تمت المزامنة")}</StatusPill>
                : lead.ghl_sync_status === "queued" || lead.ghl_sync_status === "running"
                  ? <StatusPill tone="working">{statusName(lead.ghl_sync_status)}</StatusPill>
                  : <button className="ghost-button compact-button" type="button" disabled={syncing === lead.id} onClick={() => void syncContact(lead.id)}><RefreshCw size={14} />{syncing === lead.id ? text("Queueing...", "جارٍ إضافة المهمة إلى قائمة الانتظار…") : text("Sync to GHL", "مزامنة مع GHL")}</button>}</td>
              <td>{formatDateTime(lead.last_touch_at ?? lead.created_at, locale)}</td>
            </tr>)}</tbody>
          </table>
          {leads.length === 0 ? <div className="table-empty">{text(`No leads match "${query}".`, `لا يوجد عملاء محتملون يطابقون "${query}".`)}</div> : null}
        </div>
        {feedback ? <p className="integration-feedback" role="status">{feedback}</p> : null}
      </section>
      : null}
  </div>;
}