"use client";

import { CheckCircle2, Clock3, ExternalLink, LibraryBig, RefreshCw, Search, Send, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

type ContentStatus = "draft" | "pending_approval" | "approved" | "rejected" | "scheduled" | "posted" | "cancelled";
type LibraryFilter = "all" | "sent_to_postiz" | ContentStatus;
interface ContentItem {
  id: string; campaign_name: string; channel: string; content_type: string; draft_copy: string;
  media_brief: string; media_url: string | null; status: ContentStatus; generation: number;
  strategy_version: number; scheduled_time: string | null; created_at: string; updated_at: string;
  decision: "approved" | "rejected" | null; rejection_reason: string | null; decided_at: string | null;
  decided_by_name: string | null; provider: string | null; provider_post_id: string | null;
  post_status: string | null; posted_at: string | null; last_synced_at: string | null;
}
interface Integration { postiz_ready: boolean; reason: string }

const tabs: { value: LibraryFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "pending_approval", label: "Pending" },
  { value: "approved", label: "Approved" }, { value: "scheduled", label: "Scheduled" },
  { value: "sent_to_postiz", label: "Sent to Postiz" }, { value: "posted", label: "Published" }, { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];
const statusLabel: Record<ContentStatus, string> = { draft: "Draft", pending_approval: "Pending review", approved: "Approved", rejected: "Rejected", scheduled: "Scheduled", posted: "Published", cancelled: "Cancelled" };
const statusTone: Record<ContentStatus, "neutral" | "attention" | "success" | "danger" | "working"> = { draft: "neutral", pending_approval: "attention", approved: "success", rejected: "danger", scheduled: "working", posted: "success", cancelled: "neutral" };

function date(value: string | null) { return value ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Not yet"; }

export function ContentLibrary() {
  const [items, setItems] = useState<ContentItem[]>([]); const [integration, setIntegration] = useState<Integration | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading"); const [tab, setTab] = useState<LibraryFilter>("all");
  const [search, setSearch] = useState(""); const [expanded, setExpanded] = useState("");
  const load = useCallback(async () => { setState("loading"); try { const response = await authenticatedFetch("/api/content", { cache: "no-store" }); if (!response.ok) throw new Error(); const payload = await response.json() as { items: ContentItem[]; integration: Integration }; setItems(payload.items); setIntegration(payload.integration); setState("ready"); } catch { setState("error"); } }, []);
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => items.filter((item) => (tab === "all" || (tab === "sent_to_postiz" ? Boolean(item.provider) : item.status === tab)) && (!search.trim() || `${item.campaign_name} ${item.channel} ${item.content_type} ${item.draft_copy}`.toLowerCase().includes(search.trim().toLowerCase()))), [items, tab, search]);
  const count = (value: LibraryFilter) => value === "all" ? items.length : items.filter((item) => value === "sent_to_postiz" ? Boolean(item.provider) : item.status === value).length;

  return <div className="page-stack">
    <PageHeading title="Content Library" description="The permanent record of generated, reviewed, scheduled, and published content." />
    {state === "loading" ? <LibraryLoading /> : null}
    {state === "error" ? <section className="operations-state operations-state-error"><TriangleAlert /><div><h2>Content Library is unavailable</h2><p>Approved content is still safe in PostgreSQL. Restore the connection before making publishing decisions.</p></div><button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={16} /> Try again</button></section> : null}
    {state === "ready" ? <>
      <section className="library-toolbar" aria-label="Content filters"><div className="library-tabs" role="tablist" aria-label="Content status">{tabs.map((item) => <button key={item.value} type="button" role="tab" aria-selected={tab === item.value} className={tab === item.value ? "library-tab library-tab-active" : "library-tab"} onClick={() => setTab(item.value)}>{item.label}<span>{count(item.value)}</span></button>)}</div><label className="search-field"><Search size={17} /><span className="sr-only">Search content</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search campaign, channel, or copy" /></label></section>
      {!visible.length ? <section className="library-empty"><LibraryBig size={28} /><div><h2>No content in this view</h2><p>{items.length ? "Choose another status or clear the search." : "Generated drafts will appear here and remain visible after every approval decision."}</p></div></section> : null}
      <section className="content-records" aria-label="Content records">{visible.map((item) => {
        const isExpanded = expanded === item.id; const canHandoff = item.status === "approved";
        return <article className="content-record" key={item.id}>
          <header><div className="content-record-title"><span className="channel-tile">{item.channel.slice(0, 2).toUpperCase()}</span><div><p>{item.campaign_name}</p><h2>{item.channel} · {item.content_type.replaceAll("_", " ")}</h2></div></div><StatusPill tone={statusTone[item.status]}>{statusLabel[item.status]}</StatusPill></header>
          <p className={`content-copy ${isExpanded ? "content-copy-expanded" : ""}`}>{item.draft_copy}</p>
          <div className="content-record-meta"><span>Generation {item.generation}</span><span>Strategy v{item.strategy_version}</span><span>Updated {date(item.updated_at)}</span></div>
          {isExpanded ? <div className="content-details"><section><h3>Media brief</h3><p>{item.media_brief}</p></section><section><h3>Human decision</h3>{item.decision ? <p><CheckCircle2 size={16} /> {item.decision === "approved" ? "Approved" : "Rejected"} by {item.decided_by_name} · {date(item.decided_at)}</p> : <p><Clock3 size={16} /> No decision recorded for this generation.</p>}{item.rejection_reason ? <blockquote>{item.rejection_reason}</blockquote> : null}</section><section><h3>Postiz state</h3><p>{item.post_status ? `${item.post_status} · last synced ${date(item.last_synced_at)}` : "Not sent to Postiz."}</p></section></div> : null}
          <footer><button className="text-button" type="button" onClick={() => setExpanded(isExpanded ? "" : item.id)}>{isExpanded ? "Show less" : "View details"}</button><div>{item.status === "pending_approval" ? <Link className="secondary-button compact-button" href="/approvals">Review now <ExternalLink size={14} /></Link> : null}{canHandoff ? <button className="primary-button compact-button" type="button" disabled={!integration?.postiz_ready} title={!integration?.postiz_ready ? integration?.reason : undefined}><Send size={15} /> Send to Postiz as draft</button> : null}</div></footer>
          {canHandoff && !integration?.postiz_ready ? <p className="handoff-note">Postiz handoff is locked: {integration?.reason}</p> : null}
        </article>;
      })}</section>
    </> : null}
  </div>;
}

function LibraryLoading() { return <section className="content-records" aria-busy="true"><div className="content-record"><span className="state-skeleton state-skeleton-title" /><span className="state-skeleton state-skeleton-block" /></div><div className="content-record"><span className="state-skeleton state-skeleton-title" /><span className="state-skeleton state-skeleton-block" /></div></section>; }
