"use client";

import { ArrowLeft, ArrowRight, Bot, Check, CircleAlert, Clock3, FileText, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Tone } from "@/data/fixtures";
import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { CampaignForm, type CampaignFormValue } from "./campaign-form";
import { StatusPill } from "./status-pill";

interface CampaignDetail {
  campaign: {
    id: string; name: string; brief: string; product_type: CampaignFormValue["product_type"];
    target_audience: { audience?: string; description?: string; geography?: string; geographies?: string[]; languages?: string[] };
    status: string; blocked_reason: string | null; budget_target: string | null; revenue_target: string | null;
    currency: string; content_item_target: number; created_by_name: string; created_at: string; updated_at: string;
  };
  strategies: Array<{ id: string; version: number; positioning: string; key_messages: string[]; channels: string[]; posting_cadence: Record<string, unknown>; content_pillars: Array<{ name?: string; description?: string }>; model_name: string; prompt_version: string; created_at: string }>;
  jobs: Array<{ id: string; agent_name: string; job_type: string; status: string; attempt: number; max_attempts: number; error_code: string | null; error_message: string | null; created_at: string; started_at: string | null; finished_at: string | null }>;
  content: Array<{ id: string; channel: string; content_type: string; draft_copy: string; media_brief: string; status: string; decision: string | null; rejection_reason: string | null; decided_by_name: string | null; decided_at: string | null; post_id: string | null; post_status: string | null }>;
  audit: Array<{ id: string; action_type: string; result: string; created_at: string; actor_name: string | null; agent_name: string | null }>;
  workers: Array<{ code: string; name: string; runtime_state: string; trigger_state: string; runtime_verified_at: string }>;
  permissions: { can_operate: boolean; can_review: boolean };
}

function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function tone(status: string): Tone {
  if (["active", "succeeded", "approved"].includes(status)) return "success";
  if (["failed", "blocked_missing_info", "rejected"].includes(status)) return "danger";
  if (["awaiting_approval", "waiting_approval", "paused"].includes(status)) return "attention";
  if (["draft", "queued", "cancelled"].includes(status)) return "neutral";
  return "working";
}
function time(value: string | null) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not started"; }
function money(value: string | null, currency: string) { return value === null ? "Not set" : new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value)); }
function actionError(code?: string) {
  const errors: Record<string, string> = {
    campaign_transition_rejected: "This campaign is not ready for that transition. Refresh the page and review the blocker below.",
    campaign_action_forbidden: "Only an owner or operator can perform this campaign action.",
    campaign_input_invalid: "Review the campaign brief fields and try again.",
    campaign_not_found: "This campaign is no longer available in your workspace.",
  };
  return errors[code || ""] || "Tanaghom could not complete this action. Try again.";
}

