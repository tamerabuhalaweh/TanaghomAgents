"use client";

import {
  AlertOctagon, ArrowRightLeft, Bot, CheckCircle2, CircleAlert, Clock3,
  FileText, Hand, Languages, MessageSquareText, Pause, RefreshCw, Search,
  ShieldAlert, ShieldCheck, UserRound, UsersRound, WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { useLocale } from "@/lib/client/use-locale";
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

const stateLabels: Record<ConversationState, { en: string; ar: string }> = {
  queued: { en: "Queued", ar: "في الانتظار" },
  ai_owned: { en: "AI owned", ar: "يملكها الذكاء الاصطناعي" },
  awaiting_approval: { en: "Awaiting approval", ar: "بانتظار الاعتماد" },
  human_required: { en: "Human required", ar: "تحتاج تدخل بشري" },
  human_owned: { en: "Human owned", ar: "يملكها إنسان" },
  paused: { en: "Paused", ar: "متوقفة" },
  resolved: { en: "Resolved", ar: "مغلقة" },
  failed: { en: "Failed", ar: "فاشلة" },
};
const stateTones: Record<ConversationState, Tone> = {
  queued: "neutral", ai_owned: "working", awaiting_approval: "attention",
  human_required: "danger", human_owned: "success", paused: "neutral",
  resolved: "success", failed: "danger",
};

const actionLabels: Record<Action, { en: string; ar: string }> = {
  takeover: { en: "Take over", ar: "تولَّ المحادثة" },
  assign: { en: "Assign", ar: "إسناد" },
  reassign: { en: "Reassign", ar: "إعادة إسناد" },
  pause: { en: "Pause", ar: "إيقاف مؤقت" },
  resolve: { en: "Resolve", ar: "إغلاق" },
  resume_ai: { en: "Return to AI", ar: "إعادة إلى الذكاء الاصطناعي" },
};

function elapsed(seconds: number, ar: boolean) {
  if (seconds < 60) return ar ? "الآن" : "now";
  if (seconds < 3600) return ar ? `${Math.floor(seconds / 60)} د` : `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return ar ? `${Math.floor(seconds / 3600)} س` : `${Math.floor(seconds / 3600)}h`;
  return ar ? `${Math.floor(seconds / 86400)} ي` : `${Math.floor(seconds / 86400)}d`;
}
function title(conversation: Conversation, ar: boolean) {
  return conversation.lead_name || conversation.contact_id || `${ar ? "محادثة" : "Conversation"} ${conversation.provider_conversation_id.slice(-8)}`;
}
function uuid() { return crypto.randomUUID(); }

export function SupervisorInbox() {
  const { locale } = useLocale();
  const ar = locale === "ar";
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
    const text = `${title(conversation, ar)} ${conversation.campaign_name || ""} ${conversation.intent || ""}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  }), [ar, filter, payload, query]);
  const summary = useMemo(() => ({
    urgent: payload?.conversations.filter((item) => item.priority === "urgent").length || 0,
    breached: payload?.conversations.filter((item) => item.sla_breached && item.state !== "resolved").length || 0,
    human: payload?.conversations.filter((item) => ["human_required", "human_owned"].includes(item.state)).length || 0,
    mine: payload?.conversations.filter((item) => item.assigned_user_id === payload.current_user.id && item.state !== "resolved").length || 0,
  }), [payload]);

  // A brand-new workspace starts with the supervised-conversation default
  // reason and no conversations at all. That is not an emergency, so it must
  // not raise the red organization-stop alarm.
  const emergencyStopped = Boolean(payload?.policy?.conversation_emergency_stop);
  const awaitingActivation = emergencyStopped
    && (payload?.policy?.conversation_emergency_reason || "").trim().toLowerCase() === "awaiting supervised conversation activation"
    && (payload?.conversations.length ?? 0) === 0;

  async function refreshAll() {
    setFeedback(""); await loadInbox(); if (selectedId) await loadDetail(selectedId);
  }

  return <div className="page-stack supervisor-page" dir={ar ? "rtl" : "ltr"} lang={locale}>
    <PageHeading
      title={ar ? "صندوق المشرف" : "Supervisor inbox"}
      description={ar
        ? "مسؤول رد واحد في كل مرة. راجع التحويلات العاجلة، وتولَّ المحادثة، وأعدها إلى الذكاء الاصطناعي فقط عبر إجراء مُدقَّق وصريح."
        : "One reply owner at a time. Review urgent handoffs, take control, and return conversations to AI only through an explicit audited action."}
      actions={<button className="secondary-button" type="button" disabled={!online} onClick={() => void refreshAll()}><RefreshCw size={16} /> {ar ? "تحديث" : "Refresh"}</button>} />

    {!online ? <SupervisorState icon={<WifiOff />} title={ar ? "أنت غير متصل" : "You are offline"} copy={ar ? "قد تكون بيانات المحادثات قديمة. تُعطَّل الإجراءات حتى تعود الاتصال." : "Conversation data may be outdated. Mutating actions are disabled until the connection returns."} tone="warning" /> : null}
    {online && stale ? <section className="stale-data-banner" role="status"><Clock3 size={18} /><div><strong>{ar ? "لقطة الصندوق قديمة" : "Inbox snapshot is stale"}</strong><p>{ar ? "حدّث قبل تولّي الملكية حتى لا يتم تجاوز إجراء أحدث لمشرف آخر." : "Refresh before taking ownership so another supervisor’s newer action is not overwritten."}</p></div><button className="secondary-button compact-button" type="button" onClick={() => void refreshAll()}>{ar ? "حدّث الآن" : "Refresh now"}</button></section> : null}
    {loadState === "loading" && !payload ? <SupervisorLoading label={ar ? "جارٍ تحميل صندوق المشرف" : "Loading supervisor inbox"} /> : null}
    {loadState === "forbidden" ? <SupervisorState icon={<ShieldAlert />} title={ar ? "الوصول إلى الإشراف غير متاح" : "Supervisor access unavailable"} copy={ar ? "دورك لا يسمح بالوصول إلى محادثات المؤسسة." : "Your role does not allow access to organization conversations."} /> : null}
    {loadState === "error" ? <SupervisorState icon={<CircleAlert />} title={ar ? "الصندوق غير متاح" : "Inbox unavailable"} copy={ar ? "تعذّر على إعلاني تحميل قائمة المشرف المحمية." : "E3lani could not load the protected supervisor queue."} action={<button className="secondary-button" type="button" onClick={() => void loadInbox(false)}>{ar ? "حاول مرة أخرى" : "Try again"}</button>} /> : null}

    {payload ? <>
      <section className={`conversation-safety ${emergencyStopped && !awaitingActivation ? "conversation-safety-stopped" : ""}`} aria-label={ar ? "أدوات أمان المحادثات" : "Conversation safety controls"}>
        {emergencyStopped && !awaitingActivation ? <AlertOctagon size={21} /> : <ShieldCheck size={21} />}
        <div><strong>{awaitingActivation ? (ar ? "محادثات الإشراف غير مفعّلة بعد" : "Supervised conversations are not activated yet") : emergencyStopped ? (ar ? "إيقاف الطوارئ للمؤسسة مفعّل" : "Organization emergency stop is active") : (ar ? "سلطة الرد مقفلة" : "Reply authority is locked")}</strong><p>{awaitingActivation ? (ar ? "لا تُوجَّه أي محادثات عملاء مباشرة إلى هنا بعد. تبقى الردود التلقائية متوقفة حتى تفعيل محادثات الإشراف." : "No live customer conversations are routed here yet. Automated replies stay paused until supervised conversations are activated.") : emergencyStopped ? payload.policy?.conversation_emergency_reason : (ar ? "يجب على أي عمل في قائمة الانتظار إعادة التحقق من ملكيته مباشرة قبل أي إرسال لاحق." : "Queued AI work must revalidate its lease immediately before any future provider dispatch.")}</p></div>
        {payload.current_user.role === "owner" ? <EmergencyControl active={emergencyStopped} disabled={!online || stale} onChanged={refreshAll} ar={ar} /> : <StatusPill tone={awaitingActivation ? "neutral" : emergencyStopped ? "danger" : "success"}>{awaitingActivation ? (ar ? "غير مفعّل" : "Not activated") : emergencyStopped ? (ar ? "متوقف" : "Stopped") : (ar ? "محمي" : "Protected")}</StatusPill>}
      </section>

      <dl className="supervisor-summary" aria-label={ar ? "ملخص قائمة المشرف" : "Supervisor queue summary"}>
        <div><dt>{ar ? "عاجلة" : "Urgent"}</dt><dd>{summary.urgent}</dd><span>{ar ? "أعلى أولوية" : "highest priority"}</span></div>
        <div><dt>{ar ? "تجاوز المهلة" : "SLA breached"}</dt><dd>{summary.breached}</dd><span>{ar ? "يحتاج إجراءً الآن" : "needs action now"}</span></div>
        <div><dt>{ar ? "قائمة البشر" : "Human queue"}</dt><dd>{summary.human}</dd><span>{ar ? "مطلوب أو مملوك" : "required or owned"}</span></div>
        <div><dt>{ar ? "مسندة إليّ" : "Assigned to me"}</dt><dd>{summary.mine}</dd><span>{payload.current_user.name}</span></div>
      </dl>

      <section className="supervisor-workspace" aria-label={ar ? "مساحة عمل المشرف" : "Conversation supervisor workspace"}>
        <aside className="conversation-queue">
          <header><div><h2>{ar ? "المحادثات" : "Conversations"}</h2><p>{ar ? `${visible.length} معروضة · ${payload.unread_notifications} تنبيهات غير مقروءة` : `${visible.length} shown · ${payload.unread_notifications} unread alerts`}</p></div></header>
          <div className="conversation-filters">
            <label className="conversation-search"><Search size={15} /><span className="sr-only">{ar ? "ابحث في المحادثات" : "Search conversations"}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={ar ? "ابحث بالاسم أو الحملة أو النية" : "Search name, campaign, intent"} /></label>
            <label><span className="sr-only">{ar ? "تصفية حسب حالة المحادثة" : "Filter conversation state"}</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="open">{ar ? "مفتوحة" : "Open"}</option><option value="mine">{ar ? "مسندة إليّ" : "Assigned to me"}</option><option value="human_required">{ar ? "تحتاج تدخل بشري" : "Human required"}</option><option value="human_owned">{ar ? "يملكها إنسان" : "Human owned"}</option><option value="awaiting_approval">{ar ? "بانتظار الاعتماد" : "Awaiting approval"}</option><option value="ai_owned">{ar ? "يملكها الذكاء الاصطناعي" : "AI owned"}</option><option value="paused">{ar ? "متوقفة" : "Paused"}</option><option value="failed">{ar ? "فاشلة" : "Failed"}</option><option value="resolved">{ar ? "مغلقة" : "Resolved"}</option><option value="all">{ar ? "الكل" : "All"}</option></select></label>
          </div>
          {visible.length ? <div className="conversation-list">{visible.map((conversation) => <button key={conversation.id} type="button" className={`conversation-list-item ${selectedId === conversation.id ? "conversation-list-item-active" : ""}`} onClick={() => setSelectedId(conversation.id)}>
            <span className={`priority-marker priority-${conversation.priority}`} aria-label={ar ? `أولوية ${conversation.priority}` : `${conversation.priority} priority`} />
            <span className="conversation-list-copy"><span><strong>{title(conversation, ar)}</strong><time>{elapsed(Number(conversation.age_seconds) + Math.floor((now - new Date(payload.snapshot_at).getTime()) / 1000), ar)}</time></span><small>{conversation.intent?.replaceAll("_", " ") || (ar ? "غير مصنّفة" : "Unclassified")} · {conversation.language === "ar" ? "العربية" : ar ? "الإنجليزية" : "English"}</small><span><StatusPill tone={stateTones[conversation.state]}>{stateLabels[conversation.state][ar ? "ar" : "en"]}</StatusPill>{conversation.sla_breached ? <em>{ar ? "تجاوز المهلة" : "SLA breached"}</em> : null}</span></span>
          </button>)}</div> : <div className="conversation-list-empty"><MessageSquareText size={21} /><strong>{ar ? "لا توجد محادثات مطابقة" : "No conversations match"}</strong><p>{ar ? "عدّل عامل التصفية أو كلمة البحث." : "Adjust the state filter or search query."}</p></div>}
        </aside>

        <div className="conversation-detail">
          {!selectedId ? <SupervisorState icon={<MessageSquareText />} title={ar ? "اختر محادثة" : "Select a conversation"} copy={ar ? "اختر عنصرًا من قائمة الانتظار لفحص تسليمه وخط زمن الملكية." : "Choose a queue item to inspect its handoff and ownership timeline."} /> : null}
          {detailState === "loading" ? <DetailLoading label={ar ? "جارٍ تحميل المحادثة" : "Loading conversation"} /> : null}
          {detailState === "error" ? <SupervisorState icon={<CircleAlert />} title={ar ? "المحادثة غير متاحة" : "Conversation unavailable"} copy={ar ? "قد يكون هذا التفصيل قد تغيّر أو ربما أُزيل وصولك." : "This detail may have changed or your access may have been removed."} action={<button className="secondary-button" type="button" onClick={() => selectedId && void loadDetail(selectedId)}>{ar ? "حاول مرة أخرى" : "Try again"}</button>} /> : null}
          {detailState === "ready" && detail ? <ConversationDetail payload={payload} detail={detail} disabled={!online || stale} onChanged={refreshAll} feedback={feedback} setFeedback={setFeedback} ar={ar} locale={locale} /> : null}
        </div>
      </section>
    </> : null}
  </div>;
}

