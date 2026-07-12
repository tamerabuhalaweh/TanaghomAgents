import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { agents } from "@/data/fixtures";
import { LiveActivity } from "@/components/live-activity";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return (
    <div className="page-stack">
      <PageHeading title="Agents" description="See what each agent owns, what it is doing now, and where work is waiting." />
      <section className="agent-roster" aria-label="Agent roster">
        {agents.map((agent) => (
          <article className="agent-record" key={agent.code}>
            <div className="agent-record-header"><span className="agent-avatar large-avatar">{agent.code}</span><div><h2>{agent.name}</h2><StatusPill tone={agent.tone}>{agent.state}</StatusPill></div><button className="icon-button" type="button" aria-label={`Open ${agent.name}`}><ArrowRight size={18} /></button></div>
            <p>{agent.detail}.</p>
            <dl><div><dt>Current campaign</dt><dd>Not assigned</dd></div><div><dt>Last action</dt><dd>No live job</dd></div><div><dt>Jobs today</dt><dd>0</dd></div></dl>
          </article>
        ))}
      </section>
      <section className="activity-section" aria-labelledby="activity-title"><div className="section-heading compact-heading"><div><h2 id="activity-title">Recent activity</h2><p>Every entry is tied to an agent, campaign, and audit record.</p></div></div><LiveActivity /></section>
    </div>
  );
}
