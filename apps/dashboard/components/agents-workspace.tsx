"use client";

import {
  Activity, AlertTriangle, ArchiveRestore, Bot, CheckCircle2, Clock3,
  PackageCheck, PauseCircle, ShieldAlert, Workflow,
} from "lucide-react";

import type {
  AgentRegistryBlocker, AgentRegistryJob, AgentRegistryRole, AgentRegistryWorker,
} from "@/components/operations-context";
import { useOperations } from "@/components/operations-context";
import { OperationsError, OperationsLoading } from "@/components/operations-state";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import type { Tone } from "@/data/fixtures";

const roleState: Record<AgentRegistryRole["operational_state"], { label: string; tone: Tone }> = {
  working: { label: "Working", tone: "working" },
  waiting_approval: { label: "Waiting for a human", tone: "attention" },
  blocked: { label: "Needs reconciliation", tone: "danger" },
  ready: { label: "Runtime ready", tone: "success" },
  inactive: { label: "Automation inactive", tone: "neutral" },
};

function date(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replaceAll(".", " ");
}

function runtimeLabel(worker: AgentRegistryWorker) {
  if (worker.runtime_state === "active") return { label: "Active", tone: "success" as Tone };
  if (worker.runtime_state === "imported_inactive") return { label: "Imported · inactive", tone: "attention" as Tone };
  return { label: "Release only · not imported", tone: "neutral" as Tone };
}

function triggerLabel(worker: AgentRegistryWorker) {
  if (worker.trigger_state === "enabled") return "Polling enabled";
  if (worker.trigger_state === "workflow_inactive_only") return "Schedule contained by inactive workflow";
  return "Polling disabled";
}

