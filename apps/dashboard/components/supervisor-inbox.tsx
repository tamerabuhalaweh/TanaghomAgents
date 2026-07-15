"use client";

import {
  AlertOctagon, ArrowRightLeft, Bot, CheckCircle2, CircleAlert, Clock3,
  FileText, Hand, Languages, MessageSquareText, Pause, RefreshCw, Search,
  ShieldAlert, ShieldCheck, UserRound, UsersRound, WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import type { Tone } from "@/data/fixtures";

type ConversationState = "queued" | "ai_owned" | "awaiting_approval" | "human_required" | "human_owned" | "paused" | "resolved" | "failed";
type Role = "owner" | "reviewer" | "operator" | "viewer";
type Action = "takeover" | "assign" | "reassign" | "pause" | "resolve" | "resume_ai";

interface Conversation {
  id: string; provider_conversation_id: string; contact_id: string | null;
  lead_name: string | null; campaign_name: string | null; state: ConversationState;
  reply_authority: "none" | "ai" | "human"; assigned_user_id: string | null;
  assigned_user_name: string | null; owner_user_id: string | null; owner_user_name: string | null;
  ownership_epoch: number; ownership_reason: string | null; emergency_paused: boolean;
  priority: "low" | "normal" | "high" | "urgent"; sla_due_at: string; sla_breached: boolean;
  age_seconds: number; language: "en" | "ar" | null; intent: string | null;
  risk_categories: string[]; pipeline_stage: string | null; qualification_state: Record<string, unknown>;
  handoff_summary: string | null; unresolved_questions: unknown[]; suggested_response: string | null;
  last_activity_at: string; conversation_version: number; updated_at: string;
}

interface InboxPayload {
  conversations: Conversation[];
  assignees: Array<{ id: string; display_name: string; role: Role }>;
  current_user: { id: string; name: string; role: Role };
  policy: null | { conversation_emergency_stop: boolean; conversation_emergency_reason: string; conversation_emergency_changed_at: string | null; conversation_processing_mode: string };
  unread_notifications: number; snapshot_at: string; stale_after_seconds: number;
}

interface TimelineItem { id: string; at: string; kind: "message" | "proposal" | "ownership" | "human_draft" | "operation"; [key: string]: unknown }
interface DetailPayload { conversation: Conversation; timeline: TimelineItem[]; snapshot_at: string; current_user: { id: string; role: Role } }

const stateLabels: Record<ConversationState, string> = {
  queued: "Queued", ai_owned: "AI owned", awaiting_approval: "Awaiting approval",
  human_required: "Human required", human_owned: "Human owned", paused: "Paused",
  resolved: "Resolved", failed: "Failed",
};
const stateTones: Record<ConversationState, Tone> = {
  queued: "neutral", ai_owned: "working", awaiting_approval: "attention",
  human_required: "danger", human_owned: "success", paused: "neutral",
  resolved: "success", failed: "danger",
};

function elapsed(seconds: number) {
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
function title(conversation: Conversation) {
  return conversation.lead_name || conversation.contact_id || `Conversation ${conversation.provider_conversation_id.slice(-8)}`;
}
function uuid() { return crypto.randomUUID(); }

export function SupervisorInbox() {
  const [payload, setPayload] = useState<InboxPayload | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [filter, setFilter] = useState<ConversationState | "open" | "all" | "mine">("open");
  const [query, setQuery] = useState("");
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [feedback, setFeedback] = useState("");

  const loadInbox = useCallback(async (preserveSelection = true) => {
    setLoadState("loading");
    try {
      const response = await authenticatedFetch("/api/conversations");
      if (response.status === 403) { setLoadState("forbidden"); return; }
      if (!response.ok) throw new Error("inbox_load_failed");
      const next = await response.json() as InboxPayload;
      setPayload(next); setLoadState("ready");
      setSelectedId((current) => preserveSelection && current && next.conversations.some((item) => item.id === current)
        ? current : next.conversations[0]?.id || null);
    } catch { setLoadState("error"); }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailState("loading");
    try {
      const response = await authenticatedFetch(`/api/conversations/${id}`);
      if (!response.ok) throw new Error("detail_load_failed");
      setDetail(await response.json() as DetailPayload); setDetailState("ready");
    } catch { setDetailState("error"); }
  }, []);

  useEffect(() => { void loadInbox(false); }, [loadInbox]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); else setDetail(null); }, [loadDetail, selectedId]);
  useEffect(() => {
    setOnline(navigator.onLine);
    const connected = () => { setOnline(true); void loadInbox(); };
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected); window.addEventListener("offline", disconnected);
    const clock = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => { window.removeEventListener("online", connected); window.removeEventListener("offline", disconnected); window.clearInterval(clock); };
  }, [loadInbox]);

  const stale = payload ? now - new Date(payload.snapshot_at).getTime() > payload.stale_after_seconds * 1000 : false;
  const visible = useMemo(() => (payload?.conversations || []).filter((conversation) => {
    if (filter === "open" && conversation.state === "resolved") return false;
    if (filter === "mine" && conversation.assigned_user_id !== payload?.current_user.id) return false;
    if (!(["open", "all", "mine"] as string[]).includes(filter) && conversation.state !== filter) return false;
    const text = `${title(conversation)} ${conversation.campaign_name || ""} ${conversation.intent || ""}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  }), [filter, payload, query]);
  const summary = useMemo(() => ({
    urgent: payload?.conversations.filter((item) => item.priority === "urgent").length || 0,
    breached: payload?.conversations.filter((item) => item.sla_breached && item.state !== "resolved").length || 0,
    human: payload?.conversations.filter((item) => ["human_required", "human_owned"].includes(item.state)).length || 0,
    mine: payload?.conversations.filter((item) => item.assigned_user_id === payload.current_user.id && item.state !== "resolved").length || 0,
  }), [payload]);

  async function refreshAll() {
    setFeedback(""); await loadInbox(); if (selectedId) await loadDetail(selectedId);
  }

  return <div className="page-stack supervisor-page">
    <PageHeading title="Supervisor inbox" description="One reply owner at a time. Review urgent handoffs, take control, and return conversations to AI only through an explicit audited action."
      actions={<button className="secondary-button" type="button" disabled={!online} onClick={() => void refreshAll()}><RefreshCw size={16} /> Refresh</button>} />

    {!online ? <SupervisorState icon={<WifiOff />} title="You are offline" copy="Conversation data may be outdated. Mutating actions are disabled until the connection returns." tone="warning" /> : null}
    {online && stale ? <section className="stale-data-banner" role="status"><Clock3 size={18} /><div><strong>Inbox snapshot is stale</strong><p>Refresh before taking ownership so another supervisor’s newer action is not overwritten.</p></div><button className="secondary-button compact-button" type="button" onClick={() => void refreshAll()}>Refresh now</button></section> : null}
    {loadState === "loading" && !payload ? <SupervisorLoading /> : null}
    {loadState === "forbidden" ? <SupervisorState icon={<ShieldAlert />} title="Supervisor access unavailable" copy="Your role does not allow access to organization conversations." /> : null}
    {loadState === "error" ? <SupervisorState icon={<CircleAlert />} title="Inbox unavailable" copy="Tanaghom could not load the protected supervisor queue." action={<button className="secondary-button" type="button" onClick={() => void loadInbox(false)}>Try again</button>} /> : null}

    {payload ? <>
      <section className={`conversation-safety ${payload.policy?.conversation_emergency_stop ? "conversation-safety-stopped" : ""}`} aria-label="Conversation safety controls">
        {payload.policy?.conversation_emergency_stop ? <AlertOctagon size={21} /> : <ShieldCheck size={21} />}
        <div><strong>{payload.policy?.conversation_emergency_stop ? "Organization emergency stop is active" : "Reply authority is locked"}</strong><p>{payload.policy?.conversation_emergency_stop ? payload.policy.conversation_emergency_reason : "Queued AI work must revalidate its lease immediately before any future provider dispatch."}</p></div>
        {payload.current_user.role === "owner" ? <EmergencyControl active={Boolean(payload.policy?.conversation_emergency_stop)} disabled={!online || stale} onChanged={refreshAll} /> : <StatusPill tone={payload.policy?.conversation_emergency_stop ? "danger" : "success"}>{payload.policy?.conversation_emergency_stop ? "Stopped" : "Protected"}</StatusPill>}
      </section>

      <dl className="supervisor-summary" aria-label="Supervisor queue summary">
        <div><dt>Urgent</dt><dd>{summary.urgent}</dd><span>highest priority</span></div>
        <div><dt>SLA breached</dt><dd>{summary.breached}</dd><span>needs action now</span></div>
        <div><dt>Human queue</dt><dd>{summary.human}</dd><span>required or owned</span></div>
        <div><dt>Assigned to me</dt><dd>{summary.mine}</dd><span>{payload.current_user.name}</span></div>
      </dl>

      <section className="supervisor-workspace" aria-label="Conversation supervisor workspace">
        <aside className="conversation-queue">
          <header><div><h2>Conversations</h2><p>{visible.length} shown · {payload.unread_notifications} unread alerts</p></div></header>
          <div className="conversation-filters">
            <label className="conversation-search"><Search size={15} /><span className="sr-only">Search conversations</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, campaign, intent" /></label>
            <label><span className="sr-only">Filter conversation state</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="open">Open</option><option value="mine">Assigned to me</option><option value="human_required">Human required</option><option value="human_owned">Human owned</option><option value="awaiting_approval">Awaiting approval</option><option value="ai_owned">AI owned</option><option value="paused">Paused</option><option value="failed">Failed</option><option value="resolved">Resolved</option><option value="all">All</option></select></label>
          </div>
          {visible.length ? <div className="conversation-list">{visible.map((conversation) => <button key={conversation.id} type="button" className={`conversation-list-item ${selectedId === conversation.id ? "conversation-list-item-active" : ""}`} onClick={() => setSelectedId(conversation.id)}>
            <span className={`priority-marker priority-${conversation.priority}`} aria-label={`${conversation.priority} priority`} />
            <span className="conversation-list-copy"><span><strong>{title(conversation)}</strong><time>{elapsed(Number(conversation.age_seconds) + Math.floor((now - new Date(payload.snapshot_at).getTime()) / 1000))}</time></span><small>{conversation.intent?.replaceAll("_", " ") || "Unclassified"} · {conversation.language === "ar" ? "العربية" : "English"}</small><span><StatusPill tone={stateTones[conversation.state]}>{stateLabels[conversation.state]}</StatusPill>{conversation.sla_breached ? <em>SLA breached</em> : null}</span></span>
          </button>)}</div> : <div className="conversation-list-empty"><MessageSquareText size={21} /><strong>No conversations match</strong><p>Adjust the state filter or search query.</p></div>}
        </aside>

        <div className="conversation-detail">
          {!selectedId ? <SupervisorState icon={<MessageSquareText />} title="Select a conversation" copy="Choose a queue item to inspect its handoff and ownership timeline." /> : null}
          {detailState === "loading" ? <DetailLoading /> : null}
          {detailState === "error" ? <SupervisorState icon={<CircleAlert />} title="Conversation unavailable" copy="This detail may have changed or your access may have been removed." action={<button className="secondary-button" type="button" onClick={() => selectedId && void loadDetail(selectedId)}>Try again</button>} /> : null}
          {detailState === "ready" && detail ? <ConversationDetail payload={payload} detail={detail} disabled={!online || stale} onChanged={refreshAll} feedback={feedback} setFeedback={setFeedback} /> : null}
        </div>
      </section>
    </> : null}
  </div>;
}

function ConversationDetail({ payload, detail, disabled, onChanged, feedback, setFeedback }: { payload: InboxPayload; detail: DetailPayload; disabled: boolean; onChanged: () => Promise<void>; feedback: string; setFeedback: (value: string) => void }) {
  const conversation = detail.conversation;
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [assignee, setAssignee] = useState(payload.current_user.id);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState(conversation.suggested_response || "");
  const [error, setError] = useState("");
  const canMutate = payload.current_user.role !== "viewer";
  const owns = conversation.owner_user_id === payload.current_user.id && conversation.state === "human_owned";
  const canAdmin = ["owner", "operator"].includes(payload.current_user.role);

  useEffect(() => { setAction(null); setReason(""); setReply(conversation.suggested_response || ""); setError(""); }, [conversation.id, conversation.suggested_response]);

  async function submitAction() {
    if (!action || reason.trim().length < 3) return;
    setBusy(true); setError(""); setFeedback("");
    try {
      const response = await authenticatedFetch(`/api/conversations/${conversation.id}/transition`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason, assignee_id: ["assign", "reassign"].includes(action) ? assignee : undefined,
          expected_version: conversation.conversation_version, command_id: uuid() }),
      });
      if (response.status === 409) throw new Error("This conversation changed elsewhere. Refresh and review its current owner before trying again.");
      if (!response.ok) throw new Error("The ownership action was rejected by the protected state machine.");
      setFeedback(action === "resume_ai" ? "Conversation returned to AI control. A new lease is still required before any future dispatch." : "Conversation ownership updated and recorded.");
      setAction(null); setReason(""); await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The conversation could not be updated."); }
    finally { setBusy(false); }
  }

  async function saveReply() {
    if (!reply.trim()) return;
    setBusy(true); setError(""); setFeedback("");
    try {
      const response = await authenticatedFetch(`/api/conversations/${conversation.id}/reply-draft`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply, language: conversation.language || "en", expected_epoch: conversation.ownership_epoch, command_id: uuid() }),
      });
      if (!response.ok) throw new Error("Reply authority changed. Refresh before saving another supervised draft.");
      setFeedback("Supervised reply saved as a draft. Nothing was sent to GHL."); await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The reply draft could not be saved."); }
    finally { setBusy(false); }
  }

  const actions: Array<{ action: Action; label: string; icon: React.ReactNode }> = [];
  if (canMutate && conversation.state !== "resolved" && !owns) actions.push({ action: "takeover", label: "Take over", icon: <Hand size={15} /> });
  if (canAdmin && conversation.state !== "resolved") actions.push({ action: conversation.state === "human_owned" ? "reassign" : "assign", label: "Assign", icon: <UsersRound size={15} /> });
  if (canAdmin && !["paused", "resolved"].includes(conversation.state)) actions.push({ action: "pause", label: "Pause", icon: <Pause size={15} /> });
  if (canAdmin && ["human_owned", "paused", "failed", "awaiting_approval", "human_required"].includes(conversation.state)) actions.push({ action: "resume_ai", label: "Return to AI", icon: <Bot size={15} /> });
  if (canMutate && conversation.state !== "resolved") actions.push({ action: "resolve", label: "Resolve", icon: <CheckCircle2 size={15} /> });

  return <div className="conversation-detail-stack" dir={conversation.language === "ar" ? "rtl" : "ltr"}>
    <header className="conversation-detail-header">
      <div><div className="conversation-detail-title"><span className={`priority-marker priority-${conversation.priority}`} /><h2>{title(conversation)}</h2><StatusPill tone={stateTones[conversation.state]}>{stateLabels[conversation.state]}</StatusPill></div><p>{conversation.campaign_name || "No campaign linked"} · {conversation.pipeline_stage || "Pipeline stage unavailable"}</p></div>
      <div className="conversation-owner"><UserRound size={17} /><span><small>Reply owner</small><strong>{conversation.owner_user_name || (conversation.reply_authority === "ai" ? "Tanaghom AI" : "No actor")}</strong></span></div>
    </header>

    <section className="handoff-brief" aria-labelledby="handoff-title"><header><div><h3 id="handoff-title">Handoff brief</h3><p>AI context for the human supervisor—not a sent response.</p></div><Languages size={18} /></header><p>{conversation.handoff_summary || "No AI handoff summary is available yet."}</p><dl><div><dt>Intent</dt><dd>{conversation.intent?.replaceAll("_", " ") || "Unknown"}</dd></div><div><dt>Priority</dt><dd>{conversation.priority}</dd></div><div><dt>Language</dt><dd>{conversation.language === "ar" ? "العربية" : "English"}</dd></div><div><dt>Risk</dt><dd>{conversation.risk_categories.filter((risk) => risk !== "none").join(", ") || "None detected"}</dd></div></dl>{conversation.suggested_response ? <blockquote><strong>Suggested response</strong><p>{conversation.suggested_response}</p></blockquote> : null}</section>

    {actions.length ? <section className="ownership-actions" aria-label="Conversation ownership actions"><div>{actions.map((item) => <button key={item.action} className={item.action === "takeover" ? "primary-button compact-button" : "secondary-button compact-button"} type="button" disabled={disabled || busy} onClick={() => { setAction(item.action); setReason(""); }}>{item.icon}{item.label}</button>)}</div>{action ? <div className="ownership-command"><label><span>Reason for {action.replaceAll("_", " ")}</span><input value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={1000} autoFocus placeholder="Record why ownership is changing" /></label>{["assign", "reassign"].includes(action) ? <label><span>Assign to</span><select value={assignee} onChange={(event) => setAssignee(event.target.value)}>{payload.assignees.map((user) => <option key={user.id} value={user.id}>{user.display_name} · {user.role}</option>)}</select></label> : null}<div><button className="primary-button compact-button" type="button" disabled={reason.trim().length < 3 || busy} onClick={() => void submitAction()}>{busy ? "Recording…" : "Confirm action"}</button><button className="ghost-button compact-button" type="button" onClick={() => setAction(null)}>Cancel</button></div></div> : null}</section> : null}

    {owns ? <section className="supervised-reply"><header><div><h3>Supervised reply</h3><p>You hold reply authority for ownership epoch {conversation.ownership_epoch}.</p></div><StatusPill tone="attention">Draft only</StatusPill></header><label><span>Reply text</span><textarea dir={conversation.language === "ar" ? "rtl" : "ltr"} rows={5} maxLength={5000} value={reply} onChange={(event) => setReply(event.target.value)} /></label><footer><p><ShieldCheck size={15} /> Saving records a draft only. GHL delivery begins in Phase 5E after another reviewed safety gate.</p><button className="primary-button" type="button" disabled={disabled || busy || !reply.trim()} onClick={() => void saveReply()}>{busy ? "Saving…" : "Save supervised draft"}</button></footer></section> : null}
    {feedback ? <p className="integration-feedback" role="status" aria-live="polite">{feedback}</p> : null}
    {error ? <p className="conversation-error" role="alert">{error}</p> : null}

    <section className="conversation-timeline" aria-labelledby="timeline-title"><header><div><h3 id="timeline-title">Conversation timeline</h3><p>Provider messages, AI proposals, ownership decisions, drafts, tool operations, and failures.</p></div><span>{detail.timeline.length} events</span></header>{detail.timeline.length ? <ol>{detail.timeline.map((item) => <TimelineEvent key={`${item.kind}-${item.id}`} item={item} language={conversation.language || "en"} />)}</ol> : <div className="conversation-timeline-empty"><FileText size={20} /><p>No timeline events are available.</p></div>}</section>
  </div>;
}

function TimelineEvent({ item, language }: { item: TimelineItem; language: "en" | "ar" }) {
  const at = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.at));
  if (item.kind === "message") return <li><span className="timeline-icon"><MessageSquareText size={16} /></span><article><header><strong>{item.direction === "inbound" ? "Customer message" : "Provider message"}</strong><time>{at}</time></header><p dir={language === "ar" ? "rtl" : "ltr"}>{String(item.body || "Message body unavailable")}</p><small>{String(item.channel)} · {String(item.status)}{item.last_error_code ? ` · ${String(item.last_error_code)}` : ""}</small></article></li>;
  if (item.kind === "proposal") return <li><span className="timeline-icon"><Bot size={16} /></span><article><header><strong>AI response proposal</strong><time>{at}</time></header><p dir={language === "ar" ? "rtl" : "ltr"}>{String(item.proposed_reply || "No approved answer; human review required.")}</p><small>{String(item.intent).replaceAll("_", " ")} · {Math.round(Number(item.confidence) * 100)}% confidence · {Array.isArray(item.citations) ? item.citations.length : 0} sources</small>{item.escalation_required ? <em>{String(item.escalation_reason || "Human escalation required")}</em> : null}</article></li>;
  if (item.kind === "ownership") return <li><span className="timeline-icon"><ArrowRightLeft size={16} /></span><article><header><strong>{String(item.action).replaceAll("_", " ")}</strong><time>{at}</time></header><p>{String(item.reason)}</p><small>{String(item.actor_name || item.actor_role || "System")} · {String(item.previous_state || "none")} → {String(item.new_state)}</small></article></li>;
  if (item.kind === "human_draft") return <li><span className="timeline-icon"><UserRound size={16} /></span><article><header><strong>Supervised reply draft</strong><time>{at}</time></header><p dir={item.language === "ar" ? "rtl" : "ltr"}>{String(item.body)}</p><small>{String(item.author_name)} · not sent</small></article></li>;
  return <li><span className="timeline-icon"><FileText size={16} /></span><article><header><strong>{String(item.operation_type).replaceAll("_", " ")}</strong><time>{at}</time></header><p>{item.error_message ? String(item.error_message) : `Provider operation ${String(item.status)}`}</p><small>{String(item.provider)} · {String(item.status)}</small></article></li>;
}

function EmergencyControl({ active, disabled, onChanged }: { active: boolean; disabled: boolean; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit() { setBusy(true); setError(""); try { const response = await authenticatedFetch("/api/conversations/emergency", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !active, reason, command_id: uuid() }) }); if (!response.ok) throw new Error("Emergency control update was rejected."); setOpen(false); setReason(""); await onChanged(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Emergency control update failed."); } finally { setBusy(false); } }
  return <div className="emergency-control"><button className={active ? "secondary-button compact-button" : "danger-button compact-button"} type="button" disabled={disabled} onClick={() => setOpen((value) => !value)}>{active ? "Review stop" : "Emergency stop"}</button>{open ? <div className="emergency-control-form"><label><span>{active ? "Reason to clear emergency" : "Emergency reason"}</span><input value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} autoFocus /></label><p>{active ? "Clearing the organization stop does not resume individual conversations." : "All active conversation authority and AI leases will be revoked immediately."}</p><div><button className={active ? "primary-button compact-button" : "danger-button compact-button"} type="button" disabled={busy || reason.trim().length < 3} onClick={() => void submit()}>{busy ? "Recording…" : active ? "Clear organization stop" : "Stop all conversations"}</button><button className="ghost-button compact-button" type="button" onClick={() => setOpen(false)}>Cancel</button></div>{error ? <p role="alert">{error}</p> : null}</div> : null}</div>;
}

function SupervisorState({ icon, title, copy, action, tone }: { icon: React.ReactNode; title: string; copy: string; action?: React.ReactNode; tone?: "warning" }) { return <section className={`domain-empty ${tone === "warning" ? "supervisor-warning-state" : ""}`}>{icon}<div><h2>{title}</h2><p>{copy}</p></div>{action}</section>; }
function SupervisorLoading() { return <div className="supervisor-loading" aria-label="Loading supervisor inbox"><div className="state-skeleton" /><div className="state-skeleton" /><div className="state-skeleton" /><div className="state-skeleton" /></div>; }
function DetailLoading() { return <div className="conversation-detail-loading" aria-label="Loading conversation"><div className="state-skeleton" /><div className="state-skeleton" /><div className="state-skeleton" /></div>; }
