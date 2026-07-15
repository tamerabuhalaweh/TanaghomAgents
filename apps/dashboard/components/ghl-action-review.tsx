"use client";

import {
  AlertOctagon,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

type ActionStatus = "awaiting_approval" | "indeterminate";
type UserRole = "owner" | "reviewer" | "operator" | "viewer";

interface ActionItem {
  id: string;
  action_type: string;
  direction: string;
  channel: string;
  payload: Record<string, unknown>;
  policy_snapshot: Record<string, unknown>;
  status: ActionStatus;
  idempotency_key: string;
  ownership_epoch: number;
  attempt: number;
  max_attempts: number;
  created_at: string;
  dispatched_at: string | null;
  error_code: string | null;
  error_message: string | null;
  request_fingerprint: string;
  provider_conversation_id: string;
  conversation_state: string;
  reply_authority: string;
  lead_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  requested_by_name: string | null;
  requested_by_agent_name: string | null;
  template_key: string | null;
  template_version: number | null;
  template_body: string | null;
  operation_id: string | null;
  operation_status: string | null;
  operation_response_summary: Record<string, unknown> | null;
}

interface ReviewPayload {
  items: ActionItem[];
  current_user: { id: string; name: string; role: UserRole };
  snapshot_at: string;
  stale_after_seconds: number;
}

function title(item: ActionItem) {
  return `${item.action_type.replaceAll("_", " ")} · ${item.lead_name || "GHL contact"}`;
}

function timestamp(value: string | null) {
  if (!value) return "Not dispatched";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function payloadRows(payload: Record<string, unknown>) {
  return Object.entries(payload).map(([key, value]) => ({
    key: key.replaceAll("_", " "),
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

function containsArabic(value: string) { return /[\u0600-\u06ff]/.test(value); }

export function GhlActionReview() {
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  const [activeId, setActiveId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [stale, setStale] = useState(false);
  const [reason, setReason] = useState("");
  const [providerReference, setProviderReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setFeedback(""); setStale(false);
    try {
      const response = await authenticatedFetch("/api/ghl-actions", { cache: "no-store" });
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error("load_failed");
      const next = await response.json() as ReviewPayload;
      setPayload(next);
      setActiveId((current) => next.items.some((item) => item.id === current) ? current : next.items[0]?.id || "");
      setState("ready");
    } catch { setState("error"); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!payload) return;
    const timer = window.setTimeout(() => setStale(true), payload.stale_after_seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [payload]);

  const active = useMemo(() => payload?.items.find((item) => item.id === activeId) || payload?.items[0], [activeId, payload]);
  const canDecide = payload?.current_user.role === "owner" || payload?.current_user.role === "reviewer";

  async function submit(kind: "approved" | "rejected" | "confirmed_succeeded" | "confirmed_not_applied") {
    if (!active || reason.trim().length < 3 || !canDecide) return;
    setBusy(true); setFeedback("");
    const reconciliation = kind.startsWith("confirmed_");
    try {
      const response = await authenticatedFetch(`/api/ghl-actions/${active.id}/${reconciliation ? "reconcile" : "decision"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reconciliation
          ? { resolution: kind, reason: reason.trim(), provider_reference: providerReference.trim() || null, command_id: crypto.randomUUID() }
          : { decision: kind, reason: reason.trim(), command_id: crypto.randomUUID() }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "action_failed");
      const remaining = payload.items.filter((item) => item.id !== active.id);
      setPayload({ ...payload, items: remaining, snapshot_at: new Date().toISOString() });
      setActiveId(remaining[0]?.id || ""); setReason(""); setProviderReference("");
      setFeedback(reconciliation
        ? "Reconciliation recorded. The uncertain operation no longer blocks governed automation."
        : kind === "approved" ? "Action approved and returned to the controlled worker queue." : "Action rejected and canceled with audit evidence.");
    } catch {
      setFeedback("The decision was not saved. The action remains blocked; refresh before trying again.");
    } finally { setBusy(false); }
  }

  const waiting = payload?.items.filter((item) => item.status === "awaiting_approval").length || 0;
  const uncertain = payload?.items.filter((item) => item.status === "indeterminate").length || 0;
  const description = state === "ready" ? `${uncertain} uncertain and ${waiting} awaiting human approval.` : "Review governed CRM actions before they can proceed.";

  return <div className="page-stack action-review-page">
    <PageHeading title="Agent action review" description={description} />
    {stale && state === "ready" ? <div className="action-review-stale" role="status"><Clock3 size={17} /><span>This queue snapshot may be stale. Refresh before deciding.</span><button className="ghost-button compact-button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button></div> : null}
    {feedback ? <p className="integration-feedback" role="status" aria-live="polite">{feedback}</p> : null}
    {state === "loading" ? <div className="action-review-shell" aria-busy="true" aria-label="Loading GHL action review"><div className="action-review-queue"><div className="state-skeleton" /><div className="state-skeleton" /><div className="state-skeleton" /></div><div className="action-review-detail"><div className="state-skeleton state-skeleton-title" /><div className="state-skeleton state-skeleton-block" /></div></div> : null}
    {state === "forbidden" ? <ReviewState icon={<ShieldCheck />} title="Review access required" copy="Only accepted Tanaghom users can view this organization’s governed action queue." /> : null}
    {state === "error" ? <ReviewState icon={<TriangleAlert />} title="Action review is unavailable" copy="No decision was changed. Restore the protected database connection, then retry." action={<button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} /> Try again</button>} /> : null}
    {state === "ready" && payload && !payload.items.length ? <ReviewState icon={<CheckCircle2 />} title="Action queue is clear" copy={feedback || "No GHL action needs human approval or reconciliation. Automatic work remains bounded by organization policy."} /> : null}
    {state === "ready" && payload && active ? <div className="action-review-shell">
      <aside className="action-review-queue" aria-label="GHL actions requiring attention">
        <header><div><h2>Needs attention</h2><p>{payload.items.length} governed {payload.items.length === 1 ? "action" : "actions"}</p></div><button className="icon-button" aria-label="Refresh action queue" onClick={() => void load()}><RefreshCw size={17} /></button></header>
        <div>{payload.items.map((item) => <button key={item.id} type="button" className={`action-review-row ${item.id === active.id ? "action-review-row-active" : ""}`} onClick={() => { setActiveId(item.id); setReason(""); setProviderReference(""); }}>
          <span className={item.status === "indeterminate" ? "action-risk-icon action-risk-icon-danger" : "action-risk-icon"}>{item.status === "indeterminate" ? <AlertOctagon size={17} /> : <ShieldCheck size={17} />}</span>
          <span><strong>{title(item)}</strong><small>{item.channel} · {timestamp(item.created_at)}</small></span><ChevronRight size={17} />
        </button>)}</div>
      </aside>
      <article className="action-review-detail" aria-labelledby="action-review-title">
        <header><div><StatusPill tone={active.status === "indeterminate" ? "danger" : "attention"}>{active.status === "indeterminate" ? "Reconciliation required" : "Approval required"}</StatusPill><h2 id="action-review-title">{title(active)}</h2><p>{active.direction} · {active.channel} · requested by {active.requested_by_name || active.requested_by_agent_name || "Sales CRM Agent"}</p></div></header>
        {active.status === "indeterminate" ? <section className="action-uncertain-warning"><AlertOctagon size={21} /><div><h3>Provider outcome is unknown</h3><p>Do not retry. Verify the result in GoHighLevel, then record exactly what happened.</p></div></section> : null}
        <dl className="action-review-metadata"><div><dt>Conversation</dt><dd>{active.conversation_state} · {active.reply_authority}</dd></div><div><dt>Ownership epoch</dt><dd>{active.ownership_epoch}</dd></div><div><dt>Created</dt><dd>{timestamp(active.created_at)}</dd></div><div><dt>Dispatch</dt><dd>{timestamp(active.dispatched_at)}</dd></div></dl>
        <section className="action-payload" aria-labelledby="action-payload-title"><div><h3 id="action-payload-title">Proposed provider action</h3><span>{active.action_type}</span></div><dl>{payloadRows(active.payload).map((row) => <div key={row.key}><dt>{row.key}</dt><dd dir={containsArabic(row.value) ? "rtl" : "ltr"}>{row.value}</dd></div>)}</dl>{active.template_key ? <p>Approved template: <strong>{active.template_key}</strong> version {active.template_version}</p> : null}</section>
        <section className="action-evidence" aria-labelledby="action-evidence-title"><h3 id="action-evidence-title">Authorization evidence</h3><dl><div><dt>Idempotency key</dt><dd>{active.idempotency_key}</dd></div><div><dt>Request fingerprint</dt><dd>{active.request_fingerprint}</dd></div><div><dt>Policy snapshot</dt><dd>{JSON.stringify(active.policy_snapshot)}</dd></div>{active.error_code ? <div><dt>Provider error</dt><dd>{active.error_code}: {active.error_message}</dd></div> : null}</dl></section>
        {canDecide ? <section className="action-decision" aria-labelledby="action-decision-title"><div><h3 id="action-decision-title">{active.status === "indeterminate" ? "Record verified provider outcome" : "Human decision"}</h3><p>Your reason becomes immutable audit evidence.</p></div><label htmlFor="action-review-reason">Required reason<textarea id="action-review-reason" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder={active.status === "indeterminate" ? "How was the provider result verified?" : "Why is this action approved or rejected?"} /></label>{active.status === "indeterminate" ? <label htmlFor="action-provider-reference">Provider reference <span>Optional</span><input id="action-provider-reference" value={providerReference} maxLength={300} onChange={(event) => setProviderReference(event.target.value)} placeholder="Message, appointment, or opportunity ID" /></label> : null}<div className="action-decision-buttons">{active.status === "awaiting_approval" ? <><button className="ghost-button" disabled={busy || reason.trim().length < 3} onClick={() => void submit("rejected")}><X size={16} /> Reject action</button><button className="primary-button" disabled={busy || reason.trim().length < 3} onClick={() => void submit("approved")}><Check size={16} /> Approve action</button></> : <><button className="secondary-button" disabled={busy || reason.trim().length < 3} onClick={() => void submit("confirmed_not_applied")}><X size={16} /> Confirm not applied</button><button className="primary-button" disabled={busy || reason.trim().length < 3} onClick={() => void submit("confirmed_succeeded")}><Check size={16} /> Confirm success</button></>}</div></section> : <section className="action-readonly"><ShieldCheck size={18} /><p>Your role can inspect evidence, but only an owner or reviewer may decide or reconcile an action.</p></section>}
      </article>
    </div> : null}
  </div>;
}

function ReviewState({ icon, title, copy, action }: { icon: React.ReactNode; title: string; copy: string; action?: React.ReactNode }) {
  return <section className="domain-empty">{icon}<div><h2>{title}</h2><p>{copy}</p></div>{action}</section>;
}
