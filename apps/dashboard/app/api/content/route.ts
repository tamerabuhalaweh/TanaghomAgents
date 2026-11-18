import type { NextRequest } from "next/server";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { postizHandoffEnabled } from "@/lib/server/postiz-handoff";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

const statuses = new Set(["draft", "pending_approval", "approved", "rejected", "scheduled", "posted", "cancelled"]);

export async function GET(request: NextRequest) {
  try {
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const requestedStatus = request.nextUrl.searchParams.get("status") || "";
    const status = statuses.has(requestedStatus) ? requestedStatus : null;
    const search = (request.nextUrl.searchParams.get("search") || "").trim().slice(0, 100);
    const result = await database().query(
      `SELECT content.id, content.campaign_id, campaign.name AS campaign_name,
              content.channel, content.content_type, content.draft_copy, content.media_brief,
              content.media_url, content.status, content.generation, content.scheduled_time,
              content.created_at, content.updated_at, strategy.version AS strategy_version,
              approval.decision, approval.rejection_reason, approval.decided_at,
              reviewer.display_name AS decided_by_name,
              post.provider, post.provider_post_id, post.status AS post_status,
              post.posted_at, post.last_synced_at,
              handoff.id AS handoff_job_id, handoff.status AS handoff_status,
              handoff.error_code AS handoff_error_code,
              handoff.error_message AS handoff_error_message,
              handoff.created_at AS handoff_requested_at,
              handoff.updated_at AS handoff_updated_at,
              operation.status AS external_operation_status,
              (channel_mapping.id IS NOT NULL) AS postiz_channel_ready
         FROM tanaghom.content_items content
         JOIN tanaghom.campaigns campaign ON campaign.id = content.campaign_id
         JOIN tanaghom.campaign_strategies strategy ON strategy.id = content.strategy_id
         LEFT JOIN LATERAL (
           SELECT decision, rejection_reason, decided_by, decided_at
             FROM tanaghom.content_approvals
            WHERE content_item_id = content.id
            ORDER BY decided_at DESC LIMIT 1
         ) approval ON true
         LEFT JOIN tanaghom.app_users reviewer ON reviewer.id = approval.decided_by
         LEFT JOIN tanaghom.posts post ON post.content_item_id = content.id
         LEFT JOIN LATERAL (
           SELECT id, status, error_code, error_message, created_at, updated_at
             FROM tanaghom.agent_jobs
            WHERE job_type = 'content.postiz.draft'
              AND input->>'content_item_id' = content.id::text
            ORDER BY created_at DESC LIMIT 1
         ) handoff ON true
         LEFT JOIN tanaghom.external_operations operation
           ON operation.provider = 'postiz'
          AND operation.operation_type = 'create_draft'
          AND operation.idempotency_key = 'postiz-draft:' || content.id::text
         LEFT JOIN tanaghom.publishing_channels channel_mapping
           ON channel_mapping.provider = 'postiz'
          AND channel_mapping.organization_id = campaign.organization_id
          AND channel_mapping.channel = content.channel
          AND channel_mapping.is_active
        WHERE ($1::text IS NULL OR content.status = $1)
          AND campaign.organization_id = $3
          AND ($2::text = '' OR campaign.name ILIKE '%' || $2 || '%'
               OR content.draft_copy ILIKE '%' || $2 || '%'
               OR content.channel ILIKE '%' || $2 || '%')
        ORDER BY content.updated_at DESC, content.created_at DESC
        LIMIT 250`,
      [status, search, user.organizationId],
    );
    const approvedWorkspaces = await database().query(
      `       WITH documents AS (
         SELECT step.workspace_id,
                string_agg('## ' || step.sequence || '. ' || replace(initcap(step.profile_code), '_', ' ')
                           || E'\n\n' || (task.result->>'document'), E'\n\n---\n\n' ORDER BY step.sequence) AS document,
                jsonb_agg(jsonb_build_object('sequence', step.sequence,
                  'profile_code', step.profile_code,
                  'document', task.result->>'document') ORDER BY step.sequence) AS deliverables
           FROM tanaghom.agency_workspace_steps step
           JOIN tanaghom.agency_pilot_tasks task ON task.id=step.task_id
          WHERE task.status='succeeded' AND task.result IS NOT NULL
          GROUP BY step.workspace_id
       )
       SELECT workspace.id,workspace.id AS campaign_id,workspace.title AS campaign_name,
              'ai_workspace'::text AS channel,'work_pack'::text AS content_type,
              coalesce(documents.document,workspace.brief) AS draft_copy,documents.deliverables,
              'Approved AI Workspace work pack'::text AS media_brief,NULL::text AS media_url,
              'approved'::text AS status,'workspace'::text AS generation,NULL::timestamptz AS scheduled_time,
              workspace.created_at,coalesce(workspace.finished_at,workspace.created_at) AS updated_at,
              NULL::integer AS strategy_version,'approved'::text AS decision,NULL::text AS rejection_reason,
              approved.occurred_at AS decided_at,reviewer.display_name AS decided_by_name,
              NULL::text AS provider,NULL::text AS provider_post_id,NULL::text AS post_status,
              NULL::timestamptz AS posted_at,NULL::timestamptz AS last_synced_at,
              NULL::uuid AS handoff_job_id,NULL::text AS handoff_status,NULL::text AS handoff_error_code,
              NULL::text AS handoff_error_message,NULL::timestamptz AS handoff_requested_at,
              NULL::timestamptz AS handoff_updated_at,NULL::text AS external_operation_status,
              false AS postiz_channel_ready
         FROM tanaghom.agency_workspaces workspace
         LEFT JOIN documents ON documents.workspace_id=workspace.id
         LEFT JOIN LATERAL (
           SELECT actor_ref,occurred_at FROM tanaghom.agency_workspace_events event
            WHERE event.workspace_id=workspace.id AND event.event_type='approved'
            ORDER BY event.id DESC LIMIT 1
         ) approved ON true
         LEFT JOIN tanaghom.app_users reviewer ON reviewer.id::text=approved.actor_ref
        WHERE workspace.organization_id=$3::uuid AND workspace.status='approved'
          AND ($1::text IS NULL OR $1::text='approved')
          AND ($2::text='' OR workspace.title ILIKE '%'||$2||'%' OR workspace.brief ILIKE '%'||$2||'%')
        ORDER BY coalesce(workspace.finished_at,workspace.created_at) DESC LIMIT 250`,
      [status, search, user.organizationId],
    );
    const items = [...result.rows, ...approvedWorkspaces.rows]
      .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
      .slice(0, 250);
    return noStore({
      items,
      integration: {
        postiz_ready: postizHandoffEnabled(),
        can_request_draft: user.role !== "viewer",
        reason: postizHandoffEnabled()
          ? "Social publishing draft handoff is enabled for configured staging channels."
          : "Social publishing credentials and the inactive publisher workflow have not passed the live enablement gate yet.",
      },
    });
  } catch (error) { return apiFailure(error); }
}
