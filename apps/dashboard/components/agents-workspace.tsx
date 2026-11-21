"use client";

import {
  Activity, AlertTriangle, Bot, CheckCircle2,
  PackageCheck, PauseCircle, ShieldAlert, Workflow,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type {
  AgentRegistryBlocker, AgentRegistryJob, AgentRegistryRole, AgentRegistryWorker,
} from "@/components/operations-context";
import { useOperations } from "@/components/operations-context";
import { OperationsError, OperationsLoading } from "@/components/operations-state";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import type { Tone } from "@/data/fixtures";
import { useLocale } from "@/lib/client/use-locale";
import { formatDateTime } from "@/lib/i18n/format";

const roleState: Record<AgentRegistryRole["operational_state"], { en: string; ar: string; tone: Tone }> = {
  working: { en: "Working", ar: "قيد العمل", tone: "working" },
  waiting_approval: { en: "Waiting for approval", ar: "بانتظار الاعتماد", tone: "attention" },
  blocked: { en: "Needs review", ar: "يحتاج مراجعة", tone: "danger" },
  ready: { en: "Ready", ar: "جاهز", tone: "success" },
  inactive: { en: "Manual review mode", ar: "وضع المراجعة اليدوية", tone: "neutral" },
};

interface BlockerCopyEntry {
  title: string;
  detail: string;
  nextAction: string;
}

const PLATFORM_SETUP_BLOCKER: Record<"en" | "ar", BlockerCopyEntry> = {
  en: {
    title: "Workspace automation setup in progress",
    detail: "Automated publishing and background sync are currently managed by the platform team.",
    nextAction: "Nothing for you to do — your campaigns and drafts continue working normally with human approval.",
  },
  ar: {
    title: "تهيئة أتمتة مساحة العمل قيد الإعداد",
    detail: "يتولى فريق المنصة حاليًا تهيئة التشغيل التلقائي والربط الخلفي.",
    nextAction: "لا يلزم أي إجراء منك — تستمر حملاتك ومسوداتك بالعمل كالمعتاد تحت اعتمادك البشري.",
  },
};

const BLOCKER_COPY: Record<string, { en: BlockerCopyEntry; ar: BlockerCopyEntry }> = {
  workflow_not_imported: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  workflow_inactive: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  polling_disabled: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  activation_enables_polling: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  role_runtime_missing: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  runtime_not_enabled: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  credential_vault_not_ready: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  worker_authentication_not_ready: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  gateway_not_ready: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  postiz_emergency_stop: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  ghl_platform_emergency_stop: { en: PLATFORM_SETUP_BLOCKER.en, ar: PLATFORM_SETUP_BLOCKER.ar },
  content_job_reconciliation_required: {
    en: {
      title: "Draft status needs confirmation",
      detail: "A previous content task finished without updating its approval status.",
      nextAction: "Open the campaign to confirm whether the draft is ready for review.",
    },
    ar: {
      title: "حالة المسودة تحتاج إلى تأكيد",
      detail: "اكتملت مهمة محتوى سابقة دون تحديث حالة الاعتماد الخاصة بها.",
      nextAction: "افتح الحملة للتأكد من جاهزية المسودة للمراجعة.",
    },
  },
  postiz_connection_not_ready: {
    en: {
      title: "Social channels not connected yet",
      detail: "No verified social publishing account is connected to this workspace.",
      nextAction: "Connect a social account in Social channels when you are ready to prepare publishing drafts.",
    },
    ar: {
      title: "قنوات التواصل غير متصلة بعد",
      detail: "لا يوجد حساب نشر اجتماعي موثّق مرتبط بمساحة العمل هذه.",
      nextAction: "اربط حساب تواصل من صفحة قنوات التواصل عندما تكون جاهزًا لإعداد مسودات النشر.",
    },
  },
  postiz_channel_mapping_not_ready: {
    en: {
      title: "Social channel mapping needed",
      detail: "Your approved content needs a connected social profile before drafts can be sent.",
      nextAction: "Open Social channels in Settings and verify at least one social account.",
    },
    ar: {
      title: "يلزم ربط قناة النشر الاجتماعي",
      detail: "يحتاج المحتوى المعتمد إلى حساب تواصل متصل قبل إرسال المسودات إليه.",
      nextAction: "افتح قنوات التواصل في الإعدادات وتأكد من ربط حساب واحد على الأقل.",
    },
  },
  postiz_manual_policy: {
    en: {
      title: "Manual approval before publishing",
      detail: "Social drafts are prepared only when you explicitly approve and send them.",
      nextAction: "Approve deliverables in Approvals or Content when ready.",
    },
    ar: {
      title: "الاعتماد اليدوي قبل النشر مفعّل",
      detail: "تُرسل مسودات النشر فقط بعد موافقتك الصريحة وطلبك اليدوي.",
      nextAction: "اعتمد المخرجات من صفحة الاعتمادات أو المحتوى عندما تكون جاهزة.",
    },
  },
  postiz_operation_indeterminate: {
    en: {
      title: "Social publishing action needs confirmation",
      detail: "E3lani could not confirm whether a previous social publishing request completed.",
      nextAction: "Check your connected social account before sending the draft again.",
    },
    ar: {
      title: "إجراء النشر يحتاج إلى تحقق",
      detail: "تعذّر على إعلاني التأكد من اكتمال طلب نشر اجتماعي سابق.",
      nextAction: "تحقق من حسابك الاجتماعي المتصل قبل إعادة إرسال المسودة.",
    },
  },
  ghl_connection_not_ready: {
    en: {
      title: "CRM connection not set up",
      detail: "Your workspace CRM integration has not been connected and tested yet.",
      nextAction: "An owner can connect and verify CRM credentials in Settings when ready.",
    },
    ar: {
      title: "ربط إدارة العملاء غير مهيّأ",
      detail: "لم يتم ربط تكامل إدارة العملاء واختباره في مساحة العمل هذه بعد.",
      nextAction: "يمكن للمالك ربط بيانات إدارة العملاء واختبارها من الإعدادات عند الحاجة.",
    },
  },
  ghl_organization_emergency_stop: {
    en: {
      title: "CRM actions are paused",
      detail: "Automatic CRM actions are currently paused by your workspace safety policy.",
      nextAction: "Review any pending items in Agent actions before resuming.",
    },
    ar: {
      title: "إجراءات إدارة العملاء متوقفة مؤقتًا",
      detail: "تم إيقاف إجراءات إدارة العملاء التلقائية مؤقتًا وفق سياسة الأمان الخاصة بمساحة عملك.",
      nextAction: "راجع العناصر المعلّقة في إجراءات الوكلاء قبل الاستئناف.",
    },
  },
  ghl_manual_policy: {
    en: {
      title: "Human approval required for CRM actions",
      detail: "Specialists prepare suggested actions, and nothing executes externally until you approve it.",
      nextAction: "Review suggested CRM actions in Agent actions whenever they appear.",
    },
    ar: {
      title: "الموافقة البشرية مطلوبة لإجراءات إدارة العملاء",
      detail: "يجهّز المختصون الإجراءات المقترحة ولا يُنفّذ أي شيء خارجيًا حتى تعتمده.",
      nextAction: "راجع الإجراءات المقترحة في صفحة إجراءات الوكلاء عند ظهورها.",
    },
  },
  ghl_channels_missing: {
    en: {
      title: "No customer messaging channels selected",
      detail: "Customer reply channels have not been enabled for CRM follow-up yet.",
      nextAction: "Choose approved messaging channels in Settings after verifying your CRM connection.",
    },
    ar: {
      title: "لم تُحدَّد قنوات مراسلة للعملاء",
      detail: "لم يتم تفعيل قنوات الرد لمتابعة العملاء في نظام إدارة العملاء بعد.",
      nextAction: "اختر القنوات المعتمدة من الإعدادات بعد التحقق من ربط إدارة العملاء.",
    },
  },
  ghl_operation_indeterminate: {
    en: {
      title: "CRM action needs confirmation",
      detail: "A previous CRM update could not be confirmed automatically.",
      nextAction: "Verify the contact or action in your CRM and record the outcome in Agent actions.",
    },
    ar: {
      title: "إجراء إدارة العملاء يحتاج إلى تأكيد",
      detail: "تعذّر التأكد تلقائيًا من نتيجة تحديث سابق في نظام إدارة العملاء.",
      nextAction: "تحقق من النتيجة داخل نظام إدارة العملاء ثم سجّلها في صفحة إجراءات الوكلاء.",
    },
  },
  quality_baseline_missing: {
    en: {
      title: "Approved reply examples needed",
      detail: "Reply quality comparison is waiting for a set of approved customer reply examples.",
      nextAction: "Once approved examples are added, reply quality checks will begin automatically.",
    },
    ar: {
      title: "مطلوب أمثلة ردود معتمدة للمقارنة",
      detail: "تنتظر مقارنة جودة الردود توفر مجموعة من أمثلة ردود العملاء المعتمدة.",
      nextAction: "بعد إضافة الأمثلة المعتمدة ستبدأ مراجعة جودة الردود تلقائيًا.",
    },
  },
  quality_stage_baseline: {
    en: {
      title: "Reply quality check in initial stage",
      detail: "Automated reply quality comparison is waiting for the minimum sample of reviewed examples.",
      nextAction: "Continue reviewing replies normally; comparison advances automatically once ready.",
    },
    ar: {
      title: "مراجعة الجودة في المرحلة الأولية",
      detail: "تنتظر مقارنة جودة الردود بلوغ الحد الأدنى من العينات المراجَعة.",
      nextAction: "استمر في مراجعة الردود بشكل طبيعي وسيتقدم التقييم تلقائيًا عند الجاهزية.",
    },
  },
};

const ROLE_COPY: Record<string, { en: { name: string; responsibility: string }; ar: { name: string; responsibility: string } }> = {
  campaign_strategist: {
    en: {
      name: "Campaign Strategist",
      responsibility: "Turns an approved business brief into positioning, channels, messages, cadence, and measurable campaign direction.",
    },
    ar: {
      name: "مخطط استراتيجية الحملات",
      responsibility: "يحوّل موجز العمل المعتمد إلى تموضع واضح وقنوات ورسائل وجدول نشر وتوجه قابل للقياس.",
    },
  },
  content_producer: {
    en: {
      name: "Content Producer",
      responsibility: "Creates channel-specific draft content from the approved strategy and hands every public-facing item to a human reviewer.",
    },
    ar: {
      name: "منتج المحتوى",
      responsibility: "ينشئ مسودات محتوى مخصصة لكل قناة بناءً على الاستراتيجية المعتمدة ويسلّم كل مخرج للمراجعة البشرية.",
    },
  },
  publisher_monitor: {
    en: {
      name: "Publisher & Performance Monitor",
      responsibility: "Prepares approved social drafts, tracks published performance, and returns attributable results without bypassing human control.",
    },
    ar: {
      name: "مسؤول النشر ومتابعة الأداء",
      responsibility: "يجهّز مسودات النشر المعتمدة ويتابع الأداء ويعرض النتائج الموثقة دون تجاوز الموافقة البشرية.",
    },
  },
  sales_crm: {
    en: {
      name: "Sales & CRM Agent",
      responsibility: "Synchronizes leads, prepares governed CRM actions, supports conversations, and verifies reply quality under human supervision.",
    },
    ar: {
      name: "وكيل المبيعات وإدارة العملاء",
      responsibility: "يزامن العملاء المحتملين ويجهّز إجراءات إدارة العملاء المقترحة ويدعم المحادثات تحت إشرافك البشري.",
    },
  },
};

const WORKER_COPY: Record<string, { en: { name: string; responsibility: string }; ar: { name: string; responsibility: string } }> = {
  campaign_strategy_generator: {
    en: {
      name: "Campaign Strategy Generator",
      responsibility: "Builds a structured campaign strategy from your brief, validates it against your brand facts, and saves it for review.",
    },
    ar: {
      name: "مولّد استراتيجية الحملة",
      responsibility: "يبني استراتيجية حملة منظمة من موجزك ويتحقق من مطابقتها لحقائق علامتك ثم يحفظها للمراجعة.",
    },
  },
  campaign_content_generator: {
    en: {
      name: "Campaign Content Generator",
      responsibility: "Writes channel-ready content drafts, keeps source context linked, and pauses for human approval.",
    },
    ar: {
      name: "مولّد محتوى الحملة",
      responsibility: "يكتب مسودات المحتوى المناسبة لكل قناة مع ربطها بالمصدر ويتوقف عند بوابة الاعتماد البشري.",
    },
  },
  postiz_draft_publisher: {
    en: {
      name: "Social Draft Publisher",
      responsibility: "Checks human approval right before sending a social draft; nothing is published automatically.",
    },
    ar: {
      name: "مرسل مسودات النشر الاجتماعي",
      responsibility: "يتحقق من اعتمادك البشري مباشرة قبل تجهيز مسودة النشر الاجتماعي؛ ولا يُنشر أي شيء تلقائيًا.",
    },
  },
  postiz_performance_monitor: {
    en: {
      name: "Social Performance Monitor",
      responsibility: "Collects engagement metrics from connected social channels and records campaign attribution.",
    },
    ar: {
      name: "مراقب أداء النشر الاجتماعي",
      responsibility: "يجمع مؤشرات الأداء من قنوات التواصل المتصلة ويسجل نتائج الحملة.",
    },
  },
  ghl_contact_sync: {
    en: {
      name: "CRM Contact Sync",
      responsibility: "Creates or updates approved contacts in your CRM workspace.",
    },
    ar: {
      name: "مزامنة جهات اتصال إدارة العملاء",
      responsibility: "ينشئ أو يحدّث بيانات العملاء المحتملين المعتمدة في نظام إدارة العملاء.",
    },
  },
  governed_ghl_actions: {
    en: {
      name: "Approved CRM Actions",
      responsibility: "Carries out only human-approved follow-up, qualification, booking, and pipeline actions.",
    },
    ar: {
      name: "إجراءات إدارة العملاء المعتمدة",
      responsibility: "ينفّذ فقط إجراءات المتابعة والتأهيل والحجز المعتمدة بشريًا وفق سياسة مساحة العمل.",
    },
  },
  quality_shadow_evaluator: {
    en: {
      name: "Reply Quality Evaluator",
      responsibility: "Compares proposed AI replies against approved human examples before any external reply is enabled.",
    },
    ar: {
      name: "مقيّم جودة الردود",
      responsibility: "يقارن الردود المقترحة بالأمثلة البشرية المعتمدة دون تنفيذ أي إرسال خارجي.",
    },
  },
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function humanize(value: string) {
  return customerSafeText(value.replaceAll("_", " ").replaceAll(".", " "));
}

/**
 * Strips internal infrastructure, vendor, workflow, and phase jargon before
 * rendering specialist details to customer accounts.
 */
export function customerSafeText(value: string): string {
  return value
    .replace(/\bPostgreSQL\b/gi, "workspace records")
    .replace(/\bn8n\b/gi, "automation runtime")
    .replace(/\bGemma\b/gi, "AI model")
    .replace(/\bGoHighLevel\b/gi, "CRM")
    .replace(/\bGHL\b/g, "CRM")
    .replace(/\bPostiz\b/gi, "social publishing")
    .replace(/\bPhase\s+\d+[A-Za-z]?\b/gi, "")
    .replace(/\bprivate integration gateway\b/gi, "secure workspace service")
    .replace(/\bprivate credential gateway\b/gi, "secure workspace service")
    .replace(/\bprivate gateway\b/gi, "secure workspace service")
    .replace(/\bpinned export\b/gi, "workflow configuration")
    .replace(/\breadiness flag\b/gi, "automation setting")
    .replace(/\bschedule trigger\b/gi, "automatic schedule")
    .replace(/\bversioned strategy contract\b/gi, "structured campaign plan")
    .replace(/\bproduction seed\b/gi, "workspace setup")
    .replace(/\bqueue claims\b/gi, "automatic runs")
    .replace(/\bUAT\b/g, "testing")
    .replace(/\bshadow evaluation(s)?\b/gi, "preview testing")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function customerBlockerCopy(
  item: Pick<AgentRegistryBlocker, "code" | "title" | "detail" | "next_action">,
  ar: boolean,
): BlockerCopyEntry {
  const mapped = BLOCKER_COPY[item.code];
  if (mapped) return ar ? mapped.ar : mapped.en;
  if (ar) return PLATFORM_SETUP_BLOCKER.ar;
  return {
    title: customerSafeText(item.title),
    detail: customerSafeText(item.detail),
    nextAction: customerSafeText(item.next_action),
  };
}

export function customerRoleCopy(
  role: Pick<AgentRegistryRole, "code" | "name" | "responsibility">,
  ar: boolean,
): { name: string; responsibility: string } {
  const mapped = ROLE_COPY[role.code];
  if (mapped) return ar ? mapped.ar : mapped.en;
  return {
    name: customerSafeText(role.name),
    responsibility: customerSafeText(role.responsibility),
  };
}

export function customerWorkerCopy(
  worker: Pick<AgentRegistryWorker, "code" | "name" | "responsibility">,
  ar: boolean,
): { name: string; responsibility: string } {
  const mapped = WORKER_COPY[worker.code];
  if (mapped) return ar ? mapped.ar : mapped.en;
  return {
    name: customerSafeText(worker.name),
    responsibility: customerSafeText(worker.responsibility),
  };
}

function capabilityStatus(worker: AgentRegistryWorker, ar: boolean) {
  if (worker.runtime_state === "active") {
    return { label: ar ? "نشط" : "Active", tone: "success" as Tone };
  }
  return { label: ar ? "يدوي بإشراف بشري" : "Human-approved", tone: "neutral" as Tone };
}

function JobEvidence({ job, locale }: { job: AgentRegistryJob | null; locale: "en" | "ar" }) {
  const ar = locale === "ar";
  if (!job) {
    return (
      <div className="agent-job-empty">
        <PauseCircle size={18} aria-hidden="true" />
        <div>
          <strong>{ar ? "لا توجد مهمة نشطة الآن" : "No current job"}</strong>
          <span>
            {ar
              ? "لا توجد مهام مجدولة أو قيد التنفيذ أو بانتظار الاعتماد لهذا الدور حاليًا."
              : "No queued, running, or approval-bound work exists for this workspace."}
          </span>
        </div>
      </div>
    );
  }
  const tone: Tone = job.requires_reconciliation ? "danger"
    : job.status === "running" ? "working"
      : job.status === "waiting_approval" ? "attention" : "neutral";
  return (
    <div className={`agent-job-evidence ${job.requires_reconciliation ? "agent-job-stale" : ""}`}>
      <div className="agent-job-title">
        <div><Activity size={17} aria-hidden="true" /><strong>{humanize(job.job_type)}</strong></div>
        <StatusPill tone={tone}>
          {job.requires_reconciliation ? (ar ? "يحتاج مراجعة" : "Review required") : humanize(job.status)}
        </StatusPill>
      </div>
      <dl>
        <div><dt>{ar ? "الحملة" : "Campaign"}</dt><dd>{job.campaign_name || (ar ? "عملية في مساحة العمل" : "Workspace operation")}</dd></div>
        <div><dt>{ar ? "المحاولة" : "Attempt"}</dt><dd>{job.attempt} / {job.max_attempts}</dd></div>
        <div><dt>{ar ? "آخر تحديث" : "Last updated"}</dt><dd><time dateTime={job.updated_at}>{formatDateTime(job.updated_at, locale)}</time></dd></div>
      </dl>
      {job.error_code ? (
        <p className="agent-job-error">
          <strong>{humanize(job.error_code)}</strong>
          {job.error_message ? ` · ${customerSafeText(job.error_message)}` : ""}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Distinct runtime codes can share one customer-facing condition (every
 * workspace-automation code renders the same copy, for example). The registry
 * de-duplicates codes, so this de-duplicates the copy a customer actually reads:
 * one card per condition, and a count that matches what is on screen.
 */
export function uniqueBlockerConditions(blockers: AgentRegistryBlocker[], ar: boolean): AgentRegistryBlocker[] {
  const seen = new Set<string>();
  return blockers.filter((item) => {
    const copy = customerBlockerCopy(item, ar);
    const key = `${copy.title}|${copy.detail}|${copy.nextAction}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function BlockerList({ blockers, ar }: { blockers: AgentRegistryBlocker[]; ar: boolean }) {
  if (!blockers.length) {
    return <p className="agent-clear-state"><CheckCircle2 size={16} /> {ar ? "لا توجد عوائق مسجّلة" : "No recorded blocker"}</p>;
  }
  return (
    <ul className="agent-blocker-list">
      {blockers.map((item) => {
        const copy = customerBlockerCopy(item, ar);
        return (
          <li key={item.code} className={`agent-blocker-${item.severity}`}>
            {item.severity === "blocking" ? <ShieldAlert size={17} aria-hidden="true" /> : <AlertTriangle size={17} aria-hidden="true" />}
            <div>
              <strong>{copy.title}</strong>
              <p>{copy.detail}</p>
              <span>{ar ? "الخطوة التالية:" : "Next:"} {copy.nextAction}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function WorkerRow({ worker, ar }: { worker: AgentRegistryWorker; ar: boolean }) {
  const status = capabilityStatus(worker, ar);
  const copy = customerWorkerCopy(worker, ar);
  return (
    <article className="agent-worker-row">
      <div className="agent-worker-main">
        <span className="agent-worker-icon"><Workflow size={17} aria-hidden="true" /></span>
        <div>
          <div className="agent-worker-title"><h3>{copy.name}</h3></div>
          <p>{copy.responsibility}</p>
        </div>
      </div>
      <div className="agent-worker-state" aria-label={ar ? `حالة ${copy.name}` : `${copy.name} status`}>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
      </div>
    </article>
  );
}

function RoleRecord({ role, locale }: { role: AgentRegistryRole; locale: "en" | "ar" }) {
  const ar = locale === "ar";
  const state = roleState[role.operational_state];
  const copy = customerRoleCopy(role, ar);
  const [showAllConditions, setShowAllConditions] = useState(false);
  const conditions = uniqueBlockerConditions(role.blockers, ar);
  const visibleConditions = showAllConditions ? conditions : conditions.slice(0, 3);
  return (
    <article className="agent-role-record">
      <header className="agent-role-header">
        <span className="agent-avatar large-avatar">{initials(copy.name)}</span>
        <div><h2>{copy.name}</h2><p>{copy.responsibility}</p></div>
        <StatusPill tone={state.tone}>{ar ? state.ar : state.en}</StatusPill>
      </header>
      <div className="agent-role-evidence">
        <section aria-label={ar ? `المهمة الحالية لدور ${copy.name}` : `${copy.name} current job`}><JobEvidence job={role.current_job} locale={locale} /></section>
        <section className="agent-role-blockers" aria-labelledby={`${role.code}-blockers`}>
          <div className="agent-subheading"><h3 id={`${role.code}-blockers`}>{ar ? "ما الذي يحتاج تجهيزًا" : "What blocks this role"}</h3><span>{conditions.length}</span></div>
          <BlockerList blockers={visibleConditions} ar={ar} />
          {conditions.length > 3 ? (
            <button
              type="button"
              className="ghost-button compact-button agent-blocker-toggle"
              aria-expanded={showAllConditions}
              aria-controls={`${role.code}-blockers`}
              onClick={() => setShowAllConditions((value) => !value)}
            >
              {showAllConditions
                ? (ar ? "عرض أقل" : "Show fewer")
                : (ar ? `عرض كل الشروط (${conditions.length})` : `Show all ${conditions.length} conditions`)}
            </button>
          ) : null}
        </section>
      </div>
      <section className="agent-worker-section" aria-labelledby={`${role.code}-workers`}>
        <div className="agent-subheading">
          <div>
            <h3 id={`${role.code}-workers`}>{ar ? "الوكلاء المتخصصون" : "Specialized workers"}</h3>
            <p>{ar ? "القدرات المتخصصة التي تدعم هذا الدور تحت موافقتك البشرية." : "Bounded specialist capabilities that carry this role's responsibilities under human approval."}</p>
          </div>
          <span>{role.workers.length}</span>
        </div>
        <div className="agent-worker-list">{role.workers.map((worker) => <WorkerRow key={worker.code} worker={worker} ar={ar} />)}</div>
      </section>
    </article>
  );
}

export function AgentsWorkspace() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const operations = useOperations();

  if (operations.status === "loading") {
    return (
      <div className="page-stack" dir={ar ? "rtl" : "ltr"} lang={locale}>
        <PageHeading
          title={ar ? "الوكلاء" : "Agents"}
          description={ar ? "أدوار فريق الذكاء الاصطناعي ومهامه الحالية تحت إشرافك." : "Your AI specialist roles, active work, and approval readiness."}
        />
        <OperationsLoading label={ar ? "جارٍ تحميل فريق الوكلاء" : "Loading your AI specialist team"} />
      </div>
    );
  }
  if (operations.status === "error") {
    return (
      <div className="page-stack" dir={ar ? "rtl" : "ltr"} lang={locale}>
        <PageHeading
          title={ar ? "الوكلاء" : "Agents"}
          description={ar ? "أدوار فريق الذكاء الاصطناعي ومهامه الحالية تحت إشرافك." : "Your AI specialist roles, active work, and approval readiness."}
        />
        <OperationsError retry={operations.retry} />
      </div>
    );
  }

  const registry = operations.data.agent_registry;
  return (
    <div className="page-stack" dir={ar ? "rtl" : "ltr"} lang={locale}>
      <PageHeading
        title={ar ? "الوكلاء" : "Agents"}
        description={ar ? "تعرّف على أدوار فريقك الذكي وما يعمل عليه الآن مع بقاء الاعتماد البشري إلزاميًا قبل أي إجراء خارجي." : "See each specialist role, what is running now, and what needs your approval before anything moves forward."}
        actions={<Link className="secondary-button" href="/settings/agents"><Bot size={16} /> {ar ? "فتح استوديو الوكلاء" : "Open Agent Studio"}</Link>}
      />
      <section className="agent-registry-summary" aria-label={ar ? "ملخص فريق الوكلاء" : "Agent team summary"}>
        <div className="agent-registry-intro">
          <PackageCheck size={20} aria-hidden="true" />
          <div>
            <strong>{ar ? "الاعتماد البشري مفعل دائمًا" : "Human approval enforced"}</strong>
            <p>{ar ? "تبقى جميع المسودات وإجراءات النشر وإدارة العملاء تحت مراجعتك المباشرة في مساحة العمل." : "All drafts, publishing handoffs, and CRM actions remain under your direct approval in this workspace."}</p>
          </div>
        </div>
        <dl>
          <div><dt>{ar ? "أدوار الفريق" : "Specialist roles"}</dt><dd>{registry.summary.business_roles}</dd></div>
          <div><dt>{ar ? "القدرات المتاحة" : "Capabilities"}</dt><dd>{registry.summary.specialized_workers}</dd></div>
          <div><dt>{ar ? "قيد التشغيل التلقائي" : "Auto-active"}</dt><dd>{registry.summary.active}</dd></div>
          <div className={registry.summary.jobs_requiring_reconciliation ? "summary-needs-attention" : ""}>
            <dt>{ar ? "يحتاج مراجعة" : "Needs review"}</dt>
            <dd>{registry.summary.jobs_requiring_reconciliation}</dd>
          </div>
        </dl>
      </section>
      {registry.roles.length ? (
        <section className="agent-registry-list" aria-label={ar ? "أدوار الفريق الذكي" : "Specialist roles"}>
          {registry.roles.map((role) => <RoleRecord key={role.code} role={role} locale={locale} />)}
        </section>
      ) : (
        <section className="agent-registry-empty">
          <Bot size={24} />
          <div>
            <h2>{ar ? "لا توجد أدوار مسجّلة" : "No specialist roles configured"}</h2>
            <p>{ar ? "سيظهر فريقك الذكي هنا بمجرد تفعيله في مساحة العمل." : "Your specialist team will appear here once enabled for this workspace."}</p>
          </div>
        </section>
      )}
    </div>
  );
}
