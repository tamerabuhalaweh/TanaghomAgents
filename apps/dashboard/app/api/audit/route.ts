import type { NextRequest } from "next/server";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
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
        ORDER BY log.created_at DESC
        LIMIT $1`,
      [limit],
    );

    return noStore({ actions: result.rows });
  } catch (error) {
    return apiFailure(error);
  }
}
