"use client";

import {
  Activity, AlertTriangle, Bot, CheckCircle2,
  PackageCheck, PauseCircle, ShieldAlert, Workflow,
} from "lucide-react";
import Link from "next/link";

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
    .replace(/\s{2,}/g, " ")
    .trim();
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

function BlockerList({ blockers, compact = false, ar }: { blockers: AgentRegistryBlocker[]; compact?: boolean; ar: boolean }) {
  if (!blockers.length) {
    return <p className="agent-clear-state"><CheckCircle2 size={16} /> {ar ? "لا توجد عوائق مسجّلة" : "No recorded blocker"}</p>;
  }
  const displayed = compact ? blockers.slice(0, 3) : blockers;
  return (
    <ul className="agent-blocker-list">
      {displayed.map((item) => (
        <li key={item.code} className={`agent-blocker-${item.severity}`}>
          {item.severity === "blocking" ? <ShieldAlert size={17} aria-hidden="true" /> : <AlertTriangle size={17} aria-hidden="true" />}
          <div>
            <strong>{customerSafeText(item.title)}</strong>
            <p>{customerSafeText(item.detail)}</p>
            <span>{ar ? "الخطوة التالية:" : "Next:"} {customerSafeText(item.next_action)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function WorkerRow({ worker, ar }: { worker: AgentRegistryWorker; ar: boolean }) {
  const status = capabilityStatus(worker, ar);
  return (
    <article className="agent-worker-row">
      <div className="agent-worker-main">
        <span className="agent-worker-icon"><Workflow size={17} aria-hidden="true" /></span>
        <div>
          <div className="agent-worker-title"><h3>{customerSafeText(worker.name)}</h3></div>
          <p>{customerSafeText(worker.responsibility)}</p>
        </div>
      </div>
      <div className="agent-worker-state" aria-label={ar ? `حالة ${customerSafeText(worker.name)}` : `${customerSafeText(worker.name)} status`}>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
      </div>
    </article>
  );
}

function RoleRecord({ role, locale }: { role: AgentRegistryRole; locale: "en" | "ar" }) {
  const ar = locale === "ar";
  const state = roleState[role.operational_state];
  return (
    <article className="agent-role-record">
      <header className="agent-role-header">
        <span className="agent-avatar large-avatar">{initials(role.name)}</span>
        <div><h2>{customerSafeText(role.name)}</h2><p>{customerSafeText(role.responsibility)}</p></div>
        <StatusPill tone={state.tone}>{ar ? state.ar : state.en}</StatusPill>
      </header>
      <div className="agent-role-evidence">
        <section aria-label={`${role.name} current job`}><JobEvidence job={role.current_job} locale={locale} /></section>
        <section className="agent-role-blockers" aria-labelledby={`${role.code}-blockers`}>
          <div className="agent-subheading"><h3 id={`${role.code}-blockers`}>{ar ? "ما الذي يحتاج تجهيزًا" : "What blocks this role"}</h3><span>{role.blockers.length}</span></div>
          <BlockerList blockers={role.blockers} compact ar={ar} />
          {role.blockers.length > 3 ? (
            <details>
              <summary>{ar ? `عرض كل الشروط (${role.blockers.length})` : `Show all ${role.blockers.length} conditions`}</summary>
              <BlockerList blockers={role.blockers} ar={ar} />
            </details>
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