function ConversationDetail({ payload, detail, disabled, onChanged, feedback, setFeedback, ar, locale }: { payload: InboxPayload; detail: DetailPayload; disabled: boolean; onChanged: () => Promise<void>; feedback: string; setFeedback: (value: string) => void; ar: boolean; locale: "en" | "ar" }) {
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
      if (response.status === 409) throw new Error(ar ? "تغيّرت هذه المحادثة من مكان آخر. حدّث الصفحة وراجع مالكها الحالي قبل المحاولة مرة أخرى." : "This conversation changed elsewhere. Refresh and review its current owner before trying again.");
      if (!response.ok) throw new Error(ar ? "رُفض إجراء الملكية بواسطة آلية الحالات المحمية." : "The ownership action was rejected by the protected state machine.");
      setFeedback(action === "resume_ai" ? (ar ? "أُعيدت المحادثة إلى تحكم الذكاء الاصطناعي. لا يزال مطلوبًا عقد جديد قبل أي إرسال لاحق." : "Conversation returned to AI control. A new lease is still required before any future dispatch.") : (ar ? "حُدّثت ملكية المحادثة وسُجّلت." : "Conversation ownership updated and recorded."));
      setAction(null); setReason(""); await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : (ar ? "تعذّر تحديث المحادثة." : "The conversation could not be updated.")); }
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
      if (!response.ok) throw new Error(ar ? "تغيّرت سلطة الرد. حدّث الصفحة قبل حفظ مسودة أخرى تحت الإشراف." : "Reply authority changed. Refresh before saving another supervised draft.");
      setFeedback(ar ? "حُفظ الرد تحت الإشراف كمسودة. لم يُرسل أي شيء إلى العميل." : "Supervised reply saved as a draft. Nothing was sent to the customer."); await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : (ar ? "تعذّر حفظ مسودة الرد." : "The reply draft could not be saved.")); }
    finally { setBusy(false); }
  }

  const actions: Array<{ action: Action; label: string; icon: React.ReactNode }> = [];
  if (canMutate && conversation.state !== "resolved" && !owns) actions.push({ action: "takeover", label: actionLabels.takeover[ar ? "ar" : "en"], icon: <Hand size={15} /> });
  if (canAdmin && conversation.state !== "resolved") actions.push({ action: conversation.state === "human_owned" ? "reassign" : "assign", label: actionLabels[conversation.state === "human_owned" ? "reassign" : "assign"][ar ? "ar" : "en"], icon: <UsersRound size={15} /> });
  if (canAdmin && !["paused", "resolved"].includes(conversation.state)) actions.push({ action: "pause", label: actionLabels.pause[ar ? "ar" : "en"], icon: <Pause size={15} /> });
  if (canAdmin && ["human_owned", "paused", "failed", "awaiting_approval", "human_required"].includes(conversation.state)) actions.push({ action: "resume_ai", label: actionLabels.resume_ai[ar ? "ar" : "en"], icon: <Bot size={15} /> });
  if (canMutate && conversation.state !== "resolved") actions.push({ action: "resolve", label: actionLabels.resolve[ar ? "ar" : "en"], icon: <CheckCircle2 size={15} /> });

  return <div className="conversation-detail-stack" dir={conversation.language === "ar" ? "rtl" : "ltr"}>
    <header className="conversation-detail-header">
      <div><div className="conversation-detail-title"><span className={`priority-marker priority-${conversation.priority}`} /><h2>{title(conversation, ar)}</h2><StatusPill tone={stateTones[conversation.state]}>{stateLabels[conversation.state][ar ? "ar" : "en"]}</StatusPill></div><p>{conversation.campaign_name || (ar ? "لا حملة مرتبطة" : "No campaign linked")} · {conversation.pipeline_stage || (ar ? "مرحلة المسار غير متاحة" : "Pipeline stage unavailable")}</p></div>
      <div className="conversation-owner"><UserRound size={17} /><span><small>{ar ? "صاحب الرد" : "Reply owner"}</small><strong>{conversation.owner_user_name || (conversation.reply_authority === "ai" ? (ar ? "ذكاء إعلاني" : "E3lani AI") : (ar ? "لا جهة" : "No actor"))}</strong></span></div>
    </header>

    <section className="handoff-brief" aria-labelledby="handoff-title"><header><div><h3 id="handoff-title">{ar ? "ملخص التسليم" : "Handoff brief"}</h3><p>{ar ? "سياق الذكاء الاصطناعي للمشرف البشري — ليس ردًا مرسلًا." : "AI context for the human supervisor—not a sent response."}</p></div><Languages size={18} /></header><p>{conversation.handoff_summary || (ar ? "لا يوجد ملخص تسليم متاح بعد." : "No AI handoff summary is available yet.")}</p><dl><div><dt>{ar ? "النية" : "Intent"}</dt><dd>{conversation.intent?.replaceAll("_", " ") || (ar ? "غير معروفة" : "Unknown")}</dd></div><div><dt>{ar ? "الأولوية" : "Priority"}</dt><dd>{conversation.priority}</dd></div><div><dt>{ar ? "اللغة" : "Language"}</dt><dd>{conversation.language === "ar" ? "العربية" : ar ? "الإنجليزية" : "English"}</dd></div><div><dt>{ar ? "المخاطر" : "Risk"}</dt><dd>{conversation.risk_categories.filter((risk) => risk !== "none").join(", ") || (ar ? "لم تُرصد مخاطر" : "None detected")}</dd></div></dl>{conversation.suggested_response ? <blockquote><strong>{ar ? "رد مقترح" : "Suggested response"}</strong><p>{conversation.suggested_response}</p></blockquote> : null}</section>

    {actions.length ? <section className="ownership-actions" aria-label={ar ? "إجراءات ملكية المحادثة" : "Conversation ownership actions"}><div>{actions.map((item) => <button key={item.action} className={item.action === "takeover" ? "primary-button compact-button" : "secondary-button compact-button"} type="button" disabled={disabled || busy} onClick={() => { setAction(item.action); setReason(""); }}>{item.icon}{item.label}</button>)}</div>{action ? <div className="ownership-command"><label><span>{ar ? `سبب ${actionLabels[action].ar}` : `Reason for ${action.replaceAll("_", " ")}`}</span><input value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={1000} autoFocus placeholder={ar ? "سجّل سبب تغيير الملكية" : "Record why ownership is changing"} /></label>{["assign", "reassign"].includes(action) ? <label><span>{ar ? "إسناد إلى" : "Assign to"}</span><select value={assignee} onChange={(event) => setAssignee(event.target.value)}>{payload.assignees.map((user) => <option key={user.id} value={user.id}>{user.display_name} · {user.role}</option>)}</select></label> : null}<div><button className="primary-button compact-button" type="button" disabled={reason.trim().length < 3 || busy} onClick={() => void submitAction()}>{busy ? (ar ? "جارٍ التسجيل…" : "Recording…") : (ar ? "تأكيد الإجراء" : "Confirm action")}</button><button className="ghost-button compact-button" type="button" onClick={() => setAction(null)}>{ar ? "إلغاء" : "Cancel"}</button></div></div> : null}</section> : null}

    {owns ? <section className="supervised-reply"><header><div><h3>{ar ? "رد تحت الإشراف" : "Supervised reply"}</h3><p>{ar ? `تملك سلطة الرد عن دورة الملكية ${conversation.ownership_epoch}.` : `You hold reply authority for ownership epoch ${conversation.ownership_epoch}.`}</p></div><StatusPill tone="attention">{ar ? "مسودة فقط" : "Draft only"}</StatusPill></header><label><span>{ar ? "نص الرد" : "Reply text"}</span><textarea dir={conversation.language === "ar" ? "rtl" : "ltr"} rows={5} maxLength={5000} value={reply} onChange={(event) => setReply(event.target.value)} /></label><footer><p><ShieldCheck size={15} /> {ar ? "الحفظ يسجّل مسودة فقط. يبدأ التسليم إلى العميل بعد بوابة أمان أخرى تمت مراجعتها." : "Saving records a draft only. Customer delivery begins after another reviewed safety gate."}</p><button className="primary-button" type="button" disabled={disabled || busy || !reply.trim()} onClick={() => void saveReply()}>{busy ? (ar ? "جارٍ الحفظ…" : "Saving…") : (ar ? "حفظ المسودة تحت الإشراف" : "Save supervised draft")}</button></footer></section> : null}
    {feedback ? <p className="integration-feedback" role="status" aria-live="polite">{feedback}</p> : null}
    {error ? <p className="conversation-error" role="alert">{error}</p> : null}

    <section className="conversation-timeline" aria-labelledby="timeline-title"><header><div><h3 id="timeline-title">{ar ? "الخط الزمني للمحادثة" : "Conversation timeline"}</h3><p>{ar ? "رسائل القناة ومقترحات الذكاء الاصطناعي وقرارات الملكية والمسودات والعمليات والفشل." : "Provider messages, AI proposals, ownership decisions, drafts, tool operations, and failures."}</p></div><span>{ar ? `${detail.timeline.length} أحداث` : `${detail.timeline.length} events`}</span></header>{detail.timeline.length ? <ol>{detail.timeline.map((item) => <TimelineEvent key={`${item.kind}-${item.id}`} item={item} language={conversation.language || "en"} ar={ar} locale={locale} />)}</ol> : <div className="conversation-timeline-empty"><FileText size={20} /><p>{ar ? "لا توجد أحداث في الخط الزمني." : "No timeline events are available."}</p></div>}</section>
  </div>;
}

