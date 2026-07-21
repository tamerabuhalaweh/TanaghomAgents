"use client";

import { ArrowRight, CircleDollarSign, FileCheck2, Plus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Tone } from "@/data/fixtures";
import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { CampaignForm, type CampaignFormValue } from "./campaign-form";
import { useOperations } from "./operations-context";
import { DomainEmpty, OperationsError, OperationsLoading } from "./operations-state";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

function campaignTone(status: string): Tone {
  if (status === "active" || status === "closed") return "success";
  if (status === "blocked_missing_info") return "danger";
  if (status === "awaiting_approval" || status === "paused") return "attention";
  if (status === "draft") return "neutral";
  return "working";
}
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function money(value: string | null, currency: string) { return value ? new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value)) : "Not set"; }
function stage(status: string, jobType: string | null, jobStatus: string | null) {
  if (jobType === "campaign.strategy.generate") return `Strategy · ${label(jobStatus || "queued")}`;
  if (jobType === "campaign.content.generate" && status !== "awaiting_approval") return `Content · ${label(jobStatus || "queued")}`;
  if (status === "draft" || status === "blocked_missing_info") return "Brief";
  if (status === "strategy_ready") return "Strategy";
  if (status === "content_in_progress" || status === "awaiting_approval") return "Content review";
  if (status === "active") return "Ready for handoff";
  return label(status);
}

const errorMessages: Record<string, string> = {
  campaign_input_invalid: "Review the brief, audience, geography, targets, and content count.",
  valid_idempotency_key_required: "We could not safely identify this request. Try again.",
  forbidden: "Only an owner or operator can create a campaign.",
  service_unavailable: "Tanaghom could not create the campaign. Try again.",
};

export function CampaignsView() {
  const operations = useOperations();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canOperate = operations.status === "ready"
    && ["owner", "operator"].includes(operations.data.current_user.role);

  async function createCampaign(value: CampaignFormValue) {
    setBusy(true); setError(null);
    try {
      const response = await authenticatedFetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `campaign-create-${crypto.randomUUID()}` },
        body: JSON.stringify(value),
      });
      const payload = await response.json() as { error?: string; campaign?: { campaign_id: string } };
      if (!response.ok || !payload.campaign) {
        setError(errorMessages[payload.error || "service_unavailable"] || "Tanaghom rejected this campaign. Review the fields and try again.");
        return;
      }
      operations.retry();
      router.push(`/campaigns/${payload.campaign.campaign_id}`);
    } catch { setError(errorMessages.service_unavailable); }
    finally { setBusy(false); }
  }

  return <div className="page-stack campaigns-page">
    <PageHeading title="Campaigns" description="Create a business brief, direct the core agents, and keep every handoff visible." actions={canOperate ? <button className="primary-button" type="button" onClick={() => { setCreating(true); setError(null); }} aria-expanded={creating} aria-controls="campaign-creation"><Plus size={17} /> Create campaign</button> : undefined} />
    {creating ? <div id="campaign-creation"><CampaignForm title="Create campaign draft" description="Define the verified business context the Campaign Strategist will use. You will start agent work from the campaign detail page." submitLabel="Create campaign draft" busy={busy} error={error} onSubmit={createCampaign} onClose={() => { if (!busy) setCreating(false); }} /></div> : null}
    {operations.status === "loading" ? <OperationsLoading label="Loading campaigns" /> : null}
    {operations.status === "error" ? <OperationsError retry={operations.retry} /> : null}
    {operations.status === "ready" && operations.data.campaigns.length === 0 ? <DomainEmpty title="No campaigns yet" description={canOperate ? "Create the first campaign brief, then start Strategy from its detail page." : "An owner or operator can create the first campaign brief."} detail="Campaign work remains internal until a human approves every draft." /> : null}
    {operations.status === "ready" && operations.data.campaigns.length > 0 ? <section className="campaign-portfolio" aria-label="Campaign portfolio">{operations.data.campaigns.map((campaign) => <article className={`campaign-record campaign-record-${campaign.status}`} key={campaign.id}>
      <header><div><StatusPill tone={campaignTone(campaign.status)}>{label(campaign.status)}</StatusPill><h2>{campaign.name}</h2><p>{stage(campaign.status, campaign.core_job_type, campaign.core_job_status)}</p></div></header>
      {campaign.blocked_reason ? <div className="campaign-blocked"><strong>Strategy needs more information</strong><p>{campaign.blocked_reason}</p></div> : null}
      <dl><div><dt><FileCheck2 size={16} /> Content</dt><dd>{campaign.content_total} total · {campaign.content_pending} waiting</dd></div><div><dt><CircleDollarSign size={16} /> Revenue target</dt><dd><bdi>{money(campaign.revenue_target, campaign.currency)}</bdi></dd></div><div><dt><UsersRound size={16} /> Leads</dt><dd>{campaign.leads_total}</dd></div></dl>
      <Link className="secondary-button campaign-open-link" href={`/campaigns/${campaign.id}`}>Open campaign <ArrowRight size={17} /></Link>
    </article>)}</section> : null}
  </div>;
}
