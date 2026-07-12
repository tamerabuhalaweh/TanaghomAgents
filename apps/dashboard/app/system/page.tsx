import type { Metadata } from "next";
import { CheckCircle2, CircleAlert, ServerCog } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";

export const metadata: Metadata = { title: "System" };
const services = [["Application API", "Ready", "success"], ["PostgreSQL", "Ready", "success"], ["n8n orchestration", "Ready", "success"], ["Gemma", "Connected", "success"], ["Postiz", "Not configured", "neutral"], ["GoHighLevel", "Not configured", "neutral"]] as const;

export default function SystemPage() {
  return (
    <div className="page-stack"><PageHeading title="System" description="Environment readiness, integration status, and operator alerts." /><section className="system-summary"><div><CheckCircle2 size={22} /><span><strong>Core services are healthy</strong><small>Last checked less than one minute ago</small></span></div><StatusPill tone="success">Ready</StatusPill></section><section className="service-list" aria-labelledby="services-title"><div className="section-heading compact-heading"><div><h2 id="services-title">Services and integrations</h2><p>Live integrations remain disabled until their controlled phase.</p></div></div>{services.map(([name, status, tone]) => <div className="service-row" key={name}><ServerCog size={18} /><strong>{name}</strong><StatusPill tone={tone}>{status}</StatusPill></div>)}</section><section className="system-alert"><CircleAlert size={20} /><div><strong>Off-server backup is not configured</strong><p>Recovery cannot be marked production-ready until encrypted backup credentials and a restoration test are complete.</p></div><button className="secondary-button" type="button">View requirement</button></section></div>
  );
}
