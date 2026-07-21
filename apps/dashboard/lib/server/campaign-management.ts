import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize, type ApplicationUser } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { noStore } from "@/lib/server/responses";

const productTypes = new Set(["camp", "book", "coaching_program", "course"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CampaignInput {
  name: string;
  brief: string;
  productType: string;
  targetAudience: { audience: string; geography: string; languages: string[] };
  budgetTarget: number | null;
  revenueTarget: number | null;
  currency: string;
  contentItemTarget: number;
}

export class CampaignRequestError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum + 1) : "";
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 999_999_999_999.99 ? parsed : Number.NaN;
}

async function requestBody(request: NextRequest) {
  try { return await request.json() as Record<string, unknown>; }
  catch { throw new CampaignRequestError("invalid_json"); }
}

async function campaignInput(request: NextRequest): Promise<CampaignInput> {
  const body = await requestBody(request);
  const name = text(body.name, 200);
  const brief = text(body.brief, 12000);
  const productType = text(body.product_type, 40);
  const audience = text(body.audience, 1000);
  const geography = text(body.geography, 300);
  const languages = Array.isArray(body.languages)
    ? [...new Set(body.languages.map((value) => text(value, 10)).filter(Boolean))].slice(0, 10)
    : [];
  const budgetTarget = numberOrNull(body.budget_target);
  const revenueTarget = numberOrNull(body.revenue_target);
  const currency = text(body.currency, 3).toUpperCase();
  const contentItemTarget = Number(body.content_item_target);

  if (name.length < 3 || brief.length < 20 || !productTypes.has(productType)
    || audience.length < 10 || geography.length < 2
    || languages.length < 1 || languages.some((language) => language !== "en" && language !== "ar")
    || Number.isNaN(budgetTarget) || Number.isNaN(revenueTarget)
    || !/^[A-Z]{3}$/.test(currency)
    || !Number.isInteger(contentItemTarget) || contentItemTarget < 1 || contentItemTarget > 12) {
    throw new CampaignRequestError("campaign_input_invalid");
  }

  return {
    name, brief, productType,
    targetAudience: { audience, geography, languages },
    budgetTarget, revenueTarget, currency, contentItemTarget,
  };
}

function validCampaignId(campaignId: string) {
  if (!uuidPattern.test(campaignId)) throw new CampaignRequestError("campaign_id_invalid");
  return campaignId;
}

function idempotencyKey(request: NextRequest) {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new CampaignRequestError("valid_idempotency_key_required");
  }
  return key;
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/campaign not found/i.test(message)) return new CampaignRequestError("campaign_not_found", 404);
  if (/valid campaign brief|audience|targets|content count/i.test(message)) {
    return new CampaignRequestError("campaign_input_invalid", 400);
  }
  if (/active campaign operator required|active human reviewer required/i.test(message)) {
    return new CampaignRequestError("campaign_action_forbidden", 403);
  }
  if (/current status|draft campaign|strategy-ready|approval boundary|active core work|already exists|not complete|human decision|approved content/i.test(message)) {
    return new CampaignRequestError("campaign_transition_rejected", 409);
  }
  return error;
}

async function idempotentMutation<T extends Record<string, unknown>>(
  request: NextRequest,
  user: ApplicationUser,
  operationType: string,
  requestValue: unknown,
  responseStatus: number,
  mutate: (client: PoolClient) => Promise<T>,
) {
  const key = idempotencyKey(request);
  const requestHash = fingerprint(requestValue);
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const reservation = await client.query<{ id: string }>(
      `INSERT INTO tanaghom.api_idempotency_keys
        (actor_user_id,operation_type,idempotency_key,request_hash)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (actor_user_id,operation_type,idempotency_key) DO NOTHING
       RETURNING id`,
      [user.id, operationType, key, requestHash],
    );
    if (!reservation.rows[0]) {
      const existing = await client.query<{
        request_hash: string; status: string; response_status: number | null; response_body: T | null;
      }>(
        `SELECT request_hash,status,response_status,response_body
           FROM tanaghom.api_idempotency_keys
          WHERE actor_user_id=$1 AND operation_type=$2 AND idempotency_key=$3`,
        [user.id, operationType, key],
      );
      const replay = existing.rows[0];
      if (!replay || replay.request_hash !== requestHash) {
        throw new CampaignRequestError("idempotency_key_reused", 409);
      }
      if (replay.status !== "completed" || !replay.response_status || !replay.response_body) {
        throw new CampaignRequestError("campaign_action_in_progress", 409);
      }
      await client.query("COMMIT");
      const response = noStore(replay.response_body, { status: replay.response_status });
      response.headers.set("Idempotency-Replayed", "true");
      return response;
    }

    const responseBody = await mutate(client);
    await client.query(
      `UPDATE tanaghom.api_idempotency_keys
          SET status='completed',response_status=$2,response_body=$3::jsonb,completed_at=now()
        WHERE id=$1`,
      [reservation.rows[0].id, responseStatus, JSON.stringify(responseBody)],
    );
    await client.query("COMMIT");
    return noStore(responseBody, { status: responseStatus });
  } catch (error) {
    await client.query("ROLLBACK");
    throw databaseError(error);
  } finally { client.release(); }
}

