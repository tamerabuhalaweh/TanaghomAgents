"use client";

import { Clock3, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface AuditAction {
  id: string;
  action_type: string;
  result: string;
  created_at: string;
  agent_name: string | null;
  actor_name: string | null;
}

function actionLabel(value: string) {
  const words = value.replaceAll(/[._]/g, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function actionTime(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function LiveActivity() {
  const [actions, setActions] = useState<AuditAction[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/audit?limit=20", { cache: "no-store" });
      if (response.status === 401) { window.location.assign("/login"); return; }
      if (!response.ok) throw new Error("audit request failed");
      const payload = await response.json() as { actions: AuditAction[] };
      setActions(payload.actions);
      setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <ol className="activity-list activity-loading" aria-label="Loading recent activity" aria-busy="true"><li><span className="state-skeleton" /></li><li><span className="state-skeleton" /></li></ol>;
  if (state === "error") return <div className="activity-state"><p>Audit activity is temporarily unavailable.</p><button className="text-button" type="button" onClick={() => void load()}><RefreshCw size={15} /> Try again</button></div>;
  if (!actions.length) return <div className="activity-state"><p>No audited action has been recorded yet.</p><span>Agent and human actions will appear here with their correlation evidence.</span></div>;

  return (
    <ol className="activity-list">
      {actions.map((action) => (
        <li key={action.id}>
          <span className="activity-marker" />
          <div><strong>{action.agent_name || action.actor_name || "Tanaghom"}</strong><p>{actionLabel(action.action_type)}</p></div>
          <time dateTime={action.created_at}><Clock3 size={14} />{actionTime(action.created_at)}</time>
        </li>
      ))}
    </ol>
  );
}
