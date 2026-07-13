"use client";

import { RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Tone } from "@/data/fixtures";
import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { useOperations } from "./operations-context";
import { DomainEmpty, OperationsError, OperationsLoading } from "./operations-state";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

function tone(status: string): Tone {
  if (status === "won" || status === "qualified") return "success";
  if (status === "lost") return "danger";
  if (status === "new") return "attention";
  return "working";
}
function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function lastActivity(value: string | null, createdAt: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(value ?? createdAt));
}

export function LeadsView() {
  const operations = useOperations();
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const leads = useMemo(() => operations.status === "ready"
    ? operations.data.leads.filter((lead) =>
      [lead.name, lead.contact_email, lead.contact_phone, lead.campaign_name]
        .some((value) => value?.toLowerCase().includes(query.toLowerCase())))
    : [], [operations, query]);

  async function syncContact(leadId: string) {
    setSyncing(leadId);
    setFeedback("");
    try {
      const response = await authenticatedFetch(`/api/leads/${leadId}/ghl-contact`, {
        method: "POST",
        headers: { "Idempotency-Key": `ghl-contact-${leadId}-${crypto.randomUUID()}` },
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "ghl_contact_sync_failed");
      setFeedback("Contact synchronization queued for the protected inactive workflow.");
      operations.retry();
    } catch (error) {
      const code = error instanceof Error ? error.message : "ghl_contact_sync_failed";
      setFeedback(code === "ghl_contact_handoff_not_enabled"
        ? "GHL synchronization is installed but still locked by the platform activation gate."
        : code === "ghl_contact_sync_not_ready"
          ? "Connect and verify GoHighLevel before synchronizing this lead."
          : "Tanaghom could not queue this CRM contact.");
    } finally {
      setSyncing(null);
    }
  }

  return <div className="page-stack">
    <PageHeading title="Leads" description="Follow every lead from its source campaign through the sales journey." />
    {operations.status === "ready" && operations.data.leads.length > 0
      ? <div className="toolbar"><label className="search-field"><Search size={17} /><span className="sr-only">Search leads</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, contact, or campaign" /></label></div>
      : null}
    {operations.status === "loading" ? <OperationsLoading label="Loading leads" /> : null}
    {operations.status === "error" ? <OperationsError retry={operations.retry} /> : null}
    {operations.status === "ready" && operations.data.leads.length === 0
      ? <DomainEmpty title="No leads yet" description="This table reads directly from the live lead pipeline. Records will appear after campaigns begin collecting responses." detail="0 live records" />
      : null}
    {operations.status === "ready" && operations.data.leads.length > 0
      ? <section className="data-section" aria-label="Lead pipeline">
        <div className="table-scroll" tabIndex={0}>
          <table>
            <thead><tr><th>Lead</th><th>Campaign</th><th>Status</th><th>Temperature</th><th>CRM</th><th>Last activity</th></tr></thead>
            <tbody>{leads.map((lead) => <tr key={lead.id}>
              <td><strong>{lead.name ?? lead.contact_email ?? lead.contact_phone ?? "Unnamed lead"}</strong></td>
              <td>{lead.campaign_name}</td>
              <td><StatusPill tone={tone(lead.status)}>{label(lead.status)}</StatusPill></td>
              <td>{label(lead.temperature)}</td>
              <td>{lead.ghl_contact_id
                ? <StatusPill tone="success">Synced</StatusPill>
                : lead.ghl_sync_status === "queued" || lead.ghl_sync_status === "running"
                  ? <StatusPill tone="working">{label(lead.ghl_sync_status)}</StatusPill>
                  : <button className="ghost-button compact-button" type="button" disabled={syncing === lead.id} onClick={() => void syncContact(lead.id)}><RefreshCw size={14} />{syncing === lead.id ? "Queueing..." : "Sync to GHL"}</button>}</td>
              <td>{lastActivity(lead.last_touch_at, lead.created_at)}</td>
            </tr>)}</tbody>
          </table>
          {leads.length === 0 ? <div className="table-empty">No leads match "{query}".</div> : null}
        </div>
        {feedback ? <p className="integration-feedback" role="status">{feedback}</p> : null}
      </section>
      : null}
  </div>;
}
