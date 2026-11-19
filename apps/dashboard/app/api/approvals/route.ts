import type { NextRequest } from "next/server";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";
import { applyWorkspaceReviewCorrections } from "@/lib/workspace-review-corrections";

export const runtime = "nodejs";

interface WorkspaceDeliverable {
  sequence: number;
  profile: string;
  status: string;
  excerpt: string;
}

export async function GET(request: NextRequest) {
  try {
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const result = await database().query(
      `SELECT content.id,
              'content'::text AS source,
              content.campaign_id,
              campaign.name AS campaign_name,
              content.channel,
              content.content_type,
              content.draft_copy,
              content.media_brief,
              content.media_url,
              content.generation,
              content.scheduled_time,
              strategy.version AS strategy_version,
              content.created_at,
              NULL::text AS title,
              NULL::text AS language,
              NULL::text AS dialect,
              NULL::text AS result_hash,
              NULL::jsonb AS deliverables
         FROM tanaghom.content_items AS content
         JOIN tanaghom.campaigns AS campaign ON campaign.id = content.campaign_id
         JOIN tanaghom.campaign_strategies AS strategy ON strategy.id = content.strategy_id
        WHERE content.status = 'pending_approval'
          AND campaign.organization_id = $1::uuid
        ORDER BY content.created_at ASC
        LIMIT 100`,
      [user.organizationId],
    );

    // AI Workspace assignments awaiting a human decision surface in the same
    // queue so a waiting_review campaign can never be invisible to reviewers.
    const workspaces = await database().query(
      `SELECT workspace.id,
              'ai_workspace'::text AS source,
              workspace.id AS campaign_id,
              workspace.title AS campaign_name,
              ''::text AS channel,
              'workspace_work_pack'::text AS content_type,
              ''::text AS draft_copy,
              workspace.brief AS media_brief,
              NULL::text AS media_url,
              1::int AS generation,
              NULL::timestamp AS scheduled_time,
              0::int AS strategy_version,
              workspace.created_at,
              workspace.title,
              workspace.language,
              (SELECT log.payload->>'dialect' FROM tanaghom.agent_actions_log log
                WHERE log.organization_id = workspace.organization_id
                  AND log.action_type = 'workspace.brief_configured'
                  AND log.entity_id = workspace.id
                ORDER BY log.created_at DESC, log.id DESC LIMIT 1) AS dialect,
              tanaghom.agency_workspace_result_hash(workspace.id) AS result_hash,
              (SELECT jsonb_agg(jsonb_build_object(
                        'sequence', step.sequence,
                        'profile', step.profile_code,
                        'status', task.status,
                        'excerpt', left(coalesce(task.result->>'document', ''), 320),
                        'document', coalesce(task.result->>'document', '')
                      ) ORDER BY step.sequence)
                 FROM tanaghom.agency_workspace_steps step
                 JOIN tanaghom.agency_pilot_tasks task ON task.id = step.task_id
                WHERE step.workspace_id = workspace.id) AS deliverables
         FROM tanaghom.agency_workspaces workspace
        WHERE workspace.organization_id = $1::uuid
          AND workspace.status = 'waiting_review'
        ORDER BY workspace.created_at ASC
        LIMIT 100`,
      [user.organizationId],
    );

    const workspaceRows = workspaces.rows.map((row) => {
      const raw = Array.isArray(row.deliverables)
        ? (row.deliverables as (WorkspaceDeliverable & { document?: string })[])
        : [];
      const corrected = applyWorkspaceReviewCorrections(
        raw.map((entry) => ({
          sequence: entry.sequence,
          profile_code: entry.profile,
          status: entry.status,
          document: entry.document || entry.excerpt || "",
        })),
      );
      return {
        ...row,
        review_needs_changes: corrected.summary.needs_changes,
        review_unresolved_count: corrected.summary.unresolved.length,
        deliverables: corrected.steps.map((entry) => ({
          sequence: entry.sequence,
          profile: entry.profile_code,
          status: entry.status || "",
          excerpt: (entry.document || "").slice(0, 320),
        })),
      };
    });

    const items = [...result.rows, ...workspaceRows]
      .map((row) => ({
        ...row,
        deliverables: Array.isArray(row.deliverables)
          ? (row.deliverables as WorkspaceDeliverable[])
          : [],
      }))
      .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());

    return noStore({ items });
  } catch (error) {
    return apiFailure(error);
  }
}