export function CampaignDetailView({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    setState("loading"); setError(null);
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("campaign request failed");
      setData(await response.json() as CampaignDetail); setState("ready");
    } catch { setState("error"); }
  }, [campaignId]);
  useEffect(() => { void load(); }, [load]);

  const pending = data?.content.filter((item) => item.status === "pending_approval").length || 0;
  const approved = data?.content.filter((item) => item.status === "approved").length || 0;
  const coreOpen = data?.jobs.some((job) => ["queued", "running", "waiting_approval"].includes(job.status)) || false;
  const openCoreJob = data?.jobs.find((job) => ["queued", "running", "waiting_approval"].includes(job.status)) || null;
  const failedCoreJob = data?.jobs.find((job) => job.status === "failed") || null;
  const latestStrategy = data?.strategies[0] || null;
  const initialValue = useMemo<CampaignFormValue | undefined>(() => data ? ({
    name: data.campaign.name, brief: data.campaign.brief, product_type: data.campaign.product_type,
    audience: data.campaign.target_audience.audience || data.campaign.target_audience.description || "",
    geography: data.campaign.target_audience.geography || data.campaign.target_audience.geographies?.join(", ") || "",
    languages: data.campaign.target_audience.languages || [],
    budget_target: data.campaign.budget_target || "0", revenue_target: data.campaign.revenue_target || "0",
    currency: data.campaign.currency, content_item_target: String(data.campaign.content_item_target),
  }) : undefined, [data]);

  async function action(path: "strategy" | "content" | "ready") {
    setBusy(path); setError(null);
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/${path}`, {
        method: "POST", headers: { "Idempotency-Key": `campaign-${path}-${crypto.randomUUID()}` },
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setError(actionError(payload.error)); return; }
      await load();
    } catch { setError(actionError()); }
    finally { setBusy(null); }
  }
  async function revise(value: CampaignFormValue) {
    setBusy("revise"); setError(null);
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `campaign-revise-${crypto.randomUUID()}` },
        body: JSON.stringify(value),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setError(actionError(payload.error)); return; }
      setEditing(false); await load();
    } catch { setError(actionError()); }
    finally { setBusy(null); }
  }

  if (state === "loading") return <section className="campaign-detail-state" aria-busy="true"><LoaderCircle className="spin" size={22} /><div><h1>Loading campaign</h1><p>Reading the latest brief, agent work, and approval evidence.</p></div></section>;
  if (state === "error" || !data) return <section className="campaign-detail-state" role="alert"><CircleAlert size={22} /><div><h1>Campaign could not be loaded</h1><p>Tanaghom could not read this campaign. Your records were not changed.</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} /> Try again</button></div></section>;

  const campaign = data.campaign;
  const strategyWorker = data.workers.find((worker) => worker.code === "campaign_strategy_generator");
  const contentWorker = data.workers.find((worker) => worker.code === "campaign_content_generator");
  let nextAction = <div><h2>Campaign record is complete</h2><p>Review the lifecycle evidence below.</p></div>;
  if (coreOpen && campaign.status !== "awaiting_approval") nextAction = <div><h2>Core agent work is {openCoreJob?.status === "running" ? "in progress" : "queued"}</h2><p>{openCoreJob?.agent_name || "Tanaghom"} is responsible for {label(openCoreJob?.job_type || "campaign work")}.</p><small>{openCoreJob?.status === "queued" ? "The job is durably stored and will begin when its reviewed worker is active." : "Refresh to read the latest authoritative status."}</small></div>;
  else if (failedCoreJob && ["draft", "strategy_ready"].includes(campaign.status)) {
    const retryPath = failedCoreJob.job_type === "campaign.content.generate" ? "content" : "strategy";
    nextAction = <><div><h2>Agent work needs a controlled retry</h2><p>{failedCoreJob.error_message || `${failedCoreJob.agent_name} could not complete this job.`}</p><small>The failed attempt remains in the immutable job history.</small></div>{data.permissions.can_operate ? <button className="primary-button" disabled={busy !== null} onClick={() => void action(retryPath)}>{busy === retryPath ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />} Retry {retryPath}</button> : null}</>;
  }
  else if (campaign.status === "paused") nextAction = <div><h2>Campaign is paused</h2><p>No new campaign work can start while this record is paused.</p><small>An authorized owner must review the operating policy before work resumes.</small></div>;
  else if (campaign.status === "draft") nextAction = <><div><h2>Start campaign strategy</h2><p>The Campaign Strategist will process this brief. No publishing, CRM action, message, or spend can occur.</p><small>{strategyWorker?.runtime_state === "active" ? "Strategist worker is active." : "The job will remain safely queued until the platform activates the Strategist worker."}</small></div>{data.permissions.can_operate ? <button className="primary-button" disabled={busy !== null} onClick={() => void action("strategy")}>{busy === "strategy" ? <LoaderCircle className="spin" size={17} /> : <Bot size={17} />} Start strategy</button> : null}</>;
  else if (campaign.status === "blocked_missing_info") nextAction = <><div><h2>Strategy needs more information</h2><p>{campaign.blocked_reason}</p><small>Revise the brief, then start Strategy again.</small></div>{data.permissions.can_operate ? <button className="primary-button" onClick={() => setEditing(true)}><FileText size={17} /> Revise brief</button> : null}</>;
  else if (campaign.status === "strategy_ready") nextAction = <><div><h2>Strategy is ready</h2><p>Review the strategy below, then ask the Content Producer for {campaign.content_item_target} draft{campaign.content_item_target === 1 ? "" : "s"}.</p><small>{contentWorker?.runtime_state === "active" ? "Content worker is active." : "The job will remain safely queued until the platform activates the Content worker."}</small></div>{data.permissions.can_operate ? <button className="primary-button" disabled={busy !== null} onClick={() => void action("content")}>{busy === "content" ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />} Generate drafts</button> : null}</>;
  else if (campaign.status === "content_in_progress") nextAction = <div><h2>Core agent work is in progress</h2><p>Tanaghom is preserving the job and will show generated drafts here when they are ready.</p><small>Refresh to read the latest authoritative status.</small></div>;
  else if (campaign.status === "awaiting_approval" && pending > 0) nextAction = <><div><h2>{pending} draft{pending === 1 ? "" : "s"} need a human decision</h2><p>Review the full draft and media brief before approving or rejecting it.</p></div>{data.permissions.can_review ? <Link className="primary-button" href="/approvals">Review drafts <ArrowRight size={17} /></Link> : null}</>;
  else if (campaign.status === "awaiting_approval") nextAction = <><div><h2>Human review is complete</h2><p>{approved} approved draft{approved === 1 ? "" : "s"} will remain in the Content Library. Mark the campaign ready only when this evidence is correct.</p><small>This does not send anything to Postiz or GHL.</small></div>{data.permissions.can_operate ? <button className="primary-button" disabled={busy !== null || approved < 1} onClick={() => void action("ready")}>{busy === "ready" ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Mark ready for handoff</button> : null}</>;
  else if (campaign.status === "active") nextAction = <><div><h2>Ready for controlled handoff</h2><p>Core campaign work is complete. Approved content remains available in the Content Library for explicit provider actions.</p></div><Link className="secondary-button" href="/content">Open Content Library <ArrowRight size={17} /></Link></>;

  return <div className="page-stack campaign-detail-page">
    <nav className="campaign-breadcrumb" aria-label="Breadcrumb"><Link href="/campaigns"><ArrowLeft size={16} /> Campaigns</Link></nav>
    <header className="campaign-detail-heading"><div><StatusPill tone={tone(campaign.status)}>{label(campaign.status)}</StatusPill><h1>{campaign.name}</h1><p>Owned by {campaign.created_by_name} · Updated {time(campaign.updated_at)}</p></div>{data.permissions.can_operate && ["draft", "blocked_missing_info"].includes(campaign.status) ? <button className="secondary-button" onClick={() => setEditing((current) => !current)}><FileText size={17} /> {editing ? "Keep current brief" : "Edit brief"}</button> : null}</header>
    {editing && initialValue ? <CampaignForm initialValue={initialValue} title="Revise campaign brief" description="Update the source context before starting or retrying Strategy. Previous audit evidence remains unchanged." submitLabel="Save revised brief" busy={busy === "revise"} error={error} onSubmit={revise} onClose={() => setEditing(false)} /> : null}
    <section className="campaign-next-action" aria-labelledby="campaign-next-action-title"><div className="campaign-next-icon"><ShieldCheck size={20} /></div><div id="campaign-next-action-title" className="campaign-next-copy">{nextAction}</div></section>
    {error && !editing ? <p className="campaign-action-error" role="alert">{error}</p> : null}

    <section className="campaign-lifecycle" aria-labelledby="campaign-lifecycle-title"><header><div><h2 id="campaign-lifecycle-title">Campaign lifecycle</h2><p>Every step reads from the authoritative database.</p></div></header><ol>
      {[{ name: "Brief", complete: true, detail: "Verified customer context" }, { name: "Strategy", complete: data.strategies.length > 0, detail: data.strategies.length ? `Version ${data.strategies[0].version}` : "Not generated" }, { name: "Content", complete: data.content.length > 0, detail: data.content.length ? `${data.content.length} drafts · ${pending} waiting` : "Not generated" }, { name: "Handoff", complete: campaign.status === "active", detail: campaign.status === "active" ? "Ready" : "Protected" }].map((step) => <li className={step.complete ? "is-complete" : ""} key={step.name}><span>{step.complete ? <Check size={16} /> : <Clock3 size={16} />}</span><div><strong>{step.name}</strong><small>{step.detail}</small></div></li>)}
    </ol></section>

    <div className="campaign-detail-grid">
      <main className="campaign-detail-main">
        <section className="campaign-detail-section" aria-labelledby="campaign-brief-title"><header><h2 id="campaign-brief-title">Business brief</h2><p>The verified input supplied to the Strategist.</p></header><p className="campaign-brief-copy">{campaign.brief}</p><dl className="campaign-facts"><div><dt>Offer</dt><dd>{label(campaign.product_type)}</dd></div><div><dt>Audience</dt><dd>{campaign.target_audience.audience || campaign.target_audience.description || "Not set"}</dd></div><div><dt>Geography</dt><dd>{campaign.target_audience.geography || campaign.target_audience.geographies?.join(", ") || "Not set"}</dd></div><div><dt>Content batch</dt><dd>{campaign.content_item_target}</dd></div><div><dt>Budget target</dt><dd><bdi>{money(campaign.budget_target, campaign.currency)}</bdi></dd></div><div><dt>Revenue target</dt><dd><bdi>{money(campaign.revenue_target, campaign.currency)}</bdi></dd></div></dl></section>
        <section className="campaign-detail-section" aria-labelledby="campaign-strategy-title"><header><h2 id="campaign-strategy-title">Strategy</h2><p>Versioned recommendations and model provenance.</p></header>{latestStrategy ? <div className="strategy-detail"><h3>Positioning</h3><p>{latestStrategy.positioning}</p><div className="strategy-columns"><div><h3>Key messages</h3><ul>{latestStrategy.key_messages.map((message) => <li key={message}>{message}</li>)}</ul></div><div><h3>Channels</h3><ul>{latestStrategy.channels.map((channel) => <li key={channel}>{label(channel)}</li>)}</ul></div></div><small>Version {latestStrategy.version} · {latestStrategy.model_name} · {latestStrategy.prompt_version}</small></div> : <p className="campaign-section-empty">No strategy exists yet. Start Strategy from the action above.</p>}</section>
        <section className="campaign-detail-section" aria-labelledby="campaign-content-title"><header><h2 id="campaign-content-title">Generated content</h2><p>Drafts remain visible after approval or rejection.</p></header>{data.content.length ? <div className="campaign-content-list">{data.content.map((item) => <article key={item.id}><header><div><StatusPill tone={tone(item.status)}>{label(item.status)}</StatusPill><h3>{label(item.channel)} · {label(item.content_type)}</h3></div>{item.decided_by_name ? <small>{label(item.decision || "decided")} by {item.decided_by_name}</small> : null}</header><p>{item.draft_copy}</p><div className="content-media-brief"><strong>Media brief</strong><p>{item.media_brief}</p></div>{item.rejection_reason ? <p className="campaign-rejection"><strong>Rejection reason:</strong> {item.rejection_reason}</p> : null}</article>)}</div> : <p className="campaign-section-empty">No content has been generated for this campaign.</p>}</section>
      </main>
      <aside className="campaign-detail-rail">
        <section className="campaign-detail-section" aria-labelledby="campaign-jobs-title"><header><h2 id="campaign-jobs-title">Agent jobs</h2><p>Attempts, timing, and blockers.</p></header>{data.jobs.length ? <ul className="campaign-job-list">{data.jobs.map((job) => <li key={job.id}><div><StatusPill tone={tone(job.status)}>{label(job.status)}</StatusPill><strong>{job.agent_name}</strong><small>{label(job.job_type)} · Attempt {job.attempt}/{job.max_attempts}</small></div><time dateTime={job.created_at}>{time(job.created_at)}</time>{job.error_message ? <p>{job.error_message}</p> : null}</li>)}</ul> : <p className="campaign-section-empty">No agent jobs have been queued.</p>}</section>
        <section className="campaign-detail-section" aria-labelledby="campaign-audit-title"><header><h2 id="campaign-audit-title">Recent evidence</h2><p>Immutable campaign and agent actions.</p></header>{data.audit.length ? <ol className="campaign-audit-list">{data.audit.map((entry) => <li key={entry.id}><span aria-hidden="true" /><div><strong>{label(entry.action_type)}</strong><p>{entry.actor_name || entry.agent_name || "Tanaghom platform"}</p><time dateTime={entry.created_at}>{time(entry.created_at)}</time></div></li>)}</ol> : <p className="campaign-section-empty">No audit evidence exists yet.</p>}</section>
      </aside>
    </div>
  </div>;
}
