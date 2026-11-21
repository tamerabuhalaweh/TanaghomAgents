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
import { customerBlockerCopy, customerSafeText, uniqueBlockerConditions } from "@/lib/agent-blocker-copy";

const roleState: Record<AgentRegistryRole["operational_state"], { en: string; ar: string; tone: Tone }> = {
  working: { en: "Working", ar: "قيد العمل", tone: "working" },
  waiting_approval: { en: "Waiting for approval", ar: "بانتظار الاعتماد", tone: "attention" },
  blocked: { en: "Needs review", ar: "يحتاج مراجعة", tone: "danger" },
  ready: { en: "Ready", ar: "جاهز", tone: "success" },
  inactive: { en: "Manual review mode", ar: "وضع المراجعة اليدوية", tone: "neutral" },
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
function BlockerList({ blockers, ar, id }: { blockers: AgentRegistryBlocker[]; ar: boolean; id: string }) {
  if (!blockers.length) {
    return <p className="agent-clear-state" id={id}><CheckCircle2 size={16} /> {ar ? "لا توجد عوائق مسجّلة" : "No recorded blocker"}</p>;
  }
  return (
    <ul className="agent-blocker-list" id={id}>
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
          <BlockerList blockers={visibleConditions} ar={ar} id={`${role.code}-blockers-list`} />
          {conditions.length > 3 ? (
            <button
              type="button"
              className="ghost-button compact-button agent-blocker-toggle"
              aria-expanded={showAllConditions}
              aria-controls={`${role.code}-blockers-list`}
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
