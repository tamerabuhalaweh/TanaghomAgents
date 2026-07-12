"use client";

import { CircleDollarSign, FileCheck2, Plus, UsersRound } from "lucide-react";
import type { Tone } from "@/data/fixtures";
import { useOperations } from "./operations-context";
import { DomainEmpty, OperationsError, OperationsLoading } from "./operations-state";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

function campaignTone(status: string): Tone {
  if (status === "active" || status === "completed") return "success";
  if (status === "blocked") return "danger";
  if (status === "draft") return "neutral";
  return "working";
}

function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function money(value: string | null, currency: string) { return value ? new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value)) : "Not set"; }

export function CampaignsView() {
  const operations = useOperations();
  return <div className="page-stack">
    <PageHeading title="Campaigns" description="Plan work, monitor progress, and keep every agent aligned to one business outcome." actions={<button className="primary-button" type="button" disabled title="Campaign creation begins in Phase 3"><Plus size={17} /> Create campaign</button>} />
    {operations.status === "loading" ? <OperationsLoading label="Loading campaigns" /> : null}
    {operations.status === "error" ? <OperationsError retry={operations.retry} /> : null}
    {operations.status === "ready" && operations.data.campaigns.length === 0 ? <DomainEmpty title="No campaigns yet" description="This workspace is connected to the live database. Campaigns will appear here after the Phase 3 creation workflow is activated." detail="0 live records" /> : null}
    {operations.status === "ready" && operations.data.campaigns.length > 0 ? <section className="campaign-portfolio" aria-label="Campaign portfolio">{operations.data.campaigns.map((campaign, index) => <article className="campaign-record" key={campaign.id}>
      <header><div><StatusPill tone={campaignTone(campaign.status)}>{label(campaign.status)}</StatusPill><h2>{campaign.name}</h2></div><span className="campaign-index">{String(index + 1).padStart(2, "0")}</span></header>
      {campaign.blocked_reason ? <p className="campaign-blocked">{campaign.blocked_reason}</p> : null}
      <dl><div><dt><CircleDollarSign size={16} /> Revenue target</dt><dd>{money(campaign.revenue_target, campaign.currency)}</dd></div><div><dt><FileCheck2 size={16} /> Content</dt><dd>{campaign.content_total} total · {campaign.content_pending} pending</dd></div><div><dt><UsersRound size={16} /> Leads</dt><dd>{campaign.leads_total}</dd></div></dl>
      <button className="secondary-button" type="button" disabled title="Campaign detail is not available yet">Open campaign</button>
    </article>)}</section> : null}
  </div>;
}
