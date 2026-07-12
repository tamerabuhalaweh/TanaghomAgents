"use client";

import Link from "next/link";
import { ArrowRight, Check, Clock3, TriangleAlert } from "lucide-react";
import { agents, approvals, campaigns } from "@/data/fixtures";
import { StatusPill } from "./status-pill";
import { PageHeading } from "./page-heading";

export function OverviewDashboard() {
  return (
    <div className="page-stack">
      <PageHeading title="Overview" description="Your agents are moving three campaigns forward. Three content decisions need you today." actions={<button className="secondary-button" type="button">Create campaign</button>} />

      <section className="attention-section" aria-labelledby="attention-title">
        <div className="section-heading">
          <div>
            <div className="title-with-count"><h2 id="attention-title">Needs your attention</h2><span>3</span></div>
            <p>Review content before its scheduled publishing window.</p>
          </div>
          <Link href="/approvals" className="text-link">View all approvals <ArrowRight size={16} /></Link>
        </div>

        <div className="approval-list" role="list">
          {approvals.map((item) => (
            <article className="approval-row" key={item.id} role="listitem">
              <div className="channel-tile" aria-hidden="true">{item.channel.slice(0, 2).toUpperCase()}</div>
              <div className="approval-primary"><strong>{item.title}</strong><span>{item.format}</span></div>
              <div className="approval-meta"><span>Campaign</span><strong>{item.campaign}</strong></div>
              <div className="approval-meta"><span>Scheduled</span><strong>{item.scheduled}</strong></div>
              <StatusPill tone="attention">Needs review</StatusPill>
              <Link className="primary-button compact-button" href={`/approvals?item=${item.id}`}>Review content</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="handoff-section" aria-labelledby="handoff-title">
        <div className="section-heading compact-heading">
          <div><h2 id="handoff-title">Agent handoff</h2><p>Four agents, one shared campaign record.</p></div>
          <Link href="/agents" className="text-link">View agents <ArrowRight size={16} /></Link>
        </div>
        <ol className="handoff-rail">
          {agents.map((agent, index) => (
            <li key={agent.code}>
              <div className="agent-identity"><span className="agent-avatar">{agent.code}</span><div><strong>{agent.name}</strong><StatusPill tone={agent.tone}>{agent.state}</StatusPill></div></div>
              <p>{agent.detail}</p>
              {index < agents.length - 1 ? <ArrowRight className="handoff-arrow" size={18} aria-hidden="true" /> : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="campaign-section" aria-labelledby="campaign-title">
        <div className="section-heading compact-heading">
          <div><h2 id="campaign-title">Active campaigns</h2><p>Progress, risk, and expected revenue impact.</p></div>
          <Link href="/campaigns" className="text-link">View campaigns <ArrowRight size={16} /></Link>
        </div>
        <div className="table-scroll" tabIndex={0} aria-label="Active campaigns table, horizontally scrollable on small screens">
          <table>
            <thead><tr><th>Campaign</th><th>Status</th><th>Stage</th><th>Next milestone</th><th>Budget pace</th><th>Revenue impact</th></tr></thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.name}>
                  <td><Link href="/campaigns">{campaign.name}</Link></td>
                  <td><StatusPill tone={campaign.tone}>{campaign.state}</StatusPill></td>
                  <td>{campaign.stage}</td><td>{campaign.milestone}</td>
                  <td><div className="pace-cell"><span>{campaign.pace}%</span><i><b style={{ width: `${campaign.pace}%` }} /></i></div></td>
                  <td className="tabular">{campaign.impact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="overview-footer-grid">
        <section className="performance-section" aria-labelledby="performance-title">
          <div className="section-heading compact-heading"><div><h2 id="performance-title">Performance this month</h2><p>Compared with the previous period.</p></div><Link href="/reports" className="text-link">Full report <ArrowRight size={16} /></Link></div>
          <dl className="metric-line">
            <div><dt>Revenue impact</dt><dd>$339,800</dd><span><ArrowRight size={13} /> 18%</span></div>
            <div><dt>New leads</dt><dd>1,248</dd><span><ArrowRight size={13} /> 12%</span></div>
            <div><dt>Cost per lead</dt><dd>$14.62</dd><span><ArrowRight size={13} /> 8% lower</span></div>
            <div><dt>Content approved</dt><dd>12</dd><span>3 waiting</span></div>
          </dl>
        </section>
        <section className="alerts-section" aria-labelledby="alerts-title">
          <div className="section-heading compact-heading"><div><h2 id="alerts-title">Alerts</h2><p>Two items may affect timing.</p></div></div>
          <ul className="alert-list">
            <li><TriangleAlert size={18} /><div><strong>Budget pacing is high</strong><span>Weekend Workshops is at 87% of budget.</span></div><time>2h</time></li>
            <li><Clock3 size={18} /><div><strong>Approval is overdue</strong><span>One item passed its preferred review time.</span></div><time>3h</time></li>
            <li className="resolved-alert"><Check size={18} /><div><strong>Performance sync recovered</strong><span>All reporting data is current.</span></div><time>5h</time></li>
          </ul>
        </section>
      </div>
    </div>
  );
}
