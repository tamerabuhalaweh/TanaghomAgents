import "server-only";
import type { Pool, PoolClient } from "pg";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";
export type PlanTier = "starter" | "growth" | "scale";

export const PLAN_MONTHLY_CAMPAIGNS: Record<PlanTier, number> = {
  starter: 15,
  growth: 50,
  scale: 200,
};
export const SANDBOX_CAMPAIGN_LIMIT = 1;
export const SANDBOX_RUN_LIMIT = 3;
export const SANDBOX_MONTHLY_TOKEN_LIMIT = 100_000;
export const PLAN_MONTHLY_TOKENS: Record<PlanTier, number> = {
  starter: 600_000,
  growth: 2_000_000,
  scale: 8_000_000,
};
export const MAX_RETRIES_PER_CAMPAIGN = 3;
export const UPGRADE_URL = "/settings/billing";

// Gemini Flash list pricing used only for an additive estimate. No invoice or
// provider charge is derived from this value; provider usage remains the truth.
export const GEMINI_INPUT_USD_PER_MILLION = 0.3;
export const GEMINI_OUTPUT_USD_PER_MILLION = 2.5;

export interface WorkspaceQuota {
  subscription_status: SubscriptionStatus;
  plan_tier: PlanTier | null;
  is_sandbox: boolean;
  campaigns_used: number;
  campaigns_limit: number;
  runs_used: number;
  runs_limit: number | null;
  tokens_used: number;
  tokens_limit: number;
  max_retries_per_campaign: number;
  upgrade_required: boolean;
  upgrade_url: typeof UPGRADE_URL;
}

export interface WorkspaceUsage {
  month_prompt_tokens: number;
  month_completion_tokens: number;
  month_total_tokens: number;
  estimated_cost_usd: number;
}

type Queryable = Pool | PoolClient;

function subscriptionStatus(value: unknown): SubscriptionStatus {
  return value === "active" || value === "past_due" || value === "canceled" ? value : "trialing";
}

function planTier(value: unknown, active: boolean): PlanTier | null {
  if (!active) return null;
  return value === "growth" || value === "scale" ? value : "starter";
}

function count(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/** Shared estimate for agency workspace and platform unit economics. */
export function estimatedAiCostUsd(promptTokens: number, completionTokens: number) {
  return Number((
    (promptTokens / 1_000_000) * GEMINI_INPUT_USD_PER_MILLION
    + (completionTokens / 1_000_000) * GEMINI_OUTPUT_USD_PER_MILLION
  ).toFixed(4));
}

export async function loadWorkspaceQuota(
  client: Queryable,
  organizationId: string,
  excludeWorkspaceId: string | null = null,
): Promise<WorkspaceQuota> {
  const tenant = await client.query<{ status: string; plan_tier: string | null }>(
    `SELECT organization.status,
            (SELECT log.payload->>'plan_tier'
               FROM tanaghom.agent_actions_log log
              WHERE log.organization_id = organization.id
                AND log.entity_type = 'organization'
                AND log.entity_id = organization.id
                AND log.action_type LIKE 'billing.webhook.%'
                AND COALESCE((log.payload->>'stale_ignored')::boolean, false) = false
              ORDER BY log.created_at DESC, log.id DESC
              LIMIT 1) AS plan_tier
       FROM tanaghom.organizations organization
      WHERE organization.id = $1::uuid`,
    [organizationId],
  );
  const row = tenant.rows[0];
  const status = subscriptionStatus(row?.status);
  const active = status === "active";
  const tier = planTier(row?.plan_tier, active);
  const exclusion = excludeWorkspaceId || "00000000-0000-0000-0000-000000000000";

  const usage = await client.query<{ campaigns_used: string; runs_used: string; tokens_used: string }>(
    `SELECT
       (SELECT count(*)::int
          FROM tanaghom.agency_workspaces workspace
         WHERE workspace.organization_id = $1
           AND workspace.id <> $2::uuid
           AND (NOT $3::boolean OR workspace.started_at >= date_trunc('month', now()))
           AND (
             workspace.status IN ('queued', 'running', 'in_progress', 'waiting_review', 'approved')
             OR (workspace.status = 'failed' AND EXISTS (
               SELECT 1 FROM tanaghom.agency_workspace_steps step
                 JOIN tanaghom.agency_pilot_tasks task ON task.id = step.task_id
                WHERE step.workspace_id = workspace.id AND task.status = 'succeeded'
             ))
           )) AS campaigns_used,
       (SELECT count(*)::int
          FROM tanaghom.agency_workspace_events event
         WHERE event.organization_id = $1
           AND event.event_type IN ('started', 'resumed')) AS runs_used,
       (SELECT COALESCE(sum(GREATEST(0, (task.result->'usage'->>'total_tokens')::bigint)), 0)::bigint
          FROM tanaghom.agency_pilot_tasks task
         WHERE task.organization_id = $1
           AND task.result->'usage' IS NOT NULL
           AND COALESCE(task.finished_at, task.created_at) >= date_trunc('month', now())) AS tokens_used`,
    [organizationId, exclusion, active],
  );
  const campaignsUsed = count(usage.rows[0]?.campaigns_used);
  const runsUsed = count(usage.rows[0]?.runs_used);
  const tokensUsed = count(usage.rows[0]?.tokens_used);
  const tokenLimit = active ? PLAN_MONTHLY_TOKENS[tier || "starter"] : SANDBOX_MONTHLY_TOKEN_LIMIT;
  const campaignLimit = active ? PLAN_MONTHLY_CAMPAIGNS[tier || "starter"] : SANDBOX_CAMPAIGN_LIMIT;

  return {
    subscription_status: status,
    plan_tier: tier,
    is_sandbox: !active,
    campaigns_used: campaignsUsed,
    campaigns_limit: campaignLimit,
    runs_used: runsUsed,
    runs_limit: active ? null : SANDBOX_RUN_LIMIT,
    tokens_used: tokensUsed,
    tokens_limit: tokenLimit,
    max_retries_per_campaign: MAX_RETRIES_PER_CAMPAIGN,
    upgrade_required: !active && (campaignsUsed >= SANDBOX_CAMPAIGN_LIMIT || runsUsed >= SANDBOX_RUN_LIMIT || tokensUsed >= SANDBOX_MONTHLY_TOKEN_LIMIT),
    upgrade_url: UPGRADE_URL,
  };
}

export async function assertWorkspaceStartAllowed(
  client: Queryable,
  organizationId: string,
  workspaceId: string,
) {
  const quota = await loadWorkspaceQuota(client, organizationId, workspaceId);
  if (quota.tokens_used >= quota.tokens_limit) {
    throw new WorkspaceQuotaError(
      quota.is_sandbox ? "subscription_required_for_more_campaigns" : "plan_monthly_token_limit_reached",
      quota.is_sandbox ? 402 : 409,
    );
  }
  const retries = await client.query<{ count: string }>(
    `SELECT count(*)::int
       FROM tanaghom.agency_workspace_events
      WHERE organization_id = $1
        AND workspace_id = $2::uuid
        AND event_type = 'resumed'
        AND COALESCE((evidence->>'retried_from_failed')::boolean, false) = true`,
    [organizationId, workspaceId],
  );
  if (count(retries.rows[0]?.count) >= MAX_RETRIES_PER_CAMPAIGN) {
    throw new WorkspaceQuotaError("workspace_retry_limit_reached", 409);
  }
  if (quota.is_sandbox) {
    if (quota.campaigns_used >= SANDBOX_CAMPAIGN_LIMIT || quota.runs_used >= SANDBOX_RUN_LIMIT) {
      throw new WorkspaceQuotaError("subscription_required_for_more_campaigns", 402);
    }
  } else if (quota.campaigns_used >= quota.campaigns_limit) {
    throw new WorkspaceQuotaError("plan_monthly_campaign_limit_reached", 409);
  }
  return quota;
}

export class WorkspaceQuotaError extends Error {
  constructor(public code: string, public status = 409) {
    super(code);
  }
}

export async function loadWorkspaceUsage(client: Queryable, organizationId: string): Promise<WorkspaceUsage> {
  const result = await client.query<{
    month_prompt_tokens: string;
    month_completion_tokens: string;
    month_total_tokens: string;
  }>(
    `SELECT
       COALESCE(sum(GREATEST(0, (task.result->'usage'->>'prompt_tokens')::bigint)), 0)::bigint AS month_prompt_tokens,
       COALESCE(sum(GREATEST(0, (task.result->'usage'->>'completion_tokens')::bigint)), 0)::bigint AS month_completion_tokens,
       COALESCE(sum(GREATEST(0, (task.result->'usage'->>'total_tokens')::bigint)), 0)::bigint AS month_total_tokens
       FROM tanaghom.agency_pilot_tasks task
      WHERE task.organization_id = $1
        AND task.result->'usage' IS NOT NULL
        AND COALESCE(task.finished_at, task.created_at) >= date_trunc('month', now())`,
    [organizationId],
  );
  const row = result.rows[0];
  const prompt = count(row?.month_prompt_tokens);
  const completion = count(row?.month_completion_tokens);
  const total = count(row?.month_total_tokens);
  return {
    month_prompt_tokens: prompt,
    month_completion_tokens: completion,
    month_total_tokens: total,
    estimated_cost_usd: estimatedAiCostUsd(prompt, completion),
  };
}
