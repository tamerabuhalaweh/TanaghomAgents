import type { Metadata } from "next";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { PageHeading } from "@/components/page-heading";

export const metadata: Metadata = { title: "Reports" };
const metrics = [["Revenue impact", "$339,800", "18%", true], ["Qualified leads", "412", "11%", true], ["Cost per lead", "$14.62", "8%", false], ["Approval time", "2h 14m", "19%", false]] as const;

export default function ReportsPage() {
  return (
    <div className="page-stack">
      <PageHeading title="Reports" description="Understand how campaign work becomes attention, leads, and revenue." actions={<button className="secondary-button" type="button">Export report</button>} />
      <dl className="report-metrics">{metrics.map(([label, value, change, up]) => <div key={label}><dt>{label}</dt><dd>{value}</dd><span className={up ? "positive-change" : label === "Cost per lead" || label === "Approval time" ? "positive-change" : ""}>{up ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{change} {up ? "higher" : "lower"}</span></div>)}</dl>
      <section className="report-chart" aria-labelledby="revenue-chart-title"><div className="section-heading compact-heading"><div><h2 id="revenue-chart-title">Revenue impact by campaign</h2><p>Attributed pipeline and closed revenue, May 1–31.</p></div></div><div className="bar-chart" role="img" aria-label="Summer Camp 284,500 dollars; Fall Programs 152,300 dollars; Weekend Workshops 68,900 dollars; Alumni Re-engagement 34,200 dollars">{[["Summer Camp 2026", 100, "$284.5k"], ["Fall Programs 2026", 54, "$152.3k"], ["Weekend Workshops", 24, "$68.9k"], ["Alumni Re-engagement", 12, "$34.2k"]].map(([name, width, value]) => <div className="bar-row" key={name}><span>{name}</span><i><b style={{ width: `${width}%` }} /></i><strong>{value}</strong></div>)}</div></section>
    </div>
  );
}
