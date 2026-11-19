import type { NextRequest } from "next/server";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 50);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 200)
      : 50;
    const result = await database().query(
      `SELECT log.id,
              log.correlation_id,
              log.action_type,
              log.entity_type,
              log.entity_id,
              log.result,
              log.created_at,
              agent.name AS agent_name,
              actor.display_name AS actor_name
         FROM tanaghom.agent_actions_log AS log
         LEFT JOIN tanaghom.agents AS agent ON agent.id = log.agent_id
         LEFT JOIN tanaghom.app_users AS actor ON actor.id = log.actor_user_id
         LEFT JOIN tanaghom.agent_jobs AS job ON job.id = log.job_id
         LEFT JOIN tanaghom.campaigns AS job_campaign ON job_campaign.id = job.campaign_id
         LEFT JOIN tanaghom.agency_workspaces AS workspace
           ON log.entity_type = 'agency_workspace' AND workspace.id = log.entity_id
        WHERE log.organization_id = $1::uuid
           OR (log.organization_id IS NULL AND COALESCE(job_campaign.organization_id, workspace.organization_id) = $1::uuid)
        ORDER BY log.created_at DESC
        LIMIT $2`,
      [user.organizationId, limit],
    );

    return noStore({ actions: result.rows });
  } catch (error) {
    return apiFailure(error);
  }
}
