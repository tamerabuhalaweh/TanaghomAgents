"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Tone } from "@/data/fixtures";
import { useOperations } from "./operations-context";
import { DomainEmpty, OperationsError, OperationsLoading } from "./operations-state";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

function tone(status: string): Tone { if (status === "won" || status === "qualified") return "success"; if (status === "lost") return "danger"; if (status === "new") return "attention"; return "working"; }
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function lastActivity(value: string | null, createdAt: string) { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value ?? createdAt)); }

export function LeadsView() {
  const operations = useOperations();
  const [query, setQuery] = useState("");
  const leads = useMemo(() => operations.status === "ready" ? operations.data.leads.filter((lead) => [lead.name, lead.contact_email, lead.contact_phone, lead.campaign_name].some((value) => value?.toLowerCase().includes(query.toLowerCase()))) : [], [operations, query]);
  return <div className="page-stack">
    <PageHeading title="Leads" description="Follow every lead from its source campaign through the sales journey." />
    {operations.status === "ready" && operations.data.leads.length > 0 ? <div className="toolbar"><label className="search-field"><Search size={17} /><span className="sr-only">Search leads</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, contact, or campaign" /></label></div> : null}
    {operations.status === "loading" ? <OperationsLoading label="Loading leads" /> : null}
    {operations.status === "error" ? <OperationsError retry={operations.retry} /> : null}
    {operations.status === "ready" && operations.data.leads.length === 0 ? <DomainEmpty title="No leads yet" description="This table reads directly from the live lead pipeline. Records will appear after campaigns begin collecting responses." detail="0 live records" /> : null}
    {operations.status === "ready" && operations.data.leads.length > 0 ? <section className="data-section" aria-label="Lead pipeline"><div className="table-scroll" tabIndex={0}><table><thead><tr><th>Lead</th><th>Campaign</th><th>Status</th><th>Temperature</th><th>Last activity</th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id}><td><strong>{lead.name ?? lead.contact_email ?? lead.contact_phone ?? "Unnamed lead"}</strong></td><td>{lead.campaign_name}</td><td><StatusPill tone={tone(lead.status)}>{label(lead.status)}</StatusPill></td><td>{label(lead.temperature)}</td><td>{lastActivity(lead.last_touch_at, lead.created_at)}</td></tr>)}</tbody></table>{leads.length === 0 ? <div className="table-empty">No leads match “{query}”.</div> : null}</div></section> : null}
  </div>;
}
