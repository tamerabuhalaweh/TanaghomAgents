"use client";

import { useOperations } from "./operations-context";
import { DomainEmpty, OperationsError, OperationsLoading } from "./operations-state";
import { PageHeading } from "./page-heading";

function number(value: string | number) { return new Intl.NumberFormat("en-US").format(Number(value)); }

export function ReportsView() {
  const operations = useOperations();
  return <div className="page-stack">
    <PageHeading title="Reports" description="Understand how campaign work becomes attention, leads, and revenue." actions={<button className="secondary-button" type="button" disabled title="Report export is not available yet">Export report</button>} />
    {operations.status === "loading" ? <OperationsLoading label="Loading reports" /> : null}
    {operations.status === "error" ? <OperationsError retry={operations.retry} /> : null}
    {operations.status === "ready" ? <><dl className="report-metrics"><div><dt>Campaigns</dt><dd>{number(operations.data.summary.campaigns_total)}</dd><span>{operations.data.summary.campaigns_active} active</span></div><div><dt>Total leads</dt><dd>{number(operations.data.summary.leads_total)}</dd><span>{operations.data.summary.leads_won} won</span></div><div><dt>Impressions</dt><dd>{number(operations.data.performance.impressions)}</dd><span>{number(operations.data.performance.clicks)} clicks</span></div><div><dt>Recorded spend</dt><dd>{number(operations.data.performance.spend)}</dd><span>Across {operations.data.performance.live_posts} live posts</span></div></dl>
      {operations.data.campaigns.length === 0 ? <DomainEmpty title="No campaign performance to report" description="All totals above are live. Campaign-level reporting will begin when the first campaign and publishing records are created." detail="No historical fixtures included" /> : <section className="report-chart" aria-labelledby="campaign-report-title"><div className="section-heading compact-heading"><div><h2 id="campaign-report-title">Campaign activity</h2><p>Live lead and content totals by campaign.</p></div></div><div className="report-rows">{operations.data.campaigns.map((campaign) => <div className="report-row" key={campaign.id}><strong>{campaign.name}</strong><span>{campaign.content_total} content items</span><span>{campaign.leads_total} leads</span></div>)}</div></section>}
    </> : null}
  </div>;
}