function JobEvidence({ job }: { job: AgentRegistryJob | null }) {
  if (!job) {
    return (
      <div className="agent-job-empty">
        <PauseCircle size={18} aria-hidden="true" />
        <div><strong>No current job</strong><span>No queued, running, or approval-bound work exists for this workspace.</span></div>
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
        <StatusPill tone={tone}>{job.requires_reconciliation ? "Reconciliation required" : humanize(job.status)}</StatusPill>
      </div>
      <dl>
        <div><dt>Campaign / dataset</dt><dd>{job.campaign_name || "Workspace operation"}</dd></div>
        <div><dt>Attempt</dt><dd>{job.attempt} of {job.max_attempts}</dd></div>
        <div><dt>Last evidence</dt><dd><time dateTime={job.updated_at}>{date(job.updated_at)}</time></dd></div>
      </dl>
      {job.error_code ? <p className="agent-job-error"><strong>{humanize(job.error_code)}</strong>{job.error_message ? ` · ${job.error_message}` : ""}</p> : null}
    </div>
  );
}

function BlockerList({ blockers, compact = false }: { blockers: AgentRegistryBlocker[]; compact?: boolean }) {
  if (!blockers.length) return <p className="agent-clear-state"><CheckCircle2 size={16} /> No recorded blocker</p>;
  const displayed = compact ? blockers.slice(0, 3) : blockers;
  return (
    <ul className="agent-blocker-list">
      {displayed.map((item) => (
        <li key={item.code} className={`agent-blocker-${item.severity}`}>
          {item.severity === "blocking" ? <ShieldAlert size={17} aria-hidden="true" /> : <AlertTriangle size={17} aria-hidden="true" />}
          <div><strong>{item.title}</strong><p>{item.detail}</p><span>Next: {item.next_action}</span></div>
        </li>
      ))}
    </ul>
  );
}

function WorkerRow({ worker }: { worker: AgentRegistryWorker }) {
  const runtime = runtimeLabel(worker);
  return (
    <article className="agent-worker-row">
      <div className="agent-worker-main">
        <span className="agent-worker-icon"><Workflow size={17} aria-hidden="true" /></span>
        <div>
          <div className="agent-worker-title"><h3>{worker.name}</h3><span>{worker.phase} · {worker.workflow_version}</span></div>
          <p>{worker.responsibility}</p>
          <code>{worker.job_types.join(" · ")}</code>
        </div>
      </div>
      <div className="agent-worker-state" aria-label={`${worker.name} deployment state`}>
        <StatusPill tone="success">Release available</StatusPill>
        <StatusPill tone={runtime.tone}>{runtime.label}</StatusPill>
        <span><Clock3 size={14} aria-hidden="true" /> {triggerLabel(worker)}</span>
        <span><ArchiveRestore size={14} aria-hidden="true" /> Verified <time dateTime={worker.runtime_verified_at}>{date(worker.runtime_verified_at)}</time></span>
      </div>
      <details className="agent-worker-blockers">
        <summary>{worker.blockers.length} {worker.blockers.length === 1 ? "condition" : "conditions"}</summary>
        <BlockerList blockers={worker.blockers} />
      </details>
    </article>
  );
}

function RoleRecord({ role }: { role: AgentRegistryRole }) {
  const state = roleState[role.operational_state];
  return (
    <article className="agent-role-record">
      <header className="agent-role-header">
        <span className="agent-avatar large-avatar">{initials(role.name)}</span>
        <div><h2>{role.name}</h2><p>{role.responsibility}</p></div>
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
      </header>
      <div className="agent-role-evidence">
        <section aria-label={`${role.name} current job`}><JobEvidence job={role.current_job} /></section>
        <section className="agent-role-blockers" aria-labelledby={`${role.code}-blockers`}>
          <div className="agent-subheading"><h3 id={`${role.code}-blockers`}>What blocks this role</h3><span>{role.blockers.length}</span></div>
          <BlockerList blockers={role.blockers} compact />
          {role.blockers.length > 3 ? <details><summary>Show all {role.blockers.length} conditions</summary><BlockerList blockers={role.blockers} /></details> : null}
        </section>
      </div>
      <section className="agent-worker-section" aria-labelledby={`${role.code}-workers`}>
        <div className="agent-subheading"><div><h3 id={`${role.code}-workers`}>Specialized workers</h3><p>Versioned n8n workflows that carry this role&apos;s bounded responsibilities.</p></div><span>{role.workers.length}</span></div>
        <div className="agent-worker-list">{role.workers.map((worker) => <WorkerRow key={worker.code} worker={worker} />)}</div>
      </section>
    </article>
  );
}

export function AgentsWorkspace() {
  const operations = useOperations();
  if (operations.status === "loading") return <div className="page-stack"><PageHeading title="Agents" description="Live business roles, workers, jobs, and activation evidence." /><OperationsLoading label="Loading the live agent registry" /></div>;
  if (operations.status === "error") return <div className="page-stack"><PageHeading title="Agents" description="Live business roles, workers, jobs, and activation evidence." /><OperationsError retry={operations.retry} /></div>;

  const registry = operations.data.agent_registry;
  return (
    <div className="page-stack">
      <PageHeading title="Agents" description="See each business responsibility, the specialized workers behind it, what is running now, and the exact gate preventing activation." />
      <section className="agent-registry-summary" aria-label="Agent registry summary">
        <div className="agent-registry-intro"><PackageCheck size={20} aria-hidden="true" /><div><strong>Release inventory reconciled</strong><p>PostgreSQL is the customer-facing source of truth. n8n remains private and cannot be controlled from this page.</p></div></div>
        <dl>
          <div><dt>Business roles</dt><dd>{registry.summary.business_roles}</dd></div>
          <div><dt>Specialized workers</dt><dd>{registry.summary.specialized_workers}</dd></div>
          <div><dt>Imported</dt><dd>{registry.summary.imported} / {registry.summary.release_available}</dd></div>
          <div><dt>Active</dt><dd>{registry.summary.active}</dd></div>
          <div className={registry.summary.jobs_requiring_reconciliation ? "summary-needs-attention" : ""}><dt>Needs reconciliation</dt><dd>{registry.summary.jobs_requiring_reconciliation}</dd></div>
        </dl>
      </section>
      {registry.roles.length ? <section className="agent-registry-list" aria-label="Business agent registry">{registry.roles.map((role) => <RoleRecord key={role.code} role={role} />)}</section> : (
        <section className="agent-registry-empty"><Bot size={24} /><div><h2>No business roles registered</h2><p>The authoritative registry is empty. No fixture agents are displayed.</p></div></section>
      )}
    </div>
  );
}
