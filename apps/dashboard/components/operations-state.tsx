"use client";

import { DatabaseZap, RefreshCw } from "lucide-react";

export function OperationsLoading({ label = "Loading live operations" }: { label?: string }) {
  return <div className="operations-state operations-state-loading" aria-label={label} aria-busy="true"><span className="state-skeleton state-skeleton-title" /><span className="state-skeleton" /><span className="state-skeleton state-skeleton-block" /></div>;
}

export function OperationsError({ retry }: { retry: () => void }) {
  return <section className="operations-state operations-state-error"><DatabaseZap size={25} /><div><h2>Live operations are unavailable</h2><p>No fixture data is shown. Restore the source-of-truth connection before making a decision.</p></div><button className="secondary-button" type="button" onClick={retry}><RefreshCw size={16} /> Try again</button></section>;
}

export function DomainEmpty({ title, description, detail }: { title: string; description: string; detail?: string }) {
  return <div className="domain-empty"><div><h2>{title}</h2><p>{description}</p></div>{detail ? <span>{detail}</span> : null}</div>;
}
