import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export const PLATFORM_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
export const LAUNCH_CONTROL_LOCK = "platform-launch-control";
export const LAUNCH_CONFIG_ACTION = "platform.launch_config.updated";
export const WAITLIST_ACTION = "platform.waitlist.joined";
export const LAUNCH100_REDEMPTION_ACTION = "billing.webhook.checkout.session.completed";

export interface LaunchConfig {
  cohort_cap: number;
  cohort_unlimited: boolean;
  launch100_enabled: boolean;
  launch100_max_redemptions: number;
}

export interface LaunchOffer {
  launch100_active: boolean;
  redemptions_used: number;
  redemptions_remaining: number;
  cohort_cap: number;
  active_workspaces: number;
  cohort_full: boolean;
  queue_position: number | null;
}

export interface WaitlistEntry {
  email: string | null;
  company_name: string | null;
  organization_id: string | null;
  locale: "en" | "ar";
  queue_position: number;
  joined_at: string;
}

type Queryable = Pick<Pool | PoolClient, "query">;

function integer(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function booleanValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

export function defaultLaunchConfig(env: NodeJS.ProcessEnv = process.env): LaunchConfig {
  return {
    cohort_cap: integer(env.LAUNCH_COHORT_CAP, 20, 1, 100_000),
    cohort_unlimited: booleanValue(env.LAUNCH_COHORT_UNLIMITED, false),
    launch100_enabled: booleanValue(env.LAUNCH100_ENABLED, true),
    launch100_max_redemptions: integer(env.LAUNCH100_MAX_REDEMPTIONS, 100, 1, 1_000_000),
  };
}

export function normalizeLaunchConfig(value: unknown, fallback = defaultLaunchConfig()): LaunchConfig {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    cohort_cap: integer(input.cohort_cap, fallback.cohort_cap, 1, 100_000),
    cohort_unlimited: booleanValue(input.cohort_unlimited, fallback.cohort_unlimited),
    launch100_enabled: booleanValue(input.launch100_enabled, fallback.launch100_enabled),
    launch100_max_redemptions: integer(
      input.launch100_max_redemptions,
      fallback.launch100_max_redemptions,
      1,
      1_000_000,
    ),
  };
}

export async function lockLaunchControl(client: Queryable) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [LAUNCH_CONTROL_LOCK]);
}