function TimelineEvent({ item, language, ar, locale }: { item: TimelineItem; language: "en" | "ar"; ar: boolean; locale: "en" | "ar" }) {
  const at = new Intl.DateTimeFormat(locale === "ar" ? "ar" : undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.at));
  const rtl = language === "ar";
  if (item.kind === "message") return <li><span className="timeline-icon"><MessageSquareText size={16} /></span><article><header><strong>{item.direction === "inbound" ? (ar ? "رسالة العميل" : "Customer message") : (ar ? "رسالة القناة" : "Provider message")}</strong><time>{at}</time></header><p dir={rtl ? "rtl" : "ltr"}>{String(item.body || (ar ? "نص الرسالة غير متاح" : "Message body unavailable"))}</p><small>{String(item.channel)} · {String(item.status)}{item.last_error_code ? ` · ${String(item.last_error_code)}` : ""}</small></article></li>;
  if (item.kind === "proposal") return <li><span className="timeline-icon"><Bot size={16} /></span><article><header><strong>{ar ? "مقترح رد من الذكاء الاصطناعي" : "AI response proposal"}</strong><time>{at}</time></header><p dir={rtl ? "rtl" : "ltr"}>{String(item.proposed_reply || (ar ? "لا يوجد رد معتمد؛ تلزم مراجعة بشرية." : "No approved answer; human review required."))}</p><small>{String(item.intent).replaceAll("_", " ")} · {Math.round(Number(item.confidence) * 100)}% {ar ? "ثقة" : "confidence"} · {Array.isArray(item.citations) ? item.citations.length : 0} {ar ? "مصادر" : "sources"}</small>{item.escalation_required ? <em>{String(item.escalation_reason || (ar ? "تلزم إحالة بشرية" : "Human escalation required"))}</em> : null}</article></li>;
  if (item.kind === "ownership") return <li><span className="timeline-icon"><ArrowRightLeft size={16} /></span><article><header><strong>{String(item.action).replaceAll("_", " ")}</strong><time>{at}</time></header><p>{String(item.reason)}</p><small>{String(item.actor_name || item.actor_role || (ar ? "النظام" : "System"))} · {String(item.previous_state || (ar ? "لا شيء" : "none"))} → {String(item.new_state)}</small></article></li>;
  if (item.kind === "human_draft") return <li><span className="timeline-icon"><UserRound size={16} /></span><article><header><strong>{ar ? "مسودة رد تحت الإشراف" : "Supervised reply draft"}</strong><time>{at}</time></header><p dir={item.language === "ar" ? "rtl" : "ltr"}>{String(item.body)}</p><small>{String(item.author_name)} · {ar ? "لم تُرسل" : "not sent"}</small></article></li>;
  return <li><span className="timeline-icon"><FileText size={16} /></span><article><header><strong>{String(item.operation_type).replaceAll("_", " ")}</strong><time>{at}</time></header><p>{item.error_message ? String(item.error_message) : (ar ? `عملية القناة ${String(item.status)}` : `Provider operation ${String(item.status)}`)}</p><small>{String(item.provider)} · {String(item.status)}</small></article></li>;
}

