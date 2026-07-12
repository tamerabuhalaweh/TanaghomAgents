"use client";

import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

interface ApprovalItem {
  id: string;
  campaign_id: string;
  campaign_name: string;
  channel: string;
  content_type: string;
  draft_copy: string;
  media_brief: string;
  media_url: string | null;
  generation: number;
  strategy_version: number;
  created_at: string;
}

type LoadState = "loading" | "ready" | "error";

function itemTitle(item: ApprovalItem) {
  const firstLine = item.draft_copy.split(/[.!?\n]/)[0]?.trim();
  return firstLine && firstLine.length <= 68
    ? firstLine
    : `${item.channel} ${item.content_type.replaceAll("_", " ")}`;
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ApprovalWorkspace() {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    setLoadState("loading");
    setFeedback("");
    try {
      const response = await authenticatedFetch("/api/approvals", { cache: "no-store" });
      if (response.status === 401) return;
      if (!response.ok) throw new Error("approval request failed");
      const payload = await response.json() as { items: ApprovalItem[] };
      setItems(payload.items);
      setActiveId((current) => payload.items.some((item) => item.id === current)
        ? current
        : payload.items[0]?.id ?? "");
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const active = useMemo(
    () => items.find((item) => item.id === activeId) ?? items[0],
    [activeId, items],
  );
  const activeIndex = active ? items.findIndex((item) => item.id === active.id) : -1;

  function move(offset: number) {
    if (!items.length) return;
    const nextIndex = (activeIndex + offset + items.length) % items.length;
    setActiveId(items[nextIndex].id);
    setRejecting(false);
    setReason("");
  }

  async function decide(decision: "approved" | "rejected") {
    if (!active || (decision === "rejected" && !reason.trim())) return;
    setSubmitting(true);
    setFeedback("");
    try {
      const response = await authenticatedFetch(`/api/approvals/${active.id}/decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          decision,
          rejection_reason: decision === "rejected" ? reason.trim() : null,
        }),
      });
      if (response.status === 401) return;
      if (!response.ok) throw new Error("decision failed");
      const nextItems = items.filter((item) => item.id !== active.id);
      setItems(nextItems);
      setActiveId(nextItems[Math.min(activeIndex, nextItems.length - 1)]?.id ?? "");
      setRejecting(false);
      setReason("");
      setFeedback(decision === "approved"
        ? "Approval saved. Publishing work has been queued."
        : "Changes requested. Regeneration work has been queued.");
    } catch {
      setFeedback("The decision was not saved. The item remains blocked; please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const description = loadState === "ready"
    ? `${items.length} content ${items.length === 1 ? "item needs" : "items need"} a decision before publishing.`
    : "Review content before any publishing work can move forward.";

  return (
    <div className="page-stack">
      <PageHeading title="Approvals" description={description} />
      <p className="sr-only" role="status" aria-live="polite">{feedback}</p>

      {loadState === "loading" ? <ApprovalLoadingState /> : null}
      {loadState === "error" ? <ApprovalErrorState retry={load} /> : null}
      {loadState === "ready" && !items.length ? <ApprovalEmptyState feedback={feedback} /> : null}

      {loadState === "ready" && active ? (
        <div className="approval-workspace">
          <aside className="review-inbox" aria-label="Content awaiting review">
            <div className="inbox-heading"><h2>Review queue</h2><span>{items.length} pending</span></div>
            <div className="review-list">
              {items.map((item) => (
                <button key={item.id} type="button" className={`review-list-item ${active.id === item.id ? "review-list-item-active" : ""}`} onClick={() => setActiveId(item.id)}>
                  <span className="channel-tile" aria-hidden="true">{item.channel.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{itemTitle(item)}</strong><small>{item.channel} · {formatCreatedAt(item.created_at)}</small></span>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
          </aside>

          <article className="review-canvas" aria-labelledby="review-title">
            <header className="review-header">
              <div><StatusPill tone="attention">Needs review</StatusPill><h2 id="review-title">{itemTitle(active)}</h2><p>{active.content_type.replaceAll("_", " ")} · {active.campaign_name}</p></div>
              <div className="review-position"><button className="icon-button" type="button" aria-label="Previous item" onClick={() => move(-1)}><ChevronLeft size={19} /></button><span>{activeIndex + 1} of {items.length}</span><button className="icon-button" type="button" aria-label="Next item" onClick={() => move(1)}><ChevronRight size={19} /></button></div>
            </header>

            <dl className="review-metadata">
              <div><dt>Channel</dt><dd>{active.channel}</dd></div>
              <div><dt>Created</dt><dd>{formatCreatedAt(active.created_at)}</dd></div>
              <div><dt>Prepared by</dt><dd>Content Producer</dd></div>
              <div><dt>Approval policy</dt><dd>Human required</dd></div>
            </dl>

            <section className="content-preview" aria-labelledby="draft-copy-title">
              <div className="content-preview-heading"><h3 id="draft-copy-title">Draft copy</h3><span>Version {active.generation}</span></div>
              <p>{active.draft_copy}</p>
            </section>

            <section className="media-brief" aria-labelledby="media-brief-title">
              <MessageSquareText size={19} />
              <div><h3 id="media-brief-title">Media brief</h3><p>{active.media_brief}</p></div>
            </section>

            <section className="decision-history" aria-labelledby="decision-history-title">
              <h3 id="decision-history-title">Decision context</h3>
              <p><Clock3 size={16} /> Strategy version {active.strategy_version}. No decision has been recorded for this generation.</p>
            </section>

            {rejecting ? (
              <div className="rejection-panel" role="region" aria-labelledby="rejection-title">
                <div><h3 id="rejection-title">What should change?</h3><p>Your reason becomes context for the next generated version.</p></div>
                <label htmlFor="rejection-reason">Rejection reason</label>
                <textarea id="rejection-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Be specific about tone, claims, audience, or required media changes." />
                <div className="decision-actions"><button className="ghost-button" type="button" onClick={() => setRejecting(false)} disabled={submitting}>Keep reviewing</button><button className="danger-button" type="button" disabled={!reason.trim() || submitting} onClick={() => void decide("rejected")}><RotateCcw size={17} /> {submitting ? "Saving…" : "Reject and regenerate"}</button></div>
              </div>
            ) : (
              <footer className="review-footer">
                <p>Publishing remains blocked until you approve this version.</p>
                <div className="decision-actions"><button className="ghost-button" type="button" onClick={() => setRejecting(true)} disabled={submitting}><X size={17} /> Request changes</button><button className="primary-button" type="button" onClick={() => void decide("approved")} disabled={submitting}><Check size={17} /> {submitting ? "Saving…" : "Approve content"}</button></div>
              </footer>
            )}
          </article>
        </div>
      ) : null}
    </div>
  );
}

function ApprovalLoadingState() {
  return (
    <div className="approval-workspace approval-loading" aria-label="Loading approval queue" aria-busy="true">
      <aside className="review-inbox"><div className="state-skeleton state-skeleton-short" /><div className="state-skeleton" /><div className="state-skeleton" /><div className="state-skeleton" /></aside>
      <div className="review-canvas"><div className="state-skeleton state-skeleton-title" /><div className="state-skeleton" /><div className="state-skeleton state-skeleton-block" /></div>
    </div>
  );
}

function ApprovalErrorState({ retry }: { retry: () => Promise<void> }) {
  return (
    <section className="approval-state approval-state-error" aria-labelledby="approval-error-title">
      <TriangleAlert size={25} aria-hidden="true" />
      <div><h2 id="approval-error-title">The approval queue is unavailable</h2><p>No decision can be made until the source-of-truth connection is restored.</p></div>
      <button className="secondary-button" type="button" onClick={() => void retry()}><RefreshCw size={16} /> Try again</button>
    </section>
  );
}

function ApprovalEmptyState({ feedback }: { feedback: string }) {
  return (
    <section className="approval-state approval-state-empty" aria-labelledby="approval-empty-title">
      <span className="approval-state-icon"><CheckCircle2 size={28} aria-hidden="true" /></span>
      <div><h2 id="approval-empty-title">Approval queue is clear</h2><p>{feedback || "There is no content waiting for a human decision. New drafts will appear here when the Content Producer submits them."}</p></div>
      <span className="approval-state-meta">Publishing remains protected by the database approval policy.</span>
    </section>
  );
}
