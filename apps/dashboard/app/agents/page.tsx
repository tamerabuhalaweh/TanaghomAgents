import type { Metadata } from "next";
import { ArrowRight, Clock3 } from "lucide-react";
import { agents, recentActivity } from "@/data/fixtures";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return (
    <div className="page-stack">
      <PageHeading title="Agents" description="See what each agent owns, what it is doing now, and where work is waiting." />
      <section className="agent-roster" aria-label="Agent roster">
        {agents.map((agent, index) => (
          <article className="agent-record" key={agent.code}>
            <div className="agent-record-header"><span className="agent-avatar large-avatar">{agent.code}</span><div><h2>{agent.name}</h2><StatusPill tone={agent.tone}>{agent.state}</StatusPill></div><button className="icon-button" type="button" aria-label={`Open ${agent.name}`}><ArrowRight size={18} /></button></div>
            <p>{agent.detail}.</p>
            <dl><div><dt>Current campaign</dt><dd>{index === 0 ? "Fall Programs 2026" : "Summer Camp 2026"}</dd></div><div><dt>Last action</dt><dd>{recentActivity[index].time}</dd></div><div><dt>Jobs today</dt><dd>{[8, 17, 12, 24][index]}</dd></div></dl>
          </article>
        ))}
      </section>
      <section className="activity-section" aria-labelledby="activity-title"><div className="section-heading compact-heading"><div><h2 id="activity-title">Recent activity</h2><p>Every entry is tied to an agent, campaign, and audit record.</p></div></div><ol className="activity-list">{recentActivity.map((activity) => <li key={activity.action}><span className="activity-marker" /><div><strong>{activity.agent}</strong><p>{activity.action}</p></div><time><Clock3 size={14} />{activity.time}</time></li>)}</ol></section>
    </div>
  );
}
