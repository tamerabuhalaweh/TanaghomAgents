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
  content_item_target: number;
  core_job_type: string | null;
  core_job_status: string | null;
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

export interface AgentRegistryBlocker {
  code: string;
  title: string;
  detail: string;
  next_action: string;
  severity: "blocking" | "attention" | "info";
}

export interface AgentRegistryJob {
  id: string;
  worker_code: string | null;
  job_type: string;
  status: string;
  campaign_id: string | null;
  campaign_name: string | null;
  attempt: number;
  max_attempts: number;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
  pending_approvals: number;
  requires_reconciliation: boolean;
}

export interface AgentRegistryWorker {
  code: string;
  role_code: string;
  name: string;
  responsibility: string;
  phase: string;
  workflow_name: string;
  workflow_version: string;
  source_path: string;
  job_types: string[];
  release_state: "available" | "retired";
  runtime_state: "available_not_imported" | "imported_inactive" | "active";
  trigger_state: "disabled" | "workflow_inactive_only" | "enabled";
  runtime_verified_at: string;
  runtime_evidence: string;
  display_order: number;
  blockers: AgentRegistryBlocker[];
}

export interface AgentRegistryRole {
  code: string;
  name: string;
  short_name: string;
  responsibility: string;
  display_order: number;
  agent_record_id: string | null;
  operational_state: "working" | "waiting_approval" | "blocked" | "ready" | "inactive";
  current_job: AgentRegistryJob | null;
  recent_jobs: AgentRegistryJob[];
  blockers: AgentRegistryBlocker[];
  workers: AgentRegistryWorker[];
}

export interface AgentRegistrySnapshot {
  contract_version: "tanaghom.agent-registry.v1";
  generated_at: string;
  summary: {
    business_roles: number;
    specialized_workers: number;
    release_available: number;
    imported: number;
    active: number;
    jobs_open: number;
    jobs_requiring_reconciliation: number;
  };
  roles: AgentRegistryRole[];
}

export interface SkillRegistryBinding {
  id: string;
  organization_id: string | null;
  role_code: string;
  worker_code: string;
  binding_state: "active" | "retired";
}

export interface SkillRegistryEntry {
  id: string;
  organization_id: string | null;
  owner_scope: "platform" | "organization";
  code: string;
  name: string;
  description: string;
  skill_class: "knowledge" | "read" | "proposal" | "action";
  version_id: string;
  version_number: number;
  lifecycle_state: "published" | "deprecated";
  instructions: string;
  input_schema_ref: string;
  output_schema_ref: string;
  risk_class: "low" | "medium" | "high" | "critical";
  side_effect_class: "none" | "read_only" | "proposal_only" | "internal_write" | "external_write";
  permission_manifest: {
    data_domains: string[];
    integrations: string[];
    channels: string[];
    operations: string[];
  };
  integration_requirements: string[];
  executor_type: "controlled_database_function" | "private_gateway_operation" | "pinned_n8n_workflow";
  executor_ref: string;
  executor_version: string;
  package_path: string;
  content_hash: string;
  tool_schema_hash: string;
  published_at: string;
  deprecated_at: string | null;
  bindings: SkillRegistryBinding[];
}

export interface SkillRegistrySnapshot {
  contract_version: "tanaghom.skill-registry.v1";
  generated_at: string;
  summary: {
    total: number;
    platform: number;
    organization: number;
    published: number;
  };
  skills: SkillRegistryEntry[];
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
  ghl_contact_id: string | null;
  ghl_sync_status: string | null;
  ghl_last_synced_at: string | null;
  ghl_last_error_code: string | null;
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
  current_user: {
    id: string;
    organizationId: string;
    displayName: string;
    role: "owner" | "reviewer" | "operator" | "viewer";
  };
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
  agent_registry: AgentRegistrySnapshot;
  skill_registry: SkillRegistrySnapshot;
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
