import type { Metadata } from "next";
import { Filter, Search } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";

export const metadata: Metadata = { title: "Leads" };
const leads = [
  ["Amal Saeed", "Instagram · Outdoor carousel", "Qualified", "success", "Hot", "12 minutes ago"],
  ["Yousef Khalid", "Email · Registration launch", "Contacted", "working", "Warm", "34 minutes ago"],
  ["Mariam Adel", "YouTube · Parent testimonial", "New", "attention", "Warm", "1 hour ago"],
  ["Omar Nasser", "Instagram · Outdoor carousel", "Nurture", "neutral", "Cold", "Yesterday"],
] as const;

export default function LeadsPage() {
  return (
    <div className="page-stack">
      <PageHeading title="Leads" description="Follow every lead from its source campaign through the sales journey." />
      <div className="toolbar"><label className="search-field"><Search size={17} /><span className="sr-only">Search leads</span><input type="search" placeholder="Search by name or source" /></label><button className="secondary-button" type="button"><Filter size={16} /> Filter</button></div>
      <section className="data-section" aria-label="Lead pipeline"><div className="table-scroll" tabIndex={0}><table><thead><tr><th>Lead</th><th>Source</th><th>Status</th><th>Temperature</th><th>Last activity</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{leads.map(([name, source, status, tone, temperature, time]) => <tr key={name}><td><strong>{name}</strong></td><td>{source}</td><td><StatusPill tone={tone}>{status}</StatusPill></td><td>{temperature}</td><td>{time}</td><td><button className="text-button" type="button">Open lead</button></td></tr>)}</tbody></table></div></section>
    </div>
  );
}
