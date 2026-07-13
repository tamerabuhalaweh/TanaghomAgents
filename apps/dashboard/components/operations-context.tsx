"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authenticatedFetch } from "@/lib/client/authenticated-fetch";

export interface OperationsCampaign {
  id: string;
  name: string;
  product_type: string;
  status: string;
  blocked_reason: string | null;
  budget_target: string | null;
  revenue_target: string | null;
  currency: string;
  content_total: number;
  content_pending: number;
  leads_total: number;
  updated_at: string;
}

export interface OperationsAgent {
  id: string;
  code: string;
  name: string;
  description: string;
  status: string;
  last_heartbeat_at: string | null;
  current_job_id: string | null;
  current_job_type: string | null;
  current_job_status: string | null;
  campaign_id: string | null;
  current_job_started_at: string | null;
}

export interface OperationsLead {
  id: string;
  campaign_id: string;
  campaign_name: string;
  name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: string;
  temperature: string;
  available_for_requeue: boolean;
  created_at: string;
  last_touch_at: string | null;
}

export interface OperationsNotification {
  id: string;
  severity: "info" | "warning" | "error" | "critical";
  title: string;
  body: string;
  created_at: string;
}

export interface CampaignPerformance {
  campaign_id: string;
  campaign_name: string;
  posts: number;
  impressions: string;
  clicks: string;
  likes: string;
  comments: string;
  shares: string;
  last_synced_at: string | null;
  stale_posts: number;
}

export interface PostPerformance {
  id: string;
  provider_post_id: string;
  channel: string;
  status: string;
  campaign_id: string;
  campaign_name: string;
  content_item_id: string;
  content_excerpt: string;
  metrics: Record<string, string>;
  sync_status: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
  is_stale: boolean;
}

export interface AttributionQuarantineRecord {
  id: string;
  provider: string;
  provider_event_id: string;
  quarantine_reason: string;
  received_at: string;
  evidence: Record<string, unknown>;
}

export interface OperationsSnapshot {
  summary: {
    campaigns_total: number;
    campaigns_active: number;
    approvals_pending: number;
    jobs_open: number;
    leads_total: number;
    leads_won: number;
    notifications_unread: number;
  };
  campaigns: OperationsCampaign[];
  agents: OperationsAgent[];
  leads: OperationsLead[];
  performance: {
    impressions: string;
    clicks: string;
    likes: string;
    comments: string;
    shares: string;
    views: string;
    spend: string;
    live_posts: number;
    failed_posts: number;
    stale_posts: number;
    last_synced_at: string | null;
    quarantined_leads: number;
  };
  campaign_performance: CampaignPerformance[];
  post_performance: PostPerformance[];
  attribution_quarantine: AttributionQuarantineRecord[];
  notifications: OperationsNotification[];
}

type OperationsState =
  | { status: "loading"; data: null; retry: () => void }
  | { status: "error"; data: null; retry: () => void }
  | { status: "ready"; data: OperationsSnapshot; retry: () => void };

const OperationsContext = createContext<OperationsState | null>(null);

export function OperationsProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [data, setData] = useState<OperationsSnapshot | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await authenticatedFetch("/api/operations", { cache: "no-store" });
      if (response.status === 401) return;
      if (!response.ok) throw new Error("operations request failed");
      setData(await response.json() as OperationsSnapshot);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const value = useMemo<OperationsState>(() => {
    const retry = () => { void load(); };
    if (status === "ready" && data) return { status, data, retry };
    return { status: status === "error" ? "error" : "loading", data: null, retry };
  }, [data, load, status]);

  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

export function useOperations() {
  const value = useContext(OperationsContext);
  if (!value) throw new Error("useOperations must be used inside OperationsProvider");
  return value;
}
