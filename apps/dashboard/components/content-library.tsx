"use client";

import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  LibraryBig,
  RefreshCw,
  Search,
  Send,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

type ContentStatus = "draft" | "pending_approval" | "approved" | "rejected" | "scheduled" | "posted" | "cancelled";
type LibraryFilter = "all" | "sent_to_postiz" | ContentStatus;
type HandoffStatus = "queued" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled";

interface ContentItem {
  id: string;
  campaign_name: string;
  channel: string;
  content_type: string;
  draft_copy: string;
  media_brief: string;
  media_url: string | null;
  status: ContentStatus;
  generation: number;
  strategy_version: number;
  scheduled_time: string | null;
  created_at: string;
  updated_at: string;
  decision: "approved" | "rejected" | null;
  rejection_reason: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  provider: string | null;
  provider_post_id: string | null;
  post_status: string | null;
  posted_at: string | null;
  last_synced_at: string | null;
  handoff_job_id: string | null;
  handoff_status: HandoffStatus | null;
  handoff_error_code: string | null;
  handoff_error_message: string | null;
  handoff_requested_at: string | null;
  handoff_updated_at: string | null;
  external_operation_status: "pending" | "in_progress" | "succeeded" | "failed" | "indeterminate" | null;
  postiz_channel_ready: boolean;
}

interface Integration {
  postiz_ready: boolean;
  can_request_draft: boolean;
  reason: string;
}

const tabs: { value: LibraryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending_approval", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "sent_to_postiz", label: "Postiz handoff" },
  { value: "posted", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

const statusLabel: Record<ContentStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  scheduled: "Scheduled",
  posted: "Published",
  cancelled: "Cancelled",
};
const statusTone: Record<ContentStatus, "neutral" | "attention" | "success" | "danger" | "working"> = {
  draft: "neutral",
  pending_approval: "attention",
  approved: "success",
  rejected: "danger",
  scheduled: "working",
  posted: "success",
  cancelled: "neutral",
};

function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))
    : "Not yet";
}

function handoffLabel(item: ContentItem) {
  if (item.post_status === "draft") return "Draft created";
  if (item.handoff_status === "running") return "Creating draft";
  if (item.handoff_status === "failed") return "Handoff failed";
  if (item.handoff_status === "cancelled") return "Handoff cancelled";
  return "Handoff queued";
}