function EmergencyControl({ active, disabled, onChanged, ar }: { active: boolean; disabled: boolean; onChanged: () => Promise<void>; ar: boolean }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit() { setBusy(true); setError(""); try { const response = await authenticatedFetch("/api/conversations/emergency", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !active, reason, command_id: uuid() }) }); if (!response.ok) throw new Error(ar ? "رُفض تحديث أداة الطوارئ." : "Emergency control update was rejected."); setOpen(false); setReason(""); await onChanged(); } catch (caught) { setError(caught instanceof Error ? caught.message : (ar ? "فشل تحديث أداة الطوارئ." : "Emergency control update failed.")); } finally { setBusy(false); } }
  return <div className="emergency-control"><button className={active ? "secondary-button compact-button" : "danger-button compact-button"} type="button" disabled={disabled} onClick={() => setOpen((value) => !value)}>{active ? (ar ? "مراجعة الإيقاف" : "Review stop") : (ar ? "إيقاف الطوارئ" : "Emergency stop")}</button>{open ? <div className="emergency-control-form"><label><span>{active ? (ar ? "سبب إلغاء الطوارئ" : "Reason to clear emergency") : (ar ? "سبب الطوارئ" : "Emergency reason")}</span><input value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} autoFocus /></label><p>{active ? (ar ? "إلغاء إيقاف المؤسسة لا يستأنف المحادثات الفردية." : "Clearing the organization stop does not resume individual conversations.") : (ar ? "ستُلغى فورًا جميع سلطات المحادثات النشطة وعقود الذكاء الاصطناعي." : "All active conversation authority and AI leases will be revoked immediately.")}</p><div><button className={active ? "primary-button compact-button" : "danger-button compact-button"} type="button" disabled={busy || reason.trim().length < 3} onClick={() => void submit()}>{busy ? (ar ? "جارٍ التسجيل…" : "Recording…") : active ? (ar ? "إلغاء إيقاف المؤسسة" : "Clear organization stop") : (ar ? "إيقاف كل المحادثات" : "Stop all conversations")}</button><button className="ghost-button compact-button" type="button" onClick={() => setOpen(false)}>{ar ? "إلغاء" : "Cancel"}</button></div>{error ? <p role="alert">{error}</p> : null}</div> : null}</div>;
}

function SupervisorState({ icon, title, copy, action, tone }: { icon: React.ReactNode; title: string; copy: string; action?: React.ReactNode; tone?: "warning" }) { return <section className={`domain-empty ${tone === "warning" ? "supervisor-warning-state" : ""}`}>{icon}<div><h2>{title}</h2><p>{copy}</p></div>{action}</section>; }
function SupervisorLoading({ label }: { label: string }) { return <div className="supervisor-loading" aria-label={label}><div className="state-skeleton" /><div className="state-skeleton" /><div className="state-skeleton" /><div className="state-skeleton" /></div>; }
function DetailLoading({ label }: { label: string }) { return <div className="conversation-detail-loading" aria-label={label}><div className="state-skeleton" /><div className="state-skeleton" /><div className="state-skeleton" /></div>; }
