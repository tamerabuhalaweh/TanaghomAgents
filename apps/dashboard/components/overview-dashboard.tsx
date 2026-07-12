"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { DomainEmpty, OperationsError, OperationsLoading } from "./operations-state";
import { useOperations, type OperationsCampaign } from "./operations-context";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

function campaignTone(status: string) {
  if (status === "blocked_missing_info") return "danger" as const;
  if (status === "paused" || status === "awaiting_approval") return "attention" as const;
  if (status === "active") return "success" as const;
  return "neutral" as const;
}

function campaignStage(campaign: OperationsCampaign) {
  return campaign.status.replaceAll("_", " ");
}

export function OverviewDashboard() {
  const operations = useOperations();
  if (operations.status === "loading") return <div className="page-stack"><PageHeading title="Overview" description="Loading the current source-of-truth state." /><OperationsLoading /></div>;
  if (operations.status === "error") return <div className="page-stack"><PageHeading title="Overview" description="Source-of-truth status is required before operating agents." /><OperationsError retry={operations.retry} /></div>;

  const { data } = operations;
  const description = data.summary.campaigns_total
    ? `${data.summary.campaigns_active} active campaigns, ${data.summary.jobs_open} open jobs, and ${data.summary.approvals_pending} decisions waiting.`
    : "The foundation is ready. No campaign or agent work has started yet.";

  return (
    <div className="page-stack">
      <PageHeading title="Overview" description={description} actions={<button className="secondary-button" type="button" disabled title="Campaign creation is the next Phase 2 capability">Create campaign</button>} />

      <section className="attention-section" aria-labelledby="attention-title">
        <div className="section-heading">
          <div><div className="title-with-count"><h2 id="attention-title">Needs your attention</h2><span>{data.summary.approvals_pending}</span></div><p>Human decisions that currently block publishing work.</p></div>
          <Link href="/approvals" className="text-link">Open approvals <ArrowRight size={16} /></Link>
        </div>
        {data.summary.approvals_pending === 0 ? <div className="attention-clear"><CheckCircle2 size={20} /><div><strong>No decisions are waiting</strong><span>New drafts will appear after Phase 3 agent work begins.</span></div></div> : <div className="attention-clear"><div><strong>{data.summary.approvals_pending} decisions are waiting</strong><span>Open the approval workspace to review source content and context.</span></div></div>}
      </section>

      <section className="handoff-section" aria-labelledby="handoff-title">
        <div className="section-heading compact-heading"><div><h2 id="handoff-title">Agent handoff</h2><p>Current jobs from the authoritative agent queue.</p></div><Link href="/agents" className="text-link">View agents <ArrowRight size={16} /></Link></div>
        {data.agents.length ? <ol className="handoff-rail">{data.agents.map((agent, index) => <li key={agent.id}><div className="agent-identity"><span className="agent-avatar">{agent.code.slice(0, 2).toUpperCase()}</span><div><strong>{agent.name}</strong><StatusPill tone={agent.current_job_status === "running" ? "working" : "neutral"}>{agent.current_job_status || agent.status}</StatusPill></div></div><p>{agent.current_job_type ? agent.current_job_type.replaceAll("_", " ") : "No live job"}</p>{index < data.agents.length - 1 ? <ArrowRight className="handoff-arrow" size={18} aria-hidden="true" /> : null}</li>)}</ol> : <DomainEmpty title="No agents are activated" description="Agent roles are defined, but the live workflows begin in Phase 3." detail="No hidden or simulated jobs are shown." />}
      </section>

      <section className="campaign-section" aria-labelledby="campaign-title">
        <div className="section-heading compact-heading"><div><h2 id="campaign-title">Campaigns</h2><p>Live progress, risk, content, and lead totals.</p></div><Link href="/campaigns" className="text-link">View campaigns <ArrowRight size={16} /></Link></div>
        {data.campaigns.length ? <div className="table-scroll" tabIndex={0} aria-label="Campaign table, horizontally scrollable on small screens"><table><thead><tr><th>Campaign</th><th>Status</th><th>Stage</th><th>Content</th><th>Approvals</th><th>Leads</th></tr></thead><tbody>{data.campaigns.map((campaign) => <tr key={campaign.id}><td><Link href="/campaigns">{campaign.name}</Link></td><td><StatusPill tone={campaignTone(campaign.status)}>{campaignStage(campaign)}</StatusPill></td><td>{campaignStage(campaign)}</td><td>{campaign.content_total}</td><td>{campaign.content_pending}</td><td>{campaign.leads_total}</td></tr>)}</tbody></table></div> : <DomainEmpty title="No campaigns yet" description="The live campaign portfolio is empty." detail="A campaign brief is the first operational record." />}
      </section>

      <div className="overview-footer-grid">
        <section className="performance-section" aria-labelledby="performance-title">
          <div className="section-heading compact-heading"><div><h2 id="performance-title">Recorded performance</h2><p>Totals from live published-post and lead records.</p></div><Link href="/reports" className="text-link">Full report <ArrowRight size={16} /></Link></div>
          <dl className="metric-line"><div><dt>Impressions</dt><dd>{Number(data.performance.impressions).toLocaleString()}</dd><span>Recorded</span></div><div><dt>Clicks</dt><dd>{Number(data.performance.clicks).toLocaleString()}</dd><span>Recorded</span></div><div><dt>Spend</dt><dd>${Number(data.performance.spend).toLocaleString()}</dd><span>Recorded</span></div><div><dt>Leads</dt><dd>{data.summary.leads_total}</dd><span>{data.summary.leads_won} won</span></div></dl>
        </section>
        <section className="alerts-section" aria-labelledby="alerts-title">
          <div className="section-heading compact-heading"><div><h2 id="alerts-title">Alerts</h2><p>{data.summary.notifications_unread} unread operational notifications.</p></div></div>
          {data.notifications.length ? <ul className="alert-list">{data.notifications.slice(0, 5).map((notification) => <li key={notification.id}><div><strong>{notification.title}</strong><span>{notification.body}</span></div><time>{new Date(notification.created_at).toLocaleDateString()}</time></li>)}</ul> : <DomainEmpty title="No active alerts" description="No unread operational notification requires attention." />}
        </section>
      </div>
    </div>
  );
}