export async function loadLaunchConfig(client: Queryable): Promise<LaunchConfig> {
  const result = await client.query<{ payload: Record<string, unknown> }>(
    `SELECT payload
       FROM tanaghom.agent_actions_log
      WHERE organization_id = $1::uuid
        AND action_type = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [PLATFORM_ORGANIZATION_ID, LAUNCH_CONFIG_ACTION],
  );
  return normalizeLaunchConfig(result.rows[0]?.payload ?? null);
}

async function platformAuditActor(client: Queryable) {
  const human = await client.query<{ id: string }>(
    `SELECT actor.id
       FROM tanaghom.app_users actor
       JOIN tanaghom.users identity ON identity.id = actor.auth_subject
      WHERE actor.organization_id = $1::uuid
        AND actor.kind = 'human'
        AND actor.role = 'owner'
        AND actor.is_active
        AND actor.accepted_at IS NOT NULL
        AND identity.disabled = false
      ORDER BY actor.created_at
      LIMIT 1`,
    [PLATFORM_ORGANIZATION_ID],
  );
  if (human.rows[0]) return { actor_user_id: human.rows[0].id, agent_id: null };
  const fallbackHuman = await client.query<{ id: string }>(
    `SELECT id FROM tanaghom.app_users
      WHERE organization_id = $1::uuid AND kind = 'human' AND is_active
      ORDER BY created_at LIMIT 1`,
    [PLATFORM_ORGANIZATION_ID],
  );
  if (fallbackHuman.rows[0]) return { actor_user_id: fallbackHuman.rows[0].id, agent_id: null };
  const agent = await client.query<{ id: string }>(
    "SELECT id FROM tanaghom.agents ORDER BY created_at LIMIT 1",
  );
  if (!agent.rows[0]) throw new Error("platform_audit_actor_unavailable");
  return { actor_user_id: null, agent_id: agent.rows[0].id };
}

async function redemptionCount(client: Queryable) {
  const result = await client.query<{ used: string }>(
    `SELECT count(DISTINCT organization_id)::int AS used
       FROM tanaghom.agent_actions_log
      WHERE action_type = $1
        AND organization_id IS NOT NULL
        AND COALESCE(payload->>'stale_ignored', 'false') = 'false'
        AND payload->>'promo_code' = 'LAUNCH100'`,
    [LAUNCH100_REDEMPTION_ACTION],
  );
  return Number(result.rows[0]?.used) || 0;
}

async function activeWorkspaceCount(client: Queryable, callerOrganizationId: string) {
  const result = await client.query<{ active: string }>(
    `SELECT count(*)::int AS active
       FROM tanaghom.organizations
      WHERE status = 'active' AND id <> $1::uuid`,
    [callerOrganizationId],
  );
  return Number(result.rows[0]?.active) || 0;
}

interface WaitlistRow {
  id: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

async function findWaitlistEntry(client: Queryable, input: {
  organizationId?: string | null;
  email?: string | null;
}) {
  const result = await client.query<WaitlistRow>(
    `SELECT id, payload, created_at
       FROM tanaghom.agent_actions_log
      WHERE organization_id = $1::uuid
        AND action_type = $2
        AND (
          ($3::uuid IS NOT NULL AND payload->>'organization_id' = $3::text)
          OR lower(payload->>'email') = $4
        )
      ORDER BY created_at, id
      LIMIT 1`,
    [PLATFORM_ORGANIZATION_ID, WAITLIST_ACTION, input.organizationId || null, (input.email || "").toLowerCase()],
  );
  return result.rows[0] || null;
}

async function queuePositionFor(client: Queryable, entryId: string | null) {
  if (!entryId) return null;
  const result = await client.query<{ position: string }>(
    `SELECT count(*)::int AS position
       FROM tanaghom.agent_actions_log waitlist
       JOIN tanaghom.agent_actions_log target ON target.id = $3::uuid
      WHERE waitlist.organization_id = $1::uuid
        AND waitlist.action_type = $2
        AND (waitlist.created_at, waitlist.id) <= (target.created_at, target.id)`,
    [PLATFORM_ORGANIZATION_ID, WAITLIST_ACTION, entryId],
  );
  return Number(result.rows[0]?.position) || null;
}

export async function waitlistQueuePosition(client: Queryable, organizationId: string | null) {
  if (!organizationId) return null;
  const entry = await findWaitlistEntry(client, { organizationId });
  return queuePositionFor(client, entry?.id || null);
}

export async function joinWaitlist(client: Queryable, input: {
  organizationId?: string | null;
  email: string;
  companyName?: string | null;
  locale: "en" | "ar";
}) {
  const normalizedEmail = input.email.trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("waitlist_email_invalid");
  const existing = await findWaitlistEntry(client, {
    organizationId: input.organizationId || null,
    email: normalizedEmail,
  });
  if (existing) {
    return {
      queue_position: await queuePositionFor(client, existing.id),
      already_joined: true,
    };
  }
  const actor = await platformAuditActor(client);
  const config = await loadLaunchConfig(client);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO tanaghom.agent_actions_log
       (correlation_id, agent_id, actor_user_id, action_type, entity_type, entity_id, organization_id, payload, result)
     VALUES ($1, $2, $3, $4, 'platform', $5::uuid, $5::uuid, $6::jsonb, 'success')
     RETURNING id`,
    [
      randomUUID(),
      actor.agent_id,
      actor.actor_user_id,
      WAITLIST_ACTION,
      PLATFORM_ORGANIZATION_ID,
      JSON.stringify({
        organization_id: input.organizationId || null,
        email: normalizedEmail,
        company_name: (input.companyName || "").trim().slice(0, 160) || null,
        locale: input.locale,
        cohort_cap: config.cohort_cap,
        external_actions: 0,
      }),
    ],
  );
  return {
    queue_position: await queuePositionFor(client, inserted.rows[0].id),
    already_joined: false,
  };
}

