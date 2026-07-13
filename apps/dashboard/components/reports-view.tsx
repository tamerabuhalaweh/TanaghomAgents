"use client";

import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, ShieldAlert } from "lucide-react";

import { useOperations, type OperationsSnapshot } from "./operations-context";
import { DomainEmpty, OperationsError, OperationsLoading } from "./operations-state";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

function number(value: string | number) { return new Intl.NumberFormat("en-US").format(Number(value)); }
function date(value: string | null) {
  if (!value) return "Not synchronized";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }

export function ReportsView() {
  const operations = useOperations();
  return <div className="page-stack">
    <PageHeading title="Reports" description="Understand how campaign work becomes attention, leads, and revenue." actions={<button className="secondary-button" type="button" disabled title="Report export is not available yet">Export report</button>} />
    {operations.status === "loading" ? <OperationsLoading label="Loading reports" /> : null}
    {operations.status === "error" ? <OperationsError retry={operations.retry} /> : null}
    {operations.status === "ready" ? <ReportContent data={operations.data} /> : null}
  </div>;
}

function ReportContent({ data }: { data: OperationsSnapshot }) {
  const engagement = Number(data.performance.likes) + Number(data.performance.comments) + Number(data.performance.shares);
  const hasMetrics = data.post_performance.some((post) => Object.keys(post.metrics).length > 0);
  return <>
    <section className={`report-freshness ${data.performance.stale_posts > 0 ? "is-warning" : ""}`} aria-label="Performance data status">
      <span className="report-freshness-icon" aria-hidden="true">{data.performance.stale_posts > 0 ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}</span>
      <div><strong>{data.performance.stale_posts > 0 ? "Some performance data needs attention" : hasMetrics ? "Performance data is current" : "Monitoring is prepared"}</strong><p>{hasMetrics ? `Last successful synchronization: ${date(data.performance.last_synced_at)}.` : "The inactive monitor is ready for a published staging post. No provider schedule is active."}</p></div>
      {data.performance.stale_posts > 0 ? <StatusPill tone="attention">{data.performance.stale_posts} stale</StatusPill> : null}
    </section>

    <dl className="report-metrics">
      <div><dt>Impressions</dt><dd>{number(data.performance.impressions)}</dd><span>Latest provider totals</span></div>
      <div><dt>Engagements</dt><dd>{number(engagement)}</dd><span>{number(data.performance.likes)} likes · {number(data.performance.comments)} comments</span></div>
      <div><dt>Clicks</dt><dd>{number(data.performance.clicks)}</dd><span>{number(data.performance.shares)} shares</span></div>
      <div><dt>Leads</dt><dd>{number(data.summary.leads_total)}</dd><span>{data.performance.quarantined_leads > 0 ? `${data.performance.quarantined_leads} need attribution` : `${data.summary.leads_won} won`}</span></div>
    </dl>

    {data.campaign_performance.length === 0 ? <DomainEmpty title="No campaign performance to report" description="Reporting will begin after a published staging post completes its first controlled synchronization." detail="No historical fixtures included" /> : <section className="data-section" aria-labelledby="campaign-performance-title">
      <div className="section-heading compact-heading"><div><h2 id="campaign-performance-title">Campaign performance</h2><p>Latest normalized provider totals, grouped without crossing workspace boundaries.</p></div></div>
      <div className="table-scroll" tabIndex={0}><table><thead><tr><th>Campaign</th><th>Posts</th><th>Impressions</th><th>Engagements</th><th>Clicks</th><th>Freshness</th></tr></thead><tbody>{data.campaign_performance.map((campaign) => <tr key={campaign.campaign_id}><td><strong>{campaign.campaign_name}</strong></td><td>{number(campaign.posts)}</td><td>{number(campaign.impressions)}</td><td>{number(Number(campaign.likes) + Number(campaign.comments) + Number(campaign.shares))}</td><td>{number(campaign.clicks)}</td><td>{campaign.stale_posts > 0 ? <StatusPill tone="attention">{campaign.stale_posts} stale</StatusPill> : <span className="cell-detail"><Clock3 size={15} /> {date(campaign.last_synced_at)}</span>}</td></tr>)}</tbody></table></div>
    </section>}

    <section className="data-section" aria-labelledby="post-performance-title">
      <div className="section-heading compact-heading"><div><h2 id="post-performance-title">Post evidence</h2><p>Each row links provider state, source content, synchronization health, and recorded metrics.</p></div></div>
      {data.post_performance.length === 0 ? <div className="inline-empty"><ExternalLink size={18} /><div><strong>No published Postiz records yet</strong><p>Approved drafts remain in the Content Library. Performance appears here only after a draft is published and synchronized.</p></div></div> : <div className="table-scroll" tabIndex={0}><table><thead><tr><th>Source</th><th>Channel</th><th>Status</th><th>Impressions</th><th>Engagements</th><th>Last sync</th></tr></thead><tbody>{data.post_performance.map((post) => <tr key={post.id}><td><strong>{post.campaign_name}</strong><span className="table-subline">{post.content_excerpt}</span></td><td>{label(post.channel)}</td><td><StatusPill tone={post.last_error_code ? "danger" : post.is_stale ? "attention" : post.sync_status === "succeeded" ? "success" : "neutral"}>{post.last_error_code ? "Failed" : post.is_stale ? "Stale" : label(post.sync_status || post.status)}</StatusPill></td><td>{number(post.metrics.impressions || 0)}</td><td>{number(Number(post.metrics.likes || 0) + Number(post.metrics.comments || 0) + Number(post.metrics.shares || 0))}</td><td>{date(post.last_success_at)}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="data-section" aria-labelledby="attribution-title">
      <div className="section-heading compact-heading"><div><h2 id="attribution-title">Attribution review</h2><p>Provider events that cannot prove campaign and source-post ownership stop here instead of silently creating leads.</p></div></div>
      {data.attribution_quarantine.length === 0 ? <div className="inline-empty is-positive"><CheckCircle2 size={18} /><div><strong>No leads awaiting attribution</strong><p>Imported leads must carry an organization, campaign, and source post or fail closed into this review queue.</p></div></div> : <div className="attribution-list">{data.attribution_quarantine.map((record) => <article key={record.id}><ShieldAlert size={18} /><div><strong>{record.quarantine_reason}</strong><p>{label(record.provider)} event {record.provider_event_id} · {date(record.received_at)}</p></div><StatusPill tone="attention">Review</StatusPill></article>)}</div>}
    </section>
  </>;
}
