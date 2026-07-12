import { CalendarDays, CircleDollarSign, Plus, UsersRound } from "lucide-react";
import { campaigns } from "@/data/fixtures";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

export function CampaignsView() {
  return (
    <div className="page-stack">
      <PageHeading title="Campaigns" description="Plan work, monitor progress, and keep every agent aligned to one business outcome." actions={<button className="primary-button" type="button"><Plus size={17} /> Create campaign</button>} />
      <section className="campaign-portfolio" aria-label="Campaign portfolio">
        {campaigns.map((campaign, index) => (
          <article className="campaign-record" key={campaign.name}>
            <header><div><StatusPill tone={campaign.tone}>{campaign.state}</StatusPill><h2>{campaign.name}</h2></div><span className="campaign-index">0{index + 1}</span></header>
            <div className="campaign-stage"><span>Current stage</span><strong>{campaign.stage}</strong><i><b style={{ width: `${campaign.pace}%` }} /></i></div>
            <dl><div><dt><CalendarDays size={16} /> Next milestone</dt><dd>{campaign.milestone}</dd></div><div><dt><CircleDollarSign size={16} /> Revenue impact</dt><dd>{campaign.impact}</dd></div><div><dt><UsersRound size={16} /> Active agents</dt><dd>{index === 3 ? "1 of 4" : "4 of 4"}</dd></div></dl>
            <button className="secondary-button" type="button">Open campaign</button>
          </article>
        ))}
      </section>
    </div>
  );
}
