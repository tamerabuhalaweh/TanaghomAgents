"use client";

import { CheckCircle2, CircleAlert, ServerCog } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Tone } from "@/data/fixtures";
import { useOperations } from "./operations-context";
import { OperationsError, OperationsLoading } from "./operations-state";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

interface Health { ok: boolean; components: { api: string; authentication: string; database: string } }

export function SystemView() {
  const operations = useOperations();
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);
  const loadHealth = useCallback(async () => { try { const response = await fetch("/api/health", { cache: "no-store" }); const body = await response.json() as Health; setHealth(body); setHealthError(false); } catch { setHealth(null); setHealthError(true); } }, []);
  useEffect(() => { void loadHealth(); }, [loadHealth]);
  if (operations.status === "loading" || (!health && !healthError)) return <div className="page-stack"><PageHeading title="System" description="Environment readiness, integration status, and operator alerts." /><OperationsLoading label="Checking system health" /></div>;
  if (operations.status === "error" || healthError) return <div className="page-stack"><PageHeading title="System" description="Environment readiness, integration status, and operator alerts." /><OperationsError retry={() => { operations.retry(); void loadHealth(); }} /></div>;
  const coreReady = Boolean(health?.ok);
  const services: Array<[string, string, Tone]> = [["Application API", health?.components.api === "ready" ? "Ready" : "Unavailable", health?.components.api === "ready" ? "success" : "danger"], ["PostgreSQL", health?.components.database === "connected" ? "Connected" : "Unavailable", health?.components.database === "connected" ? "success" : "danger"], ["Supabase Auth", health?.components.authentication === "configured" ? "Configured" : "Not configured", health?.components.authentication === "configured" ? "success" : "attention"], ["n8n orchestration", "Not verified", "neutral"], ["Gemma", "Not verified", "neutral"], ["Postiz", "Not configured", "neutral"], ["GoHighLevel", "Not configured", "neutral"]];
  return <div className="page-stack"><PageHeading title="System" description="Environment readiness, integration status, and operator alerts." /><section className={`system-summary ${coreReady ? "" : "system-summary-error"}`}><div>{coreReady ? <CheckCircle2 size={22} /> : <CircleAlert size={22} />}<span><strong>{coreReady ? "Core application services are healthy" : "A core application service needs attention"}</strong><small>Verified from the live health endpoint in this session</small></span></div><StatusPill tone={coreReady ? "success" : "danger"}>{coreReady ? "Ready" : "Attention"}</StatusPill></section><section className="service-list" aria-labelledby="services-title"><div className="section-heading compact-heading"><div><h2 id="services-title">Services and integrations</h2><p>Only directly verified services are marked ready.</p></div></div>{services.map(([name, status, tone]) => <div className="service-row" key={name}><ServerCog size={18} /><strong>{name}</strong><StatusPill tone={tone}>{status}</StatusPill></div>)}</section><section className="system-alert"><CircleAlert size={20} /><div><strong>Automated off-server backups remain pending</strong><p>An encrypted recovery point exists, but a recurring production backup schedule and restoration drill are still required.</p></div><span className="system-alert-label">Phase 3 prerequisite</span></section></div>;
}
