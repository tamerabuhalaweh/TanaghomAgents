"use client";

import { Activity, BellRing, Bot, CheckCircle2, CircleAlert, Clock3, Database, Gauge, Link2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { useLocale } from "@/lib/client/use-locale";
import { formatDateTime } from "@/lib/i18n/format";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

type Tone = "success" | "attention" | "danger" | "neutral";
type Lang = "en" | "ar";

interface Health { ok: boolean; components: { api: string; authentication: string; database: string } }
interface Capacity { queue_depth: number; urgent_depth: number; interactive_depth: number; background_depth: number; processing_count: number; dead_letter_count: number; oldest_queue_age_seconds: number; ghl_action_queue_depth: number; ghl_actions_in_flight: number; social_publishing_review: number; max_conversation_concurrency: number; max_model_claims_per_minute: number; max_ghl_action_concurrency: number; max_ghl_actions_per_minute: number; interactive_backlog_threshold: number; queue_age_warning_seconds: number; gemma_blocked_until: string | null; ghl_blocked_until: string | null; capacity_state: string }
interface Monitoring {
  observed_at: string;
  viewer: { role: string; can_manage_notifications: boolean };
  capacity: Capacity;
  notification_delivery: { configured_destinations: number; selected_destinations: number; runtime_ready: boolean; emergency_stop: boolean; reason: string; delivery_ready: boolean; last_configured_at: string | null };
  connections: Array<{ provider: string; status: string; last_tested_at: string | null; last_test_status: string | null; last_error_code: string | null }>;
  agents: Array<{ code: string; name: string; status: string; last_heartbeat_at: string | null; running_jobs: number }>;
  alerts: Array<{ id: string; severity: string; title: string; body: string; created_at: string }>;
  platform_controls: Array<{ provider: string; emergency_stop: boolean; reason: string }>;
}

interface UiCopy {
  pageTitle: string;
  pageDescription: string;
  loadingAria: string;
  unavailableTitle: string;
  unavailableCopy: string;
  retry: string;
  coreAttention: string;
  coreAttentionCopy: string;
  attention: string;
  queued: string;
  replyPriority: string;
  processing: string;
  limit: string;
  oldestWait: string;
  warnAt: string;
  failedTasks: string;
  socialReview: string;
  workload: string;
  urgent: string;
  interactive: string;
  background: string;
  modelClaimLimit: string;
  crmActions: string;
  crmRate: string;
  actionQueue: string;
  alertDelivery: string;
  ready: string;
  locked: string;
  destinations: string;
  protectedRuntime: string;
  disabled: string;
  emergencyControl: string;
  active: string;
  clear: string;
  deliveryReady: string;
  deliveryLocked: string;
  manageDestinations: string;
  dependencies: string;
  applicationApi: string;
  postgres: string;
  authentication: string;
  modelWorker: string;
  crmIntegration: string;
  socialPublishing: string;
  unavailable: string;
  connected: string;
  configured: string;
  notConfigured: string;
  cooldown: string;
  notVerified: string;
  liveHealth: string;
  configSignal: string;
  blockedUntil: string;
  noCooldown: string;
  lastTested: string;
  noConnectionTest: string;
  specialistSignals: string;
  noAgents: string;
  noAgentsCopy: string;
  heartbeat: string;
  running: string;
  noHeartbeat: string;
  openAlerts: string;
  openAlertsCopy: string;
  noAlerts: string;
  noAlertsCopy: string;
  snapshot: string;
  notObserved: string;
  reviewRequired: string;
  reviewRequiredCopy: string;
  states: Record<string, { label: string; copy: string; tone: Tone }>;
}

const copy: Record<Lang, UiCopy> = {
  en: {
    pageTitle: "System monitoring",
    pageDescription: "Capacity, dependencies, alerts, and protected delivery readiness.",
    loadingAria: "Loading system monitoring",
    unavailableTitle: "Monitoring is unavailable",
    unavailableCopy: "Tanaghom could not read the authenticated operational snapshot.",
    retry: "Try again",
    coreAttention: "Core service needs attention",
    coreAttentionCopy: "The live application health endpoint reported an unavailable core component.",
    attention: "Attention",
    queued: "Queued conversations",
    replyPriority: "reply-priority",
    processing: "Processing",
    limit: "limit",
    oldestWait: "Oldest wait",
    warnAt: "warn at",
    failedTasks: "Failed background tasks",
    socialReview: "Social Publishing items need review",
    workload: "Workload capacity",
    urgent: "Urgent",
    interactive: "Interactive",
    background: "Background",
    modelClaimLimit: "AI model claim limit",
    crmActions: "CRM actions",
    crmRate: "CRM rate limit",
    actionQueue: "Action queue",
    alertDelivery: "Alert delivery",
    ready: "Ready",
    locked: "Locked",
    destinations: "Customer destinations",
    protectedRuntime: "Protected runtime",
    disabled: "Disabled",
    emergencyControl: "Emergency control",
    active: "Active",
    clear: "Clear",
    deliveryReady: "Alerts are delivered through the protected runtime.",
    deliveryLocked: "Alert delivery is locked until an operator configures and enables the protected runtime.",
    manageDestinations: "Manage destinations",
    dependencies: "Dependencies",
    applicationApi: "Application API",
    postgres: "PostgreSQL",
    authentication: "Authentication",
    modelWorker: "AI Model Worker",
    crmIntegration: "CRM Integration",
    socialPublishing: "Social Publishing",
    unavailable: "Unavailable",
    connected: "Connected",
    configured: "Configured",
    notConfigured: "Not configured",
    cooldown: "Cooldown",
    notVerified: "Not independently verified",
    liveHealth: "Live health endpoint",
    configSignal: "Configuration signal",
    blockedUntil: "Blocked until",
    noCooldown: "No current cooldown recorded",
    lastTested: "Last tested",
    noConnectionTest: "No connection test recorded",
    specialistSignals: "AI specialist signals",
    noAgents: "No specialist records yet",
    noAgentsCopy: "Runtime status will appear after AI specialists are registered.",
    heartbeat: "Heartbeat",
    running: "running",
    noHeartbeat: "No heartbeat has been recorded",
    openAlerts: "Open alerts",
    openAlertsCopy: "Unread operational notifications scoped to this organization.",
    noAlerts: "No unread operational alerts",
    noAlertsCopy: "Capacity safeguards and dependency states are still shown above even when the alert inbox is clear.",
    snapshot: "Snapshot observed",
    notObserved: "Not observed",
    reviewRequired: "Review required",
    reviewRequiredCopy: "An unknown capacity state was reported.",
    states: {
      normal: { label: "Within limits", copy: "No capacity safeguard is currently active.", tone: "success" },
      dependency_cooldown: { label: "Dependency cooldown", copy: "New claims are paused while a dependency recovers.", tone: "attention" },
      indeterminate_block: { label: "Action blocked", copy: "An uncertain provider action requires reconciliation.", tone: "danger" },
      conversation_saturated: { label: "At concurrency limit", copy: "Processing is using the configured conversation limit.", tone: "attention" },
      protecting_interactive: { label: "Protecting replies", copy: "Interactive work is being prioritized over background work.", tone: "attention" },
      queue_age_warning: { label: "Queue age warning", copy: "The oldest queued conversation exceeded the warning threshold.", tone: "attention" },
    },
  },
  ar: {
    pageTitle: "مراقبة النظام",
    pageDescription: "السعة والاعتماديات والتنبيهات وجاهزية التسليم المحمي.",
    loadingAria: "جارٍ تحميل مراقبة النظام",
    unavailableTitle: "المراقبة غير متاحة",
    unavailableCopy: "تعذّر على تناغم قراءة اللقطة التشغيلية الموثّقة.",
    retry: "حاول مرة أخرى",
    coreAttention: "الخدمة الأساسية تحتاج إلى انتباه",
    coreAttentionCopy: "أبلغ فحص صحة التطبيق المباشر عن مكوّن أساسي غير متاح.",
    attention: "انتباه",
    queued: "المحادثات في الانتظار",
    replyPriority: "ذات أولوية رد",
    processing: "قيد المعالجة",
    limit: "الحد",
    oldestWait: "أطول انتظار",
    warnAt: "تنبيه عند",
    failedTasks: "المهام الخلفية الفاشلة",
    socialReview: "عنصر نشر اجتماعي يحتاج إلى مراجعة",
    workload: "سعة العمل",
    urgent: "عاجل",
    interactive: "تفاعلي",
    background: "خلفي",
    modelClaimLimit: "حد طلبات نموذج الذكاء الاصطناعي",
    crmActions: "إجراءات إدارة العملاء",
    crmRate: "حد معدل إدارة العملاء",
    actionQueue: "قائمة الإجراءات",
    alertDelivery: "تسليم التنبيهات",
    ready: "جاهز",
    locked: "مقفل",
    destinations: "وجهات العملاء",
    protectedRuntime: "التشغيل المحمي",
    disabled: "معطّل",
    emergencyControl: "التحكم الطارئ",
    active: "نشط",
    clear: "سليم",
    deliveryReady: "تُسلَّم التنبيهات عبر التشغيل المحمي.",
    deliveryLocked: "تسليم التنبيهات مقفل حتى يهيّئ مشغّل النظام التشغيل المحمي ويفعّله.",
    manageDestinations: "إدارة الوجهات",
    dependencies: "الاعتماديات",
    applicationApi: "واجهة التطبيق",
    postgres: "قاعدة بيانات PostgreSQL",
    authentication: "المصادقة",
    modelWorker: "عامل نموذج الذكاء الاصطناعي",
    crmIntegration: "تكامل إدارة العملاء",
    socialPublishing: "النشر الاجتماعي",
    unavailable: "غير متاح",
    connected: "متصل",
    configured: "مهيّأ",
    notConfigured: "غير مهيّأ",
    cooldown: "فترة تهدئة",
    notVerified: "غير مُتحقَّق منه بشكل مستقل",
    liveHealth: "فحص الصحة المباشر",
    configSignal: "إشارة التهيئة",
    blockedUntil: "محظور حتى",
    noCooldown: "لا توجد فترة تهدئة مسجلة حالياً",
    lastTested: "آخر اختبار",
    noConnectionTest: "لا يوجد سجل لاختبار الاتصال",
    specialistSignals: "إشارات المختصين",
    noAgents: "لا توجد سجلات مختصين بعد",
    noAgentsCopy: "ستظهر حالة التشغيل بعد تسجيل مختصي الذكاء الاصطناعي.",
    heartbeat: "نبضة",
    running: "قيد التشغيل",
    noHeartbeat: "لم تُسجَّل أي نبضة",
    openAlerts: "التنبيهات المفتوحة",
    openAlertsCopy: "إشعارات تشغيلية غير مقروءة خاصة بهذه المؤسسة.",
    noAlerts: "لا تنبيهات تشغيلية غير مقروءة",
    noAlertsCopy: "تظل ضمانات السعة وحالات الاعتماديات معروضة أعلاه حتى عندما يكون صندوق التنبيهات فارغاً.",
    snapshot: "لوحة الحالة ملاحظة",
    notObserved: "لم تُلاحظ",
    reviewRequired: "مراجعة مطلوبة",
    reviewRequiredCopy: "أُبلغت حالة سعة غير معروفة.",
    states: {
      normal: { label: "ضمن الحدود", copy: "لا يوجد ضمان سعة نشط حالياً.", tone: "success" },
      dependency_cooldown: { label: "تهدئة اعتمادية", copy: "تُوقف الطلبات الجديدة مؤقتاً حتى تتعافى إحدى الاعتماديات.", tone: "attention" },
      indeterminate_block: { label: "إجراء محظور", copy: "يحتاج إجراء مزوّد غير مؤكد إلى تسوية.", tone: "danger" },
      conversation_saturated: { label: "عند حد التزامن", copy: "تستخدم المعالجة حد المحادثات المهيّأ بالكامل.", tone: "attention" },
      protecting_interactive: { label: "حماية الردود", copy: "تُمنح الأعمال التفاعلية أولوية على الأعمال الخلفية.", tone: "attention" },
      queue_age_warning: { label: "تحذير عمر القائمة", copy: "تجاوزت أقدم محادثة في الانتظار حد التحذير.", tone: "attention" },
    },
  },
};

function date(value: string | null, lang: Lang, notObserved: string) {
  return value ? formatDateTime(value, lang) : notObserved;
}
function duration(seconds: number) { if (seconds < 60) return `${seconds}s`; if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`; return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`; }
function toneForSeverity(severity: string): Tone { return severity === "critical" || severity === "error" ? "danger" : severity === "warning" ? "attention" : "neutral"; }
function severityLabel(severity: string, lang: Lang) {
  const labels: Record<string, [string, string]> = {
    critical: ["Critical", "حرج"], error: ["Error", "خطأ"], warning: ["Warning", "تحذير"], info: ["Info", "معلومة"],
  };
  return labels[severity]?.[lang === "ar" ? 1 : 0] ?? severity;
}
function agentStatus(status: string, lang: Lang) {
  const labels: Record<string, [string, string]> = {
    active: ["Active", "نشط"], working: ["Working", "يعمل"], idle: ["Idle", "خامل"],
    failed: ["Needs attention", "يحتاج انتباه"], blocked: ["Blocked", "محظور"],
  };
  return labels[status]?.[lang === "ar" ? 1 : 0] ?? status.replaceAll("_", " ");
}

export function SystemView() {
  const { locale } = useLocale();
  const lang: Lang = locale === "ar" ? "ar" : "en";
  const text = copy[lang];
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [health, setHealth] = useState<Health | null>(null);
  const [monitoring, setMonitoring] = useState<Monitoring | null>(null);
  const load = useCallback(async () => {
    setState("loading");
    try {
      const [healthResponse, monitoringResponse] = await Promise.all([
        fetch("/api/health", { cache: "no-store" }),
        authenticatedFetch("/api/system/monitoring", { cache: "no-store" }),
      ]);
      if (!healthResponse.ok || !monitoringResponse.ok) throw new Error("monitoring_unavailable");
      setHealth(await healthResponse.json() as Health);
      setMonitoring(await monitoringResponse.json() as Monitoring);
      setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="page-stack"><PageHeading title={text.pageTitle} description={text.pageDescription} /><MonitoringLoading label={text.loadingAria} /></div>;
  if (state === "error" || !health || !monitoring) return <div className="page-stack"><PageHeading title={text.pageTitle} description={text.pageDescription} /><section className="settings-state"><CircleAlert size={24} /><div><h2>{text.unavailableTitle}</h2><p>{text.unavailableCopy}</p></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} />{text.retry}</button></section></div>;

  const capacityState = text.states[monitoring.capacity.capacity_state] || { label: text.reviewRequired, copy: text.reviewRequiredCopy, tone: "attention" as Tone };
  const coreReady = health.ok;
  return <div className="page-stack system-monitoring-page">
    <PageHeading title={text.pageTitle} description={text.pageDescription} />
    <section className={`monitoring-summary ${coreReady && capacityState.tone === "success" ? "" : "monitoring-summary-attention"}`}>
      {coreReady && capacityState.tone === "success" ? <CheckCircle2 size={22} /> : <CircleAlert size={22} />}
      <div><strong>{coreReady ? capacityState.label : text.coreAttention}</strong><p>{coreReady ? capacityState.copy : text.coreAttentionCopy}</p></div>
      <StatusPill tone={coreReady ? capacityState.tone : "danger"}>{coreReady ? capacityState.label : text.attention}</StatusPill>
    </section>
    <dl className="monitoring-metrics">
      <Metric label={text.queued} value={monitoring.capacity.queue_depth} detail={`${monitoring.capacity.urgent_depth + monitoring.capacity.interactive_depth} ${text.replyPriority}`} />
      <Metric label={text.processing} value={monitoring.capacity.processing_count} detail={`${text.limit} ${monitoring.capacity.max_conversation_concurrency}`} />
      <Metric label={text.oldestWait} value={duration(monitoring.capacity.oldest_queue_age_seconds)} detail={`${text.warnAt} ${duration(monitoring.capacity.queue_age_warning_seconds)}`} />
      <Metric label={text.failedTasks} value={monitoring.capacity.dead_letter_count} detail={`${monitoring.capacity.social_publishing_review} ${text.socialReview}`} />
    </dl>
    <div className="monitoring-grid">
      <CapacityPanel capacity={monitoring.capacity} text={text} lang={lang} />
      <DeliveryPanel monitoring={monitoring} text={text} />
      <DependenciesPanel health={health} monitoring={monitoring} text={text} lang={lang} />
      <AgentPanel agents={monitoring.agents} text={text} lang={lang} />
    </div>
    <section className="monitoring-alerts" aria-labelledby="monitoring-alerts-title">
      <header><div><h2 id="monitoring-alerts-title">{text.openAlerts}</h2><p>{text.openAlertsCopy}</p></div><span>{monitoring.alerts.length}</span></header>
      {monitoring.alerts.length ? <ol>{monitoring.alerts.map((alert) => <li key={alert.id}><span className={`alert-marker alert-marker-${toneForSeverity(alert.severity)}`}><CircleAlert size={16} /></span><div><strong>{alert.title}</strong><p>{alert.body}</p><time dateTime={alert.created_at}>{date(alert.created_at, lang, text.notObserved)}</time></div><StatusPill tone={toneForSeverity(alert.severity)}>{severityLabel(alert.severity, lang)}</StatusPill></li>)}</ol> : <div className="monitoring-empty"><BellRing size={22} /><div><strong>{text.noAlerts}</strong><p>{text.noAlertsCopy}</p></div></div>}
    </section>
    <p className="monitoring-observed"><Clock3 size={14} /> {text.snapshot} {date(monitoring.observed_at, lang, text.notObserved)}.</p>
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) { return <div><dt>{label}</dt><dd>{value}</dd><span>{detail}</span></div>; }
function CapacityPanel({ capacity, text, lang }: { capacity: Capacity; text: UiCopy; lang: Lang }) {
  const state = text.states[capacity.capacity_state] || { label: text.reviewRequired, tone: "attention" as Tone };
  const total = Math.max(1, capacity.queue_depth);
  return <section className="monitoring-panel capacity-panel"><header><div><Gauge size={18} /><h2>{text.workload}</h2></div><StatusPill tone={state.tone}>{state.label}</StatusPill></header><div className="capacity-breakdown"><CapacityBar label={text.urgent} value={capacity.urgent_depth} total={total} className="capacity-urgent" /><CapacityBar label={text.interactive} value={capacity.interactive_depth} total={total} className="capacity-interactive" /><CapacityBar label={text.background} value={capacity.background_depth} total={total} className="capacity-background" /></div><dl className="panel-facts"><div><dt>{text.modelClaimLimit}</dt><dd>{capacity.max_model_claims_per_minute}/min</dd></div><div><dt>{text.crmActions}</dt><dd>{capacity.ghl_actions_in_flight}/{capacity.max_ghl_action_concurrency}</dd></div><div><dt>{text.crmRate}</dt><dd>{capacity.max_ghl_actions_per_minute}/min</dd></div><div><dt>{text.actionQueue}</dt><dd>{capacity.ghl_action_queue_depth}</dd></div></dl></section>;
}
function CapacityBar({ label, value, total, className }: { label: string; value: number; total: number; className: string }) { return <div><span><strong>{label}</strong><b>{value}</b></span><i><em className={className} style={{ width: `${Math.max(value ? 4 : 0, Math.min(100, value / total * 100))}%` }} /></i></div>; }
function DeliveryPanel({ monitoring, text }: { monitoring: Monitoring; text: UiCopy }) {
  const delivery = monitoring.notification_delivery;
  return <section className="monitoring-panel"><header><div><BellRing size={18} /><h2>{text.alertDelivery}</h2></div><StatusPill tone={delivery.delivery_ready ? "success" : "attention"}>{delivery.delivery_ready ? text.ready : text.locked}</StatusPill></header><p className="panel-copy">{delivery.delivery_ready ? text.deliveryReady : text.deliveryLocked}</p><ul className="compact-status-list"><li><span className={delivery.selected_destinations > 0 ? "status-dot-ready" : "status-dot-muted"} />{text.destinations} <strong>{delivery.selected_destinations}</strong></li><li><span className={delivery.runtime_ready ? "status-dot-ready" : "status-dot-muted"} />{text.protectedRuntime} <strong>{delivery.runtime_ready ? text.ready : text.disabled}</strong></li><li><span className={!delivery.emergency_stop ? "status-dot-ready" : "status-dot-warning"} />{text.emergencyControl} <strong>{delivery.emergency_stop ? text.active : text.clear}</strong></li></ul>{monitoring.viewer.can_manage_notifications ? <Link className="panel-link" href="/settings/notifications">{text.manageDestinations} <Link2 size={15} /></Link> : null}</section>;
}
function DependenciesPanel({ health, monitoring, text, lang }: { health: Health; monitoring: Monitoring; text: UiCopy; lang: Lang }) {
  const connection = (provider: string) => monitoring.connections.find((item) => item.provider === provider);
  const modelBlocked = monitoring.capacity.gemma_blocked_until && new Date(monitoring.capacity.gemma_blocked_until) > new Date();
  const rows: Array<[string, string, Tone, string]> = [
    [text.applicationApi, health.components.api === "ready" ? text.ready : text.unavailable, health.components.api === "ready" ? "success" : "danger", text.liveHealth],
    [text.postgres, health.components.database === "connected" ? text.connected : text.unavailable, health.components.database === "connected" ? "success" : "danger", text.liveHealth],
    [text.authentication, health.components.authentication === "configured" ? text.configured : text.notConfigured, health.components.authentication === "configured" ? "success" : "attention", text.configSignal],
    [text.modelWorker, modelBlocked ? text.cooldown : text.notVerified, modelBlocked ? "attention" : "neutral", modelBlocked ? `${text.blockedUntil} ${date(monitoring.capacity.gemma_blocked_until, lang, text.notObserved)}` : text.noCooldown],
    [text.socialPublishing, connection("postiz")?.status || text.notConfigured, connection("postiz")?.status === "connected" ? "success" : "neutral", connection("postiz")?.last_tested_at ? `${text.lastTested} ${date(connection("postiz")?.last_tested_at || null, lang, text.notObserved)}` : text.noConnectionTest],
    [text.crmIntegration, connection("ghl")?.status || text.notConfigured, connection("ghl")?.status === "connected" ? "success" : "neutral", connection("ghl")?.last_tested_at ? `${text.lastTested} ${date(connection("ghl")?.last_tested_at || null, lang, text.notObserved)}` : text.noConnectionTest],
  ];
  return <section className="monitoring-panel monitoring-dependencies"><header><div><Database size={18} /><h2>{text.dependencies}</h2></div></header><div>{rows.map(([name, status, tone, evidence]) => <article key={name}><span><strong>{name}</strong><small>{evidence}</small></span><StatusPill tone={tone}>{status}</StatusPill></article>)}</div></section>;
}
function AgentPanel({ agents, text, lang }: { agents: Monitoring["agents"]; text: UiCopy; lang: Lang }) {
  return <section className="monitoring-panel monitoring-agents"><header><div><Bot size={18} /><h2>{text.specialistSignals}</h2></div><span>{agents.length}</span></header>{agents.length ? <div>{agents.map((agent) => {
    const observed = Boolean(agent.last_heartbeat_at);
    const label = observed ? agentStatus(agent.status, lang) : text.notVerified;
    const tone: Tone = agent.status === "failed" || agent.status === "blocked" ? "danger" : agent.status === "working" ? "success" : "neutral";
    return <article key={agent.code}><span><strong>{agent.name}</strong><small>{observed ? `${text.heartbeat} ${date(agent.last_heartbeat_at, lang, text.notObserved)} · ${agent.running_jobs} ${text.running}` : text.noHeartbeat}</small></span><StatusPill tone={observed ? tone : "neutral"}>{label}</StatusPill></article>;
  })}</div> : <div className="monitoring-empty compact-empty"><Activity size={19} /><div><strong>{text.noAgents}</strong><p>{text.noAgentsCopy}</p></div></div>}</section>;
}
function MonitoringLoading({ label }: { label: string }) { return <div className="monitoring-loading" aria-label={label}><span className="state-skeleton" /><div><span className="state-skeleton" /><span className="state-skeleton" /><span className="state-skeleton" /><span className="state-skeleton" /></div><section><span className="state-skeleton" /><span className="state-skeleton" /></section></div>; }
