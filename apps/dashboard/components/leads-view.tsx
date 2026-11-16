"use client";

import { RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Tone } from "@/data/fixtures";
import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { useLocale } from "@/lib/client/use-locale";
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
    ? ({ new: "جديد", contacted: "تم التواصل", qualified: "مؤهل", proposal: "عرض", negotiation: "تفاوض", won: "فوز", lost: "خسارة" } as Record<string, string>)[value] || value
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
      setFeedback(text("Contact synchronization queued for the protected inactive workflow.", "تمت جدولة مزامنة جهة الاتصال لسير العمل المحمي غير المفعّل."));
      operations.retry();
    } catch (error) {
      const code = error instanceof Error ? error.message : "ghl_contact_sync_failed";
      setFeedback(code === "ghl_contact_handoff_not_enabled"
        ? text("GHL synchronization is installed but still locked by the platform activation gate.", "مزامنة GHL مثبتة لكنها ما زالت مقفلة بواسطة بوابة تفعيل المنصة.")
        : code === "ghl_contact_sync_not_ready"
          ? text("Connect and verify GoHighLevel before synchronizing this lead.", "اربط GoHighLevel وتحقق منه قبل مزامنة هذا العميل المحتمل.")
          : text("Tanaghom could not queue this CRM contact.", "تعذر على تناغم جدولة جهة الاتصال هذه في نظام إدارة العملاء."));
    } finally {
      setSyncing(null);
    }
  }

  return <div className="page-stack" dir={ar ? "rtl" : "ltr"} lang={locale}>
    <PageHeading title={text("Leads", "العملاء المحتملون")} description={text("Follow every lead from its source campaign through the sales journey.", "تابع كل عميل محتمل من حملته المصدر عبر رحلة المبيعات.")} />
    {operations.status === "ready" && operations.data.leads.length > 0
      ? <div className="toolbar"><label className="search-field"><Search size={17} /><span className="sr-only">{text("Search leads", "البحث في العملاء المحتملين")}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text("Search by name, contact, or campaign", "ابحث بالاسم أو جهة الاتصال أو الحملة")} /></label></div>
      : null}
    {operations.status === "loading" ? <OperationsLoading label={text("Loading leads", "جارٍ تحميل العملاء المحتملين")} /> : null}
    {operations.status === "error" ? <OperationsError retry={operations.retry} /> : null}
    {operations.status === "ready" && operations.data.leads.length === 0
      ? <DomainEmpty title={text("No leads yet", "لا يوجد عملاء محتملون بعد")} description={text("This table reads directly from the live lead pipeline. Records will appear after campaigns begin collecting responses.", "يقرأ هذا الجدول مباشرة من مسار العملاء المحتملين المباشر. ستظهر السجلات بعد أن تبدأ الحملات في جمع الردود.")} detail={text("0 live records", "0 سجل مباشر")} />
      : null}
    {operations.status === "ready" && operations.data.leads.length > 0
      ? <section className="data-section" aria-label={text("Lead pipeline", "مسار العملاء المحتملين")}>
        <div className="table-scroll" tabIndex={0}>
          <table>
            <thead><tr><th>{text("Lead", "العميل المحتمل")}</th><th>{text("Campaign", "الحملة")}</th><th>{text("Status", "الحالة")}</th><th>{text("Temperature", "درجة الاهتمام")}</th><th>{text("CRM", "نظام العملاء")}</th><th>{text("Last activity", "آخر نشاط")}</th></tr></thead>
            <tbody>{leads.map((lead) => <tr key={lead.id}>
              <td><strong>{lead.name ?? lead.contact_email ?? lead.contact_phone ?? text("Unnamed lead", "عميل محتمل بلا اسم")}</strong></td>
              <td><bdi>{lead.campaign_name}</bdi></td>
              <td><StatusPill tone={tone(lead.status)}>{statusName(lead.status)}</StatusPill></td>
              <td>{ar ? ({ hot: "ساخن", warm: "دافئ", cold: "بارد" } as Record<string, string>)[lead.temperature] || lead.temperature : label(lead.temperature)}</td>
              <td>{lead.ghl_contact_id
                ? <StatusPill tone="success">{text("Synced", "متزامن")}</StatusPill>
                : lead.ghl_sync_status === "queued" || lead.ghl_sync_status === "running"
                  ? <StatusPill tone="working">{statusName(lead.ghl_sync_status)}</StatusPill>
                  : <button className="ghost-button compact-button" type="button" disabled={syncing === lead.id} onClick={() => void syncContact(lead.id)}><RefreshCw size={14} />{syncing === lead.id ? text("Queueing...", "جارٍ الجدولة...") : text("Sync to GHL", "مزامنة إلى GHL")}</button>}</td>
              <td>{new Intl.DateTimeFormat(ar ? "ar-JO" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lead.last_touch_at ?? lead.created_at))}</td>
            </tr>)}</tbody>
          </table>
          {leads.length === 0 ? <div className="table-empty">{text(`No leads match "${query}".`, `لا يوجد عملاء محتملون يطابقون "${query}".`)}</div> : null}
        </div>
        {feedback ? <p className="integration-feedback" role="status">{feedback}</p> : null}
      </section>
      : null}
  </div>;
}