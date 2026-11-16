import "server-only";

import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import type { Pool, PoolClient } from "pg";

import { authorize, type ApplicationUser } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import {
  PLATFORM_ORGANIZATION_ID,
  listWaitlist,
  loadLaunchConfig,
  loadLaunchOffer,
  lockLaunchControl,
  normalizeLaunchConfig,
  waitlistQueuePosition,
  writeLaunchConfig,
  type LaunchConfig,
} from "@/lib/server/launch-control";
import { postizWorkspaceConfigured } from "@/lib/server/postiz-tenant";
import {
  PLAN_DEFINITIONS,
  isStripeCheckoutConfigured,
  type PlanId,
  type TenantSubscriptionStatus,
} from "@/lib/server/stripe-billing";

type Queryable = Pick<Pool | PoolClient, "query">;

export class SuperAdminNotFound extends Error {}

export interface SuperAdminUser extends ApplicationUser {
  email: string;
}

const STATUSES: readonly TenantSubscriptionStatus[] = ["trialing", "active", "past_due", "canceled"];
const TIERS: readonly PlanId[] = ["starter", "growth", "scale"];

function superAdminEmails() {
  return new Set(
    (process.env.SUPER_ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPlatformSuperAdmin(
  user: Pick<ApplicationUser, "organizationId" | "role">,
  email: string,
  allowedEmails = superAdminEmails(),
) {
  const normalized = email.trim().toLowerCase();
  if (allowedEmails.size > 0) return Boolean(normalized && allowedEmails.has(normalized));
  return user.organizationId === PLATFORM_ORGANIZATION_ID && user.role === "owner";
}

export async function requireSuperAdmin(request: Parameters<typeof authorize>[0]): Promise<SuperAdminUser> {
  const user = await authorize(request, ["owner"]);
  const profile = await database().query<{ email: string }>(
    "SELECT email FROM tanaghom.app_users WHERE id = $1::uuid AND organization_id = $2::uuid AND kind = 'human'",
    [user.id, user.organizationId],
  );
  const email = profile.rows[0]?.email?.trim().toLowerCase() || "";
  if (!isPlatformSuperAdmin(user, email)) throw new SuperAdminNotFound("not_found");
  return { ...user, email };
}

function configuredFile(path: string, minimum = 1) {
  try {
    return existsSync(path) && statSync(path).size >= minimum;
  } catch {
    return false;
  }
}

export function aiWorkerConfigured() {
  const provider = (process.env.AGENCY_WORKSPACE_PROVIDER || "gemma").toLowerCase();
  const keyFile = process.env.GEMINI_API_KEY_FILE || "/run/secrets/gemini_api_key";
  const gemini = configuredFile(keyFile, 20);
  const gemma = Boolean(process.env.GEMMA_API_KEY?.trim());
  return process.env.AGENCY_WORKSPACE_ENABLED === "true"
    && (provider === "gemini" ? gemini : gemma)
    && Boolean(process.env.AGENCY_WORKSPACE_DATABASE_URL)
    && (process.env.AGENCY_WORKSPACE_WORKER_TOKEN?.length || 0) >= 32;
}

function money(value: number) {
  return Number(value.toFixed(2));
}

export async function platformSnapshot(client: Queryable, actor: SuperAdminUser) {
  const organizationCounts = await client.query<{ status: string; count: string }>(
    `SELECT status, count(*)::int AS count
       FROM tanaghom.organizations
      GROUP BY status`,
  );
  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<TenantSubscriptionStatus, number>;
  let totalWorkspaces = 0;
  for (const row of organizationCounts.rows) {
    totalWorkspaces += Number(row.count) || 0;
    if (STATUSES.includes(row.status as TenantSubscriptionStatus)) {
      byStatus[row.status as TenantSubscriptionStatus] = Number(row.count) || 0;
    }
  }

  const users = await client.query<{ total: string; verified: string }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE identity.email_verified_at IS NOT NULL)::int AS verified
       FROM tanaghom.app_users actor
       LEFT JOIN tanaghom.users identity ON identity.id = actor.auth_subject
      WHERE actor.kind = 'human'`,
  );

  const subscribers = await client.query<{
    organization_id: string;
    plan_tier: string;
    used_launch100: boolean;
  }>(
    `SELECT organization.id,
            latest.payload->>'plan_tier' AS plan_tier,
            EXISTS (
              SELECT 1 FROM tanaghom.agent_actions_log redemption
               WHERE redemption.organization_id = organization.id
                 AND redemption.action_type = 'billing.webhook.checkout.session.completed'
                 AND redemption.payload->>'promo_code' = 'LAUNCH100'
            ) AS used_launch100
       FROM tanaghom.organizations organization
       JOIN LATERAL (
         SELECT payload
           FROM tanaghom.agent_actions_log log
          WHERE log.organization_id = organization.id
            AND log.entity_type = 'organization'
            AND log.entity_id = organization.id
            AND log.action_type LIKE 'billing.webhook.%'
            AND COALESCE((log.payload->>'stale_ignored')::boolean, false) = false
          ORDER BY log.created_at DESC, log.id DESC
          LIMIT 1
       ) latest ON true
      WHERE organization.status = 'active'
        AND latest.payload->>'plan_tier' = ANY($1::text[])`,
    [TIERS],
  );
  const subscribersByTier: Record<PlanId, number> = { starter: 0, growth: 0, scale: 0 };
  let estimatedMrr = 0;
  for (const row of subscribers.rows) {
    const tier = TIERS.includes(row.plan_tier as PlanId) ? row.plan_tier as PlanId : null;
    if (!tier) continue;
    const plan = PLAN_DEFINITIONS.find((item) => item.id === tier);
    if (!plan) continue;
    subscribersByTier[tier] += 1;
    estimatedMrr += (row.used_launch100 ? plan.promoAmountMinor : plan.amountMinor) / 100;
  }

  const launchConfig = await loadLaunchConfig(client);
  const offer = await loadLaunchOffer(client, actor.organizationId, false);
  const waitlist = await listWaitlist(client, 100);
  const waitlistTotal = await client.query<{ total: string }>(
    `SELECT count(*)::int AS total
       FROM tanaghom.agent_actions_log
      WHERE organization_id = $1::uuid AND action_type = 'platform.waitlist.joined'`,
    [PLATFORM_ORGANIZATION_ID],
  );

  const ai = await client.query<{
    campaigns_total: string;
    campaigns_en: string;
    campaigns_ar: string;
    tasks_succeeded: string;
    tasks_failed: string;
    month_total_tokens: string;
    month_prompt_tokens: string;
    month_completion_tokens: string;
  }>(
    `SELECT
       (SELECT count(*)::int FROM tanaghom.agency_workspaces) AS campaigns_total,
       (SELECT count(*)::int FROM tanaghom.agency_workspaces WHERE language = 'en') AS campaigns_en,
       (SELECT count(*)::int FROM tanaghom.agency_workspaces WHERE language = 'ar') AS campaigns_ar,
       (SELECT count(*)::int FROM tanaghom.agency_pilot_tasks WHERE status = 'succeeded') AS tasks_succeeded,
       (SELECT count(*)::int FROM tanaghom.agency_pilot_tasks WHERE status = 'failed') AS tasks_failed,
       (SELECT COALESCE(sum(GREATEST(0, (task.result->'usage'->>'total_tokens')::bigint)), 0)::bigint
          FROM tanaghom.agency_pilot_tasks task
         WHERE task.result->'usage' IS NOT NULL
           AND COALESCE(task.finished_at, task.created_at) >= date_trunc('month', now())) AS month_total_tokens,
       (SELECT COALESCE(sum(GREATEST(0, (task.result->'usage'->>'prompt_tokens')::bigint)), 0)::bigint
          FROM tanaghom.agency_pilot_tasks task
         WHERE task.result->'usage' IS NOT NULL
           AND COALESCE(task.finished_at, task.created_at) >= date_trunc('month', now())) AS month_prompt_tokens,
       (SELECT COALESCE(sum(GREATEST(0, (task.result->'usage'->>'completion_tokens')::bigint)), 0)::bigint
          FROM tanaghom.agency_pilot_tasks task
         WHERE task.result->'usage' IS NOT NULL
           AND COALESCE(task.finished_at, task.created_at) >= date_trunc('month', now())) AS month_completion_tokens`,
  );
  const aiRow = ai.rows[0];
  const prompt = Number(aiRow?.month_prompt_tokens) || 0;
  const completion = Number(aiRow?.month_completion_tokens) || 0;

  const recent = await client.query<{
    id: string;
    name: string;
    slug: string;
    status: string;
    plan_tier: string | null;
    created_at: Date;
    campaigns_count: string;
  }>(
    `SELECT organization.id, organization.name, organization.slug, organization.status,
            latest.payload->>'plan_tier' AS plan_tier, organization.created_at,
            (SELECT count(*)::int FROM tanaghom.agency_workspaces workspace
              WHERE workspace.organization_id = organization.id) AS campaigns_count
       FROM tanaghom.organizations organization
       LEFT JOIN LATERAL (
         SELECT payload
           FROM tanaghom.agent_actions_log log
          WHERE log.organization_id = organization.id
            AND log.entity_type = 'organization'
            AND log.entity_id = organization.id
            AND log.action_type LIKE 'billing.webhook.%'
            AND COALESCE((log.payload->>'stale_ignored')::boolean, false) = false
          ORDER BY log.created_at DESC, log.id DESC
          LIMIT 1
       ) latest ON true
      ORDER BY organization.created_at DESC
      LIMIT 20`,
  );

  const breaker = await client.query<{ enabled: boolean; emergency_stop: boolean; reason: string; updated_at: Date }>(
    `SELECT enabled, emergency_stop, reason, updated_at
       FROM tanaghom.agency_workspace_control
      ORDER BY updated_at DESC LIMIT 1`,
  );
  const circuit = breaker.rows[0] || {
    enabled: false,
    emergency_stop: true,
    reason: "Control unavailable",
    updated_at: new Date(0),
  };

  return {
    kpis: {
      total_workspaces: totalWorkspaces,
      workspaces_by_status: byStatus,
      total_users: Number(users.rows[0]?.total) || 0,
      verified_users: Number(users.rows[0]?.verified) || 0,
      subscribers_by_tier: subscribersByTier,
      estimated_mrr_usd: money(estimatedMrr),
    },
    launch100: {
      enabled: launchConfig.launch100_enabled,
      max_redemptions: launchConfig.launch100_max_redemptions,
      used: offer.redemptions_used,
      remaining: offer.redemptions_remaining,
    },
    cohort: {
      cap: launchConfig.cohort_cap,
      unlimited: launchConfig.cohort_unlimited,
      active_count: byStatus.active,
      waitlist_count: Number(waitlistTotal.rows[0]?.total) || 0,
      waitlist_entries: waitlist,
    },
    ai_usage: {
      campaigns_total: Number(aiRow?.campaigns_total) || 0,
      campaigns_en: Number(aiRow?.campaigns_en) || 0,
      campaigns_ar: Number(aiRow?.campaigns_ar) || 0,
      tasks_succeeded: Number(aiRow?.tasks_succeeded) || 0,
      tasks_failed: Number(aiRow?.tasks_failed) || 0,
      month_total_tokens: Number(aiRow?.month_total_tokens) || 0,
      estimated_ai_spend_usd: money((prompt / 1_000_000) * 0.3 + (completion / 1_000_000) * 2.5),
    },
    recent_workspaces: recent.rows.map((row) => ({
      ...row,
      campaigns_count: Number(row.campaigns_count) || 0,
      plan_tier: TIERS.includes(row.plan_tier as PlanId) ? row.plan_tier : null,
    })),
    ai_circuit_breaker: {
      enabled: circuit.enabled,
      emergency_stop: circuit.emergency_stop,
      reason: circuit.reason,
      updated_at: circuit.updated_at,
    },
    services: {
      database: "connected",
      ai_worker_configured: aiWorkerConfigured(),
      postiz_configured: postizWorkspaceConfigured(),
      stripe_configured: isStripeCheckoutConfigured(),
    },
  };
}

export async function superAdminSnapshot(actor: SuperAdminUser) {
  const client = await database().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = await platformSnapshot(client, actor);
    await client.query("COMMIT");
    return snapshot;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function auditPlatformAction(
  client: Queryable,
  actor: SuperAdminUser,
  actionType: string,
  payload: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO tanaghom.agent_actions_log
       (correlation_id, actor_user_id, action_type, entity_type, entity_id, organization_id, payload, result)
     VALUES ($1, $2, $3, 'platform', $4::uuid, $4::uuid, $5::jsonb, 'success')`,
    [
      randomUUID(),
      actor.id,
      actionType,
      PLATFORM_ORGANIZATION_ID,
      JSON.stringify({ ...payload, external_actions: 0 }),
    ],
  );
}

export async function setCircuitBreaker(
  actor: SuperAdminUser,
  input: { enabled: boolean; emergencyStop: boolean; reason?: string },
) {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ state: Record<string, unknown> }>(
      "SELECT tanaghom.set_agency_workspace_circuit_breaker($1,$2,$3) AS state",
      [input.enabled, input.emergencyStop, input.reason || ""],
    );
    await auditPlatformAction(client, actor, "platform.ai_circuit_breaker.reset", {
      enabled: input.enabled,
      emergency_stop: input.emergencyStop,
      reason: input.reason || "",
      state: result.rows[0]?.state || null,
    });
    await client.query("COMMIT");
    return result.rows[0]?.state || null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateLaunchConfiguration(
  actor: SuperAdminUser,
  input: { cohortCap: number; cohortUnlimited: boolean; launch100Enabled: boolean; launch100MaxRedemptions?: number },
) {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    await lockLaunchControl(client);
    const current = await loadLaunchConfig(client);
    const next: LaunchConfig = normalizeLaunchConfig({
      cohort_cap: input.cohortCap,
      cohort_unlimited: input.cohortUnlimited,
      launch100_enabled: input.launch100Enabled,
      launch100_max_redemptions: input.launch100MaxRedemptions ?? current.launch100_max_redemptions,
    }, current);
    if (next.cohort_cap !== input.cohortCap || next.cohort_unlimited !== input.cohortUnlimited
      || next.launch100_enabled !== input.launch100Enabled
      || (input.launch100MaxRedemptions !== undefined && next.launch100_max_redemptions !== input.launch100MaxRedemptions)) {
      throw new Error("launch_config_invalid");
    }
    const written = await writeLaunchConfig(client, next, actor.id);
    await client.query("COMMIT");
    return { ...written.config, updated_at: new Date().toISOString() };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function superAdminWaitlistPosition(organizationId: string) {
  return waitlistQueuePosition(database(), organizationId);
}