async function waitlistCount(client: Queryable) {
  const result = await client.query<{ total: string }>(
    `SELECT count(*)::int AS total
       FROM tanaghom.agent_actions_log
      WHERE organization_id = $1::uuid AND action_type = $2`,
    [PLATFORM_ORGANIZATION_ID, WAITLIST_ACTION],
  );
  return Number(result.rows[0]?.total) || 0;
}

export interface LaunchGate {
  config: LaunchConfig;
  offer: LaunchOffer;
  blocked: boolean;
}

export async function evaluateLaunchGate(
  client: Queryable,
  organizationId: string,
  options: { active: boolean } ,
): Promise<LaunchGate> {
  const config = await loadLaunchConfig(client);
  const activeWorkspaces = await activeWorkspaceCount(client, organizationId);
  const used = await redemptionCount(client);
  const queuePosition = await waitlistQueuePosition(client, organizationId);
  const remaining = Math.max(0, config.launch100_max_redemptions - used);
  const cohortFull = !config.cohort_unlimited && activeWorkspaces >= config.cohort_cap;
  return {
    config,
    offer: {
      launch100_active: config.launch100_enabled && remaining > 0,
      redemptions_used: used,
      redemptions_remaining: remaining,
      cohort_cap: config.cohort_cap,
      active_workspaces: activeWorkspaces,
      cohort_full: cohortFull,
      queue_position: queuePosition,
    },
    blocked: !options.active && cohortFull,
  };
}

export async function loadLaunchOffer(client: Queryable, organizationId: string, active: boolean) {
  return (await evaluateLaunchGate(client, organizationId, { active })).offer;
}

export async function loadPublicLaunchOffer(client: Queryable) {
  const emptyOrganization = "00000000-0000-4000-8000-000000000000";
  const config = await loadLaunchConfig(client);
  const activeWorkspaces = await activeWorkspaceCount(client, emptyOrganization);
  const used = await redemptionCount(client);
  const remaining = Math.max(0, config.launch100_max_redemptions - used);
  return {
    launch100_active: config.launch100_enabled && remaining > 0,
    redemptions_used: used,
    redemptions_remaining: remaining,
    cohort_cap: config.cohort_cap,
    cohort_unlimited: config.cohort_unlimited,
    active_workspaces: activeWorkspaces,
    cohort_full: !config.cohort_unlimited && activeWorkspaces >= config.cohort_cap,
    waitlist_count: await waitlistCount(client),
  };
}

export async function listWaitlist(client: Queryable, limit = 100): Promise<WaitlistEntry[]> {
  const result = await client.query<WaitlistRow>(
    `SELECT id, payload, created_at
       FROM tanaghom.agent_actions_log
      WHERE organization_id = $1::uuid AND action_type = $2
      ORDER BY created_at, id
      LIMIT $3`,
    [PLATFORM_ORGANIZATION_ID, WAITLIST_ACTION, Math.max(1, Math.min(limit, 250))],
  );
  return result.rows.map((row, index) => ({
    email: typeof row.payload.email === "string" ? row.payload.email : null,
    company_name: typeof row.payload.company_name === "string" ? row.payload.company_name : null,
    organization_id: typeof row.payload.organization_id === "string" ? row.payload.organization_id : null,
    locale: row.payload.locale === "ar" ? "ar" : "en",
    queue_position: index + 1,
    joined_at: row.created_at.toISOString(),
  }));
}

export async function writeLaunchConfig(client: Queryable, input: LaunchConfig, actorUserId: string) {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO tanaghom.agent_actions_log
       (correlation_id, actor_user_id, action_type, entity_type, entity_id, organization_id, payload, result)
     VALUES ($1, $2, $3, 'platform', $4::uuid, $4::uuid, $5::jsonb, 'success')
     RETURNING id`,
    [
      randomUUID(),
      actorUserId,
      LAUNCH_CONFIG_ACTION,
      PLATFORM_ORGANIZATION_ID,
      JSON.stringify({ ...input, external_actions: 0 }),
    ],
  );
  return { id: inserted.rows[0].id, config: input };
}