export function ContentLibrary() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [tab, setTab] = useState<LibraryFilter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState("");
  const [submitting, setSubmitting] = useState("");
  const [feedback, setFeedback] = useState<Record<string, { tone: "success" | "error"; message: string }>>({});

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await authenticatedFetch("/api/content", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const payload = await response.json() as { items: ContentItem[]; integration: Integration };
      setItems(payload.items);
      setIntegration(payload.integration);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => items.filter((item) => {
    const matchesTab = tab === "all"
      || (tab === "sent_to_postiz" ? Boolean(item.provider || item.handoff_job_id) : item.status === tab);
    const haystack = `${item.campaign_name} ${item.channel} ${item.content_type} ${item.draft_copy}`.toLowerCase();
    return matchesTab && (!search.trim() || haystack.includes(search.trim().toLowerCase()));
  }), [items, tab, search]);

  const count = (value: LibraryFilter) => value === "all"
    ? items.length
    : items.filter((item) => value === "sent_to_postiz"
      ? Boolean(item.provider || item.handoff_job_id)
      : item.status === value).length;

  const requestHandoff = async (item: ContentItem) => {
    setSubmitting(item.id);
    setFeedback((current) => ({
      ...current,
      [item.id]: { tone: "success", message: "Recording your Postiz draft request…" },
    }));
    try {
      const response = await authenticatedFetch(`/api/content/${item.id}/postiz-draft`, {
        method: "POST",
        headers: { "Idempotency-Key": `postiz-${crypto.randomUUID()}` },
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        const messages: Record<string, string> = {
          content_not_approved: "This item is no longer approved. Refresh before trying again.",
          postiz_handoff_not_enabled: "Postiz handoff is still locked by the live enablement gate.",
          publisher_unavailable: "The Publisher agent is unavailable. Check System status before retrying.",
          postiz_channel_not_configured: `No active Postiz mapping exists for ${item.channel}.`,
          forbidden: "Your role cannot request a Postiz draft.",
        };
        throw new Error(messages[payload.error || ""] || "The Postiz draft request could not be recorded.");
      }
      await load();
      setFeedback((current) => ({
        ...current,
        [item.id]: {
          tone: "success",
          message: "Draft handoff queued. Tanaghom will keep this record visible while the Publisher agent processes it.",
        },
      }));
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [item.id]: {
          tone: "error",
          message: error instanceof Error ? error.message : "The Postiz draft request failed.",
        },
      }));
    } finally {
      setSubmitting("");
    }
  };

  return <div className="page-stack">
    <PageHeading
      title="Content Library"
      description="The permanent record of generated, reviewed, scheduled, and published content."
    />
    {state === "loading" ? <LibraryLoading /> : null}
    {state === "error" ? <section className="operations-state operations-state-error">
      <TriangleAlert />
      <div>
        <h2>Content Library is unavailable</h2>
        <p>Approved content is still safe in PostgreSQL. Restore the connection before making publishing decisions.</p>
      </div>
      <button className="secondary-button" type="button" onClick={() => void load()}>
        <RefreshCw size={16} /> Try again
      </button>
    </section> : null}
    {state === "ready" ? <>
      <section className="library-toolbar" aria-label="Content filters">
        <div className="library-tabs" role="tablist" aria-label="Content status">
          {tabs.map((item) => <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={tab === item.value}
            className={tab === item.value ? "library-tab library-tab-active" : "library-tab"}
            onClick={() => setTab(item.value)}
          >{item.label}<span>{count(item.value)}</span></button>)}
        </div>
        <label className="search-field">
          <Search size={17} />
          <span className="sr-only">Search content</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search campaign, channel, or copy" />
        </label>
      </section>
      {!visible.length ? <section className="library-empty">
        <LibraryBig size={28} />
        <div>
          <h2>No content in this view</h2>
          <p>{items.length ? "Choose another status or clear the search." : "Generated drafts will appear here and remain visible after every approval decision."}</p>
        </div>
      </section> : null}
      <section className="content-records" aria-label="Content records">
        {visible.map((item) => {
          const isExpanded = expanded === item.id;
          const canHandoff = item.status === "approved";
          const hasHandoff = Boolean(item.handoff_job_id);
          const isReady = Boolean(integration?.postiz_ready && integration.can_request_draft && item.postiz_channel_ready);
          const lockedReason = !integration?.can_request_draft
            ? "Your role can view handoffs but cannot request one."
            : !integration?.postiz_ready
              ? integration?.reason
              : `No active staging mapping exists for ${item.channel}.`;

          return <article className="content-record" key={item.id}>
            <header>
              <div className="content-record-title">
                <span className="channel-tile">{item.channel.slice(0, 2).toUpperCase()}</span>
                <div><p>{item.campaign_name}</p><h2>{item.channel} · {item.content_type.replaceAll("_", " ")}</h2></div>
              </div>
              <StatusPill tone={statusTone[item.status]}>{statusLabel[item.status]}</StatusPill>
            </header>
            <p className={`content-copy ${isExpanded ? "content-copy-expanded" : ""}`}>{item.draft_copy}</p>
            <div className="content-record-meta">
              <span>Generation {item.generation}</span>
              <span>Strategy v{item.strategy_version}</span>
              <span>Updated {date(item.updated_at)}</span>
            </div>
            {isExpanded ? <div className="content-details">
              <section><h3>Media brief</h3><p>{item.media_brief}</p></section>
              <section>
                <h3>Human decision</h3>
                {item.decision
                  ? <p><CheckCircle2 size={16} /> {item.decision === "approved" ? "Approved" : "Rejected"} by {item.decided_by_name} · {date(item.decided_at)}</p>
                  : <p><Clock3 size={16} /> No decision recorded for this generation.</p>}
                {item.rejection_reason ? <blockquote>{item.rejection_reason}</blockquote> : null}
              </section>
              <section>
                <h3>Postiz handoff</h3>
                <p>{item.post_status
                  ? <><CheckCircle2 size={16} /> Postiz {item.post_status} created · last synced {date(item.last_synced_at)}</>
                  : item.handoff_status
                    ? <><Clock3 size={16} /> Publisher job {item.handoff_status.replaceAll("_", " ")} · updated {date(item.handoff_updated_at)}</>
                    : "Not sent to Postiz."}</p>
                {item.external_operation_status === "indeterminate" ? <p className="handoff-detail-error">
                  <TriangleAlert size={16} /> Delivery outcome is uncertain. Tanaghom will not retry automatically because that could create a duplicate draft.
                </p> : null}
                {item.handoff_error_message ? <p className="handoff-detail-error">
                  <TriangleAlert size={16} /> {item.handoff_error_message}
                </p> : null}
              </section>
            </div> : null}
            <footer>
              <button className="text-button" type="button" onClick={() => setExpanded(isExpanded ? "" : item.id)}>
                {isExpanded ? "Show less" : "View details"}
              </button>
              <div>
                {item.status === "pending_approval" ? <Link className="secondary-button compact-button" href="/approvals">
                  Review now <ExternalLink size={14} />
                </Link> : null}
                {canHandoff && !hasHandoff ? <button
                  className="primary-button compact-button"
                  type="button"
                  disabled={!isReady || submitting === item.id}
                  title={!isReady ? lockedReason : undefined}
                  onClick={() => void requestHandoff(item)}
                ><Send size={15} /> {submitting === item.id ? "Queueing draft…" : "Send to Postiz as draft"}</button> : null}
                {hasHandoff ? <span className={`handoff-state handoff-state-${item.handoff_status || "queued"}`}>
                  {item.post_status === "draft" ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                  {handoffLabel(item)}
                </span> : null}
              </div>
            </footer>
            {canHandoff && !hasHandoff && !isReady ? <p className="handoff-note">Postiz handoff is locked: {lockedReason}</p> : null}
            {feedback[item.id] ? <p
              className={`handoff-feedback handoff-feedback-${feedback[item.id].tone}`}
              role="status"
              aria-live="polite"
            >{feedback[item.id].message}</p> : null}
          </article>;
        })}
      </section>
    </> : null}
  </div>;
}

function LibraryLoading() {
  return <section className="content-records" aria-busy="true">
    <div className="content-record"><span className="state-skeleton state-skeleton-title" /><span className="state-skeleton state-skeleton-block" /></div>
    <div className="content-record"><span className="state-skeleton state-skeleton-title" /><span className="state-skeleton state-skeleton-block" /></div>
  </section>;
}
