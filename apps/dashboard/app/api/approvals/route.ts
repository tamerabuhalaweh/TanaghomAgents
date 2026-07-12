import type { NextRequest } from "next/server";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const result = await database().query(
      `SELECT content.id,
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
              content.created_at
         FROM tanaghom.content_items AS content
         JOIN tanaghom.campaigns AS campaign ON campaign.id = content.campaign_id
         JOIN tanaghom.campaign_strategies AS strategy ON strategy.id = content.strategy_id
        WHERE content.status = 'pending_approval'
        ORDER BY content.created_at ASC
        LIMIT 100`,
    );

    return noStore({ items: result.rows });
  } catch (error) {
    return apiFailure(error);
  }
}