export async function listCampaigns(request: NextRequest) {
  const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
  const campaigns = await database().query(
    `SELECT campaign.id,campaign.name,campaign.product_type,campaign.status,
            campaign.blocked_reason,campaign.budget_target,campaign.revenue_target,
            campaign.currency,campaign.content_item_target,campaign.created_at,campaign.updated_at,
            core_job.job_type AS core_job_type,core_job.status AS core_job_status,
            count(DISTINCT content.id)::int AS content_total,
            count(DISTINCT content.id) FILTER (WHERE content.status='pending_approval')::int AS content_pending,
            count(DISTINCT lead.id)::int AS leads_total
       FROM tanaghom.campaigns campaign
       LEFT JOIN tanaghom.content_items content ON content.campaign_id=campaign.id
       LEFT JOIN tanaghom.leads lead ON lead.campaign_id=campaign.id
       LEFT JOIN LATERAL (
         SELECT job.job_type,job.status FROM tanaghom.agent_jobs job
         WHERE job.campaign_id=campaign.id
           AND job.job_type IN ('campaign.strategy.generate','campaign.content.generate')
           AND job.status IN ('queued','running','waiting_approval')
         ORDER BY job.created_at DESC LIMIT 1
       ) core_job ON true
      WHERE campaign.organization_id=$1
      GROUP BY campaign.id,core_job.job_type,core_job.status
      ORDER BY (campaign.status IN ('blocked_missing_info','awaiting_approval')) DESC,campaign.updated_at DESC
      LIMIT 100`,
    [user.organizationId],
  );
  return { current_user: user, campaigns: campaigns.rows };
}

export async function createCampaign(request: NextRequest) {
  enforceSameOriginForCookieMutation(request);
  const [user, input] = await Promise.all([
    authorize(request, ["owner", "operator"]), campaignInput(request),
  ]);
  return idempotentMutation(request, user, "campaign.create", input, 201, async (client) => {
    const result = await client.query(
      `SELECT * FROM tanaghom.create_campaign_draft(
        $1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9
      )`,
      [user.id, input.name, input.brief, input.productType,
        JSON.stringify(input.targetAudience), input.budgetTarget, input.revenueTarget,
        input.currency, input.contentItemTarget],
    );
    return { ok: true, campaign: result.rows[0] };
  });
}

export async function reviseCampaign(request: NextRequest, campaignId: string) {
  enforceSameOriginForCookieMutation(request);
  validCampaignId(campaignId);
  const [user, input] = await Promise.all([
    authorize(request, ["owner", "operator"]), campaignInput(request),
  ]);
  return idempotentMutation(request, user, "campaign.revise", { campaignId, input }, 200, async (client) => {
    const result = await client.query(
      `SELECT * FROM tanaghom.revise_campaign_brief(
        $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10
      )`,
      [campaignId, user.id, input.name, input.brief, input.productType,
        JSON.stringify(input.targetAudience), input.budgetTarget, input.revenueTarget,
        input.currency, input.contentItemTarget],
    );
    return { ok: true, campaign: result.rows[0] };
  });
}

async function campaignAction(
  request: NextRequest,
  campaignId: string,
  operationType: string,
  databaseFunction: "queue_campaign_strategy" | "queue_campaign_content" | "mark_campaign_ready",
) {
  enforceSameOriginForCookieMutation(request);
  validCampaignId(campaignId);
  const user = await authorize(request, ["owner", "operator"]);
  return idempotentMutation(request, user, operationType, { campaignId }, 200, async (client) => {
    const result = await client.query(
      `SELECT * FROM tanaghom.${databaseFunction}($1,$2)`, [campaignId, user.id],
    );
    return { ok: true, result: result.rows[0] };
  });
}

