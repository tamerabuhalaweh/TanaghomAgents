"use client";

import { Activity, BellRing, Bot, CheckCircle2, CircleAlert, Clock3, Database, Gauge, Link2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

type Tone = "success" | "attention" | "danger" | "neutral";

interface Health { ok: boolean; components: { api: string; authentication: string; database: string } }
interface Capacity { queue_depth: number; urgent_depth: number; interactive_depth: number; background_depth: number; processing_count: number; dead_letter_count: number; oldest_queue_age_seconds: number; ghl_action_queue_depth: number; ghl_actions_in_flight: number; indeterminate_actions: number; max_conversation_concurrency: number; max_model_claims_per_minute: number; max_ghl_action_concurrency: number; max_ghl_actions_per_minute: number; interactive_backlog_threshold: number; queue_age_warning_seconds: number; gemma_blocked_until: string | null; ghl_blocked_until: string | null; capacity_state: string }
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

const stateCopy: Record<string, { label: string; copy: string; tone: Tone }> = {
  normal: { label: "Within limits", copy: "No capacity safeguard is currently active.", tone: "success" },
  dependency_cooldown: { label: "Dependency cooldown", copy: "New claims are paused while a dependency recovers.", tone: "attention" },
  indeterminate_block: { label: "Action blocked", copy: "An uncertain provider action requires reconciliation.", tone: "danger" },
  conversation_saturated: { label: "At concurrency limit", copy: "Processing is using the configured conversation limit.", tone: "attention" },
  protecting_interactive: { label: "Protecting replies", copy: "Interactive work is being prioritized over background work.", tone: "attention" },
  queue_age_warning: { label: "Queue age warning", copy: "The oldest queued conversation exceeded the warning threshold.", tone: "attention" },
};

function date(value: string | null) { return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not observed"; }
function duration(seconds: number) { if (seconds < 60) return `${seconds}s`; if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`; return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`; }
function toneForSeverity(severity: string): Tone { return severity === "critical" || severity === "error" ? "danger" : severity === "warning" ? "attention" : "neutral"; }

export function SystemView() {
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
      setHealth(await healthResponse.json() as Health); setMonitoring(await monitoringResponse.json() as Monitoring); setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="page-stack"><PageHeading title="System monitoring" description="Capacity, dependencies, alerts, and protected delivery readiness." /><MonitoringLoading /></div>;
  if (state === "error" || !health || !monitoring) return <div className="page-stack"><PageHeading title="System monitoring" description="Capacity, dependencies, alerts, and protected delivery readiness." /><section className="settings-state"><CircleAlert size={24} /><div><h2>Monitoring is unavailable</h2><p>Tanaghom could not read the authenticated operational snapshot.</p></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} />Try again</button></section></div>;

  const capacityState = stateCopy[monitoring.capacity.capacity_state] || { label: "Review required", copy: "An unknown capacity state was reported.", tone: "attention" as Tone };
  const coreReady = health.ok;
  return <div className="page-stack system-monitoring-page">
    <PageHeading title="System monitoring" description="Capacity, dependencies, alerts, and protected delivery readiness." />
    <section className={`monitoring-summary ${coreReady && capacityState.tone === "success" ? "" : "monitoring-summary-attention"}`}>
      {coreReady && capacityState.tone === "success" ? <CheckCircle2 size={22} /> : <CircleAlert size={22} />}
      <div><strong>{coreReady ? capacityState.label : "Core service needs attention"}</strong><p>{coreReady ? capacityState.copy : "The live application health endpoint reported an unavailable core component."}</p></div>
      <StatusPill tone={coreReady ? capacityState.tone : "danger"}>{coreReady ? capacityState.label : "Attention"}</StatusPill>
    </section>
    <dl className="monitoring-metrics">
      <Metric label="Queued conversations" value={monitoring.capacity.queue_depth} detail={`${monitoring.capacity.urgent_depth + monitoring.capacity.interactive_depth} reply-priority`} />
      <Metric label="Processing" value={monitoring.capacity.processing_count} detail={`limit ${monitoring.capacity.max_conversation_concurrency}`} />
      <Metric label="Oldest wait" value={duration(monitoring.capacity.oldest_queue_age_seconds)} detail={`warn at ${duration(monitoring.capacity.queue_age_warning_seconds)}`} />
      <Metric label="Dead letters" value={monitoring.capacity.dead_letter_count} detail={`${monitoring.capacity.indeterminate_actions} uncertain actions`} />
    </dl>
    <div className="monitoring-grid">
      <CapacityPanel capacity={monitoring.capacity} />
      <DeliveryPanel monitoring={monitoring} />
      <DependenciesPanel health={health} monitoring={monitoring} />
      <AgentPanel agents={monitoring.agents} />
    </div>
    <section className="monitoring-alerts" aria-labelledby="monitoring-alerts-title">
      <header><div><h2 id="monitoring-alerts-title">Open alerts</h2><p>Unread operational notifications scoped to this organization.</p></div><span>{monitoring.alerts.length}</span></header>
      {monitoring.alerts.length ? <ol>{monitoring.alerts.map((alert) => <li key={alert.id}><span className={`alert-marker alert-marker-${toneForSeverity(alert.severity)}`}><CircleAlert size={16} /></span><div><strong>{alert.title}</strong><p>{alert.body}</p><time dateTime={alert.created_at}>{date(alert.created_at)}</time></div><StatusPill tone={toneForSeverity(alert.severity)}>{alert.severity}</StatusPill></li>)}</ol> : <div className="monitoring-empty"><BellRing size={22} /><div><strong>No unread operational alerts</strong><p>Capacity safeguards and dependency states are still shown above even when the alert inbox is clear.</p></div></div>}
    </section>
    <p className="monitoring-observed"><Clock3 size={14} /> Snapshot observed {date(monitoring.observed_at)}. “Not independently verified” is used whenever Tanaghom has no direct health signal.</p>
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) { return <div><dt>{label}</dt><dd>{value}</dd><span>{detail}</span></div>; }
function CapacityPanel({ capacity }: { capacity: Capacity }) { const total = Math.max(1, capacity.queue_depth); return <section className="monitoring-panel capacity-panel"><header><div><Gauge size={18} /><h2>Workload capacity</h2></div><StatusPill tone={stateCopy[capacity.capacity_state]?.tone || "attention"}>{stateCopy[capacity.capacity_state]?.label || capacity.capacity_state}</StatusPill></header><div className="capacity-breakdown"><CapacityBar label="Urgent" value={capacity.urgent_depth} total={total} className="capacity-urgent" /><CapacityBar label="Interactive" value={capacity.interactive_depth} total={total} className="capacity-interactive" /><CapacityBar label="Background" value={capacity.background_depth} total={total} className="capacity-background" /></div><dl className="panel-facts"><div><dt>Model claim limit</dt><dd>{capacity.max_model_claims_per_minute}/min</dd></div><div><dt>GHL actions</dt><dd>{capacity.ghl_actions_in_flight}/{capacity.max_ghl_action_concurrency}</dd></div><div><dt>GHL rate limit</dt><dd>{capacity.max_ghl_actions_per_minute}/min</dd></div><div><dt>Action queue</dt><dd>{capacity.ghl_action_queue_depth}</dd></div></dl></section>; }
function CapacityBar({ label, value, total, className }: { label: string; value: number; total: number; className: string }) { return <div><span><strong>{label}</strong><b>{value}</b></span><i><em className={className} style={{ width: `${Math.max(value ? 4 : 0, Math.min(100, value / total * 100))}%` }} /></i></div>; }
function DeliveryPanel({ monitoring }: { monitoring: Monitoring }) { const delivery = monitoring.notification_delivery; return <section className="monitoring-panel"><header><div><BellRing size={18} /><h2>Alert delivery</h2></div><StatusPill tone={delivery.delivery_ready ? "success" : "attention"}>{delivery.delivery_ready ? "Ready" : "Locked"}</StatusPill></header><p className="panel-copy">{delivery.reason}. Configuring a destination never activates the delivery runtime.</p><ul className="compact-status-list"><li><span className={delivery.selected_destinations > 0 ? "status-dot-ready" : "status-dot-muted"} />Customer destinations <strong>{delivery.selected_destinations}</strong></li><li><span className={delivery.runtime_ready ? "status-dot-ready" : "status-dot-muted"} />Protected runtime <strong>{delivery.runtime_ready ? "Ready" : "Disabled"}</strong></li><li><span className={!delivery.emergency_stop ? "status-dot-ready" : "status-dot-warning"} />Emergency control <strong>{delivery.emergency_stop ? "Active" : "Clear"}</strong></li></ul>{monitoring.viewer.can_manage_notifications ? <Link className="panel-link" href="/settings/notifications">Manage destinations <Link2 size={15} /></Link> : null}</section>; }
function DependenciesPanel({ health, monitoring }: { health: Health; monitoring: Monitoring }) { const connection = (provider: string) => monitoring.connections.find((item) => item.provider === provider); const gemmaBlocked = monitoring.capacity.gemma_blocked_until && new Date(monitoring.capacity.gemma_blocked_until) > new Date(); const rows: Array<[string, string, Tone, string]> = [["Application API", health.components.api === "ready" ? "Ready" : "Unavailable", health.components.api === "ready" ? "success" : "danger", "Live health endpoint"], ["PostgreSQL", health.components.database === "connected" ? "Connected" : "Unavailable", health.components.database === "connected" ? "success" : "danger", "Live health endpoint"], ["Supabase Auth", health.components.authentication === "configured" ? "Configured" : "Not configured", health.components.authentication === "configured" ? "success" : "attention", "Configuration signal"], ["Gemma", gemmaBlocked ? "Cooldown" : "Not independently verified", gemmaBlocked ? "attention" : "neutral", gemmaBlocked ? `Blocked until ${date(monitoring.capacity.gemma_blocked_until)}` : "No current cooldown recorded"], ["Postiz", connection("postiz")?.status || "Not configured", connection("postiz")?.status === "connected" ? "success" : "neutral", connection("postiz")?.last_tested_at ? `Last tested ${date(connection("postiz")?.last_tested_at || null)}` : "No connection test recorded"], ["GoHighLevel", connection("ghl")?.status || "Not configured", connection("ghl")?.status === "connected" ? "success" : "neutral", connection("ghl")?.last_tested_at ? `Last tested ${date(connection("ghl")?.last_tested_at || null)}` : "No connection test recorded"]]; return <section className="monitoring-panel monitoring-dependencies"><header><div><Database size={18} /><h2>Dependencies</h2></div></header><div>{rows.map(([name, status, tone, evidence]) => <article key={name}><span><strong>{name}</strong><small>{evidence}</small></span><StatusPill tone={tone}>{status}</StatusPill></article>)}</div></section>; }
function AgentPanel({ agents }: { agents: Monitoring["agents"] }) { return <section className="monitoring-panel monitoring-agents"><header><div><Bot size={18} /><h2>Agent runtime signals</h2></div><span>{agents.length}</span></header>{agents.length ? <div>{agents.map((agent) => { const observed = Boolean(agent.last_heartbeat_at); const label = observed ? agent.status : "Not independently verified"; const tone: Tone = agent.status === "failed" || agent.status === "blocked" ? "danger" : agent.status === "working" ? "success" : "neutral"; return <article key={agent.code}><span><strong>{agent.name}</strong><small>{observed ? `Heartbeat ${date(agent.last_heartbeat_at)} · ${agent.running_jobs} running` : "No heartbeat has been recorded"}</small></span><StatusPill tone={observed ? tone : "neutral"}>{label}</StatusPill></article>; })}</div> : <div className="monitoring-empty compact-empty"><Activity size={19} /><div><strong>No agent registry records</strong><p>Runtime status will appear after agents are registered.</p></div></div>}</section>; }
function MonitoringLoading() { return <div className="monitoring-loading" aria-label="Loading system monitoring"><span className="state-skeleton" /><div><span className="state-skeleton" /><span className="state-skeleton" /><span className="state-skeleton" /><span className="state-skeleton" /></div><section><span className="state-skeleton" /><span className="state-skeleton" /></section></div>; }
