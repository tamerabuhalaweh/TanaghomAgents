"use client";

import { Check, ChevronLeft, ChevronRight, Clock3, MessageSquareText, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { approvals } from "@/data/fixtures";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

type Decision = "approved" | "rejected";

export function ApprovalWorkspace() {
  const [activeId, setActiveId] = useState(approvals[0].id);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const active = useMemo(() => approvals.find((item) => item.id === activeId) ?? approvals[0], [activeId]);
  const pending = approvals.filter((item) => !decisions[item.id]);

  function moveToNext() {
    const remaining = approvals.filter((item) => item.id !== active.id && !decisions[item.id]);
    if (remaining[0]) setActiveId(remaining[0].id);
  }

  function approve() {
    setDecisions((current) => ({ ...current, [active.id]: "approved" }));
    setRejecting(false);
    moveToNext();
  }

  function reject() {
    if (!reason.trim()) return;
    setDecisions((current) => ({ ...current, [active.id]: "rejected" }));
    setRejecting(false);
    setReason("");
    moveToNext();
  }

  return (
    <div className="page-stack">
      <PageHeading title="Approvals" description={`${pending.length} content ${pending.length === 1 ? "item needs" : "items need"} a decision before publishing.`} />
      <div className="approval-workspace">
        <aside className="review-inbox" aria-label="Content awaiting review">
          <div className="inbox-heading"><h2>Review queue</h2><span>{pending.length} pending</span></div>
          <div className="review-list">
            {approvals.map((item) => {
              const decision = decisions[item.id];
              return (
                <button key={item.id} type="button" className={`review-list-item ${active.id === item.id ? "review-list-item-active" : ""}`} onClick={() => setActiveId(item.id)}>
                  <span className="channel-tile" aria-hidden="true">{item.channel.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{item.title}</strong><small>{item.channel} · {item.scheduled}</small></span>
                  {decision ? <StatusPill tone={decision === "approved" ? "success" : "danger"}>{decision === "approved" ? "Approved" : "Rejected"}</StatusPill> : <ChevronRight size={17} />}
                </button>
              );
            })}
          </div>
        </aside>

        <article className="review-canvas" aria-labelledby="review-title">
          <header className="review-header">
            <div><StatusPill tone="attention">Needs review</StatusPill><h2 id="review-title">{active.title}</h2><p>{active.format} · {active.campaign}</p></div>
            <div className="review-position"><button className="icon-button" type="button" aria-label="Previous item"><ChevronLeft size={19} /></button><span>{approvals.findIndex((item) => item.id === active.id) + 1} of {approvals.length}</span><button className="icon-button" type="button" aria-label="Next item" onClick={moveToNext}><ChevronRight size={19} /></button></div>
          </header>

          <dl className="review-metadata">
            <div><dt>Channel</dt><dd>{active.channel}</dd></div>
            <div><dt>Scheduled</dt><dd>{active.scheduled}</dd></div>
            <div><dt>Prepared by</dt><dd>{active.agent}</dd></div>
            <div><dt>Approval policy</dt><dd>Human required</dd></div>
          </dl>

          <section className="content-preview" aria-labelledby="draft-copy-title">
            <div className="content-preview-heading"><h3 id="draft-copy-title">Draft copy</h3><span>Version 1</span></div>
            <p>{active.draft}</p>
          </section>

          <section className="media-brief" aria-labelledby="media-brief-title">
            <MessageSquareText size={19} />
            <div><h3 id="media-brief-title">Media brief</h3><p>{active.mediaBrief}</p></div>
          </section>

          <section className="decision-history" aria-labelledby="decision-history-title">
            <h3 id="decision-history-title">Decision context</h3>
            <p><Clock3 size={16} /> Generated 26 minutes ago from the approved Summer Camp strategy. No previous rejections.</p>
          </section>

          {rejecting ? (
            <div className="rejection-panel" role="region" aria-labelledby="rejection-title">
              <div><h3 id="rejection-title">What should change?</h3><p>Your reason becomes context for the next generated version.</p></div>
              <label htmlFor="rejection-reason">Rejection reason</label>
              <textarea id="rejection-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Be specific about tone, claims, audience, or required media changes." autoFocus />
              <div className="decision-actions"><button className="ghost-button" type="button" onClick={() => setRejecting(false)}>Keep reviewing</button><button className="danger-button" type="button" disabled={!reason.trim()} onClick={reject}><RotateCcw size={17} /> Reject and regenerate</button></div>
            </div>
          ) : (
            <footer className="review-footer">
              <p>Publishing remains blocked until you approve this version.</p>
              <div className="decision-actions"><button className="ghost-button" type="button" onClick={() => setRejecting(true)}><X size={17} /> Request changes</button><button className="primary-button" type="button" onClick={approve}><Check size={17} /> Approve content</button></div>
            </footer>
          )}
        </article>
      </div>
      <p className="fixture-notice">Fixture mode: decisions update this browser preview only and cannot publish content or call an external service.</p>
    </div>
  );
}