export function startCampaignStrategy(request: NextRequest, campaignId: string) {
  return campaignAction(request, campaignId, "campaign.start_strategy", "queue_campaign_strategy");
}
export function startCampaignContent(request: NextRequest, campaignId: string) {
  return campaignAction(request, campaignId, "campaign.start_content", "queue_campaign_content");
}
export function markCampaignReady(request: NextRequest, campaignId: string) {
  return campaignAction(request, campaignId, "campaign.mark_ready", "mark_campaign_ready");
}

export async function getCampaign(request: NextRequest, campaignId: string) {
  validCampaignId(campaignId);
  const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
  const client = await database().connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const campaign = await client.query(
      `SELECT campaign.*,creator.display_name AS created_by_name
         FROM tanaghom.campaigns campaign
         JOIN tanaghom.app_users creator ON creator.id=campaign.created_by
        WHERE campaign.id=$1 AND campaign.organization_id=$2`,
      [campaignId, user.organizationId],
    );
    if (!campaign.rows[0]) throw new CampaignRequestError("campaign_not_found", 404);

    const [strategies, jobs, content, audit, workers] = await Promise.all([
      client.query(
        `SELECT id,version,positioning,key_messages,channels,posting_cadence,
                content_pillars,model_name,prompt_version,created_at
           FROM tanaghom.campaign_strategies
          WHERE campaign_id=$1 ORDER BY version DESC`, [campaignId],
      ),
      client.query(
        `SELECT job.id,job.correlation_id,job.job_type,job.status,job.attempt,
                job.max_attempts,job.error_code,job.error_message,job.created_at,
                job.available_at,job.started_at,job.finished_at,job.updated_at,
                agent.code AS agent_code,agent.name AS agent_name
           FROM tanaghom.agent_jobs job
           JOIN tanaghom.agents agent ON agent.id=job.agent_id
          WHERE job.campaign_id=$1 ORDER BY job.created_at DESC`, [campaignId],
      ),
      client.query(
        `SELECT content.id,content.strategy_id,content.parent_content_id,content.generation,
                content.channel,content.content_type,content.draft_copy,content.media_brief,
                content.media_url,content.status,content.scheduled_time,content.created_at,
                content.updated_at,approval.id AS approval_id,approval.decision,
                approval.rejection_reason,approval.decided_at,reviewer.display_name AS decided_by_name,
                post.id AS post_id,post.status AS post_status,post.provider_post_id
           FROM tanaghom.content_items content
           LEFT JOIN LATERAL (
             SELECT decision.* FROM tanaghom.content_approvals decision
             WHERE decision.content_item_id=content.id ORDER BY decision.decided_at DESC LIMIT 1
           ) approval ON true
           LEFT JOIN tanaghom.app_users reviewer ON reviewer.id=approval.decided_by
           LEFT JOIN tanaghom.posts post ON post.content_item_id=content.id
          WHERE content.campaign_id=$1
          ORDER BY content.created_at,content.id`, [campaignId],
      ),
      client.query(
        `SELECT action.id,action.correlation_id,action.action_type,action.entity_type,
                action.entity_id,action.payload,action.result,action.created_at,
                actor.display_name AS actor_name,agent.name AS agent_name
           FROM tanaghom.agent_actions_log action
           LEFT JOIN tanaghom.app_users actor ON actor.id=action.actor_user_id
           LEFT JOIN tanaghom.agents agent ON agent.id=action.agent_id
          WHERE action.entity_id=$1
             OR action.job_id IN (SELECT id FROM tanaghom.agent_jobs WHERE campaign_id=$1)
             OR action.entity_id IN (SELECT id FROM tanaghom.content_items WHERE campaign_id=$1)
             OR action.entity_id IN (SELECT id FROM tanaghom.campaign_strategies WHERE campaign_id=$1)
          ORDER BY action.created_at DESC LIMIT 50`, [campaignId],
      ),
      client.query(
        `SELECT code,name,runtime_state,trigger_state,runtime_verified_at,runtime_evidence
           FROM tanaghom.agent_workflow_registry
          WHERE code IN ('campaign_strategy_generator','campaign_content_generator')
          ORDER BY display_order`,
      ),
    ]);
    await client.query("COMMIT");
    return {
      campaign: campaign.rows[0], strategies: strategies.rows, jobs: jobs.rows,
      content: content.rows, audit: audit.rows, workers: workers.rows,
      permissions: {
        can_operate: user.role === "owner" || user.role === "operator",
        can_review: user.role === "owner" || user.role === "reviewer",
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
