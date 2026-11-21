"use client";

import { Clock3, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { useLocale } from "@/lib/client/use-locale";
import { formatDateTime } from "@/lib/i18n/format";

interface AuditAction {
  id: string;
  action_type: string;
  result: string;
  created_at: string;
  agent_name: string | null;
  actor_name: string | null;
}

const HIDDEN_AUDIT_PATTERNS = [
  /^billing\.webhook\b/i,
  /^platform\./i,
  /webhook/i,
  /postiz_workspace_provisioned/i,
  /^creative\.job_(claimed|running)$/i,
];

const AUDIT_LABELS: Record<string, { en: string; ar: string }> = {
  "auth.signup": { en: "Workspace account created", ar: "تم إنشاء حساب مساحة العمل" },
  "auth.login": { en: "Signed in to workspace", ar: "تسجيل الدخول إلى مساحة العمل" },
  "creative.upload_registered": { en: "Source image uploaded", ar: "تم رفع صورة مصدر" },
  "creative.asset_version_created": { en: "Creative image generated", ar: "تم توليد صورة إبداعية" },
  "creative.asset_reviewed": { en: "Creative asset reviewed", ar: "تمت مراجعة الأصل الإبداعي" },
  "creative.brand_kit_created": { en: "Brand Kit created", ar: "تم إنشاء الهوية البصرية" },
  "creative.brand_kit_created_api": { en: "Brand Kit created", ar: "تم إنشاء الهوية البصرية" },
  "creative.brand_kit_version_created": { en: "Brand Kit updated", ar: "تم تحديث الهوية البصرية" },
  "creative.brand_kit_version_created_api": { en: "Brand Kit updated", ar: "تم تحديث الهوية البصرية" },
  "creative.design_created": { en: "Design created", ar: "تم إنشاء التصميم" },
  "creative.design_created_api": { en: "Design created", ar: "تم إنشاء التصميم" },
  "creative.design_version_created": { en: "Design updated", ar: "تم تحديث التصميم" },
  "creative.design_version_created_api": { en: "Design updated", ar: "تم تحديث التصميم" },
  "creative.template_version_created": { en: "Creative template saved", ar: "تم حفظ قالب إبداعي" },
  "creative.template_version_created_api": { en: "Creative template saved", ar: "تم حفظ قالب إبداعي" },
  "creative.motion_created": { en: "Motion project created", ar: "تم إنشاء مشروع حركة" },
  "creative.motion_created_api": { en: "Motion project created", ar: "تم إنشاء مشروع حركة" },
  "creative.job_succeeded": { en: "Creative job completed", ar: "اكتملت مهمة التصميم" },
  "creative.job_failed": { en: "Creative job needs attention", ar: "مهمة التصميم تحتاج إلى انتباه" },
  "integration.connection_tested": { en: "Integration connection tested", ar: "تم اختبار اتصال التكامل" },
  "integration.credential_saved": { en: "Integration settings updated", ar: "تم تحديث إعدادات التكامل" },
  "integration.channel_connected": { en: "Social channel connected", ar: "تم ربط قناة تواصل" },
  "integration.channel_disconnected": { en: "Social channel disconnected", ar: "تم فصل قناة التواصل" },
  "integration.channel_revoked": { en: "Social channel access revoked", ar: "تم إلغاء ربط قناة التواصل" },
  "knowledge.draft_created": { en: "Knowledge draft saved", ar: "تم حفظ مسودة معرفة" },
  "knowledge.version_activated": { en: "Knowledge published to specialists", ar: "تم اعتماد المعرفة للفريق" },
  "workspace.brief_configured": { en: "Campaign work pack started", ar: "تم بدء حزمة عمل الحملة" },
  "workspace.inference_succeeded": { en: "Specialist deliverable completed", ar: "اكتمل مخرج المختص" },
  "workspace.inference_failed": { en: "Specialist deliverable needs retry", ar: "يحتاج مخرج المختص إلى إعادة المحاولة" },
  "workspace.pack_approved": { en: "Campaign work pack approved", ar: "تم اعتماد حزمة عمل الحملة" },
  "workspace.pack_rejected": { en: "Changes requested on work pack", ar: "طُلب تعديل حزمة العمل" },
  "workspace.pack_cancelled": { en: "Remaining workspace tasks cancelled", ar: "تم إلغاء المهام المتبقية" },
  "content.approved": { en: "Content item approved", ar: "تم اعتماد عنصر المحتوى" },
  "content.rejected": { en: "Changes requested on content item", ar: "طُلب تعديل عنصر المحتوى" },
  "campaign.created": { en: "Campaign created", ar: "تم إنشاء الحملة" },
  "campaign.updated": { en: "Campaign updated", ar: "تم تحديث الحملة" },
  "ghl_action.approved": { en: "CRM action approved", ar: "تم اعتماد إجراء إدارة العملاء" },
  "ghl_action.rejected": { en: "CRM action rejected", ar: "تم رفض إجراء إدارة العملاء" },
  "ghl_action.reconciled": { en: "CRM action outcome verified", ar: "تم تأكيد نتيجة إجراء إدارة العملاء" },
  "notification.preferences_updated": { en: "Notification preferences updated", ar: "تم تحديث إعدادات الإشعارات" },
  "team.member_invited": { en: "Teammate invited", ar: "تمت دعوة عضو فريق" },
  "team.member_updated": { en: "Teammate permissions updated", ar: "تم تحديث صلاحيات عضو الفريق" },
};

/** Hides internal webhook, platform-ops, and queue-state events from customer activity history. */
export function isCustomerAuditAction(actionType: string): boolean {
  return !HIDDEN_AUDIT_PATTERNS.some((pattern) => pattern.test(actionType));
}

/** Converts raw backend audit action codes into plain customer-friendly labels. */
export function formatAuditActionLabel(actionType: string, locale: "en" | "ar" = "en"): string {
  const mapped = AUDIT_LABELS[actionType];
  if (mapped) return locale === "ar" ? mapped.ar : mapped.en;
  if (locale === "ar") {
    if (actionType.startsWith("creative.")) return "تحديث في استوديو الإبداع";
    if (actionType.startsWith("workspace.")) return "تحديث في مساحة العمل";
    if (actionType.startsWith("integration.")) return "تحديث في القنوات والتكاملات";
    if (actionType.startsWith("knowledge.")) return "تحديث في قاعدة المعرفة";
    return "نشاط مسجّل في مساحة العمل";
  }
  const cleaned = actionType
    .replace(/_api$/i, "")
    .replace(/\bpostiz\b/gi, "social publishing")
    .replace(/\bgohighlevel\b|\bghl\b/gi, "CRM")
    .replaceAll(/[._]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned ? `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}` : "Workspace activity";
}

export function LiveActivity() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [actions, setActions] = useState<AuditAction[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await authenticatedFetch("/api/audit?limit=20", { cache: "no-store" });
      if (response.status === 401) return;
      if (!response.ok) throw new Error("audit request failed");
      const payload = await response.json() as { actions: AuditAction[] };
      setActions(payload.actions);
      setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") {
    return (
      <ol className="activity-list activity-loading" aria-label={ar ? "جارٍ تحميل النشاط الأخير" : "Loading recent activity"} aria-busy="true">
        <li><span className="state-skeleton" /></li>
        <li><span className="state-skeleton" /></li>
      </ol>
    );
  }
  if (state === "error") {
    return (
      <div className="activity-state">
        <p>{ar ? "سجل النشاط غير متاح مؤقتًا." : "Audit activity is temporarily unavailable."}</p>
        <button className="text-button" type="button" onClick={() => void load()}><RefreshCw size={15} /> {ar ? "حاول مرة أخرى" : "Try again"}</button>
      </div>
    );
  }

  const visibleActions = actions.filter((action) => isCustomerAuditAction(action.action_type));
  if (!visibleActions.length) {
    return (
      <div className="activity-state">
        <p>{ar ? "لم يُسجَّل أي نشاط بعد." : "No audited action has been recorded yet."}</p>
        <span>{ar ? "ستظهر إجراءات الفريق والوكلاء هنا مع التوقيت والمصدر." : "Agent and human actions will appear here with their correlation evidence."}</span>
      </div>
    );
  }

  return (
    <ol className="activity-list" dir={ar ? "rtl" : "ltr"} lang={locale}>
      {visibleActions.map((action) => (
        <li key={action.id}>
          <span className="activity-marker" />
          <div>
            <strong>{action.agent_name || action.actor_name || (ar ? "إعلاني" : "E3lani")}</strong>
            <p>{formatAuditActionLabel(action.action_type, locale)}</p>
          </div>
          <time dateTime={action.created_at}><Clock3 size={14} />{formatDateTime(action.created_at, locale)}</time>
        </li>
      ))}
    </ol>
  );
}
