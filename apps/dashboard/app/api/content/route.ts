import type { NextRequest } from "next/server";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

const statuses = new Set(["draft", "pending_approval", "approved", "rejected", "scheduled", "posted", "cancelled"]);

export async function GET(request: NextRequest) {
  try {
    await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
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
              post.posted_at, post.last_synced_at
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
        WHERE ($1::text IS NULL OR content.status = $1)
          AND ($2::text = '' OR campaign.name ILIKE '%' || $2 || '%'
               OR content.draft_copy ILIKE '%' || $2 || '%'
               OR content.channel ILIKE '%' || $2 || '%')
        ORDER BY content.updated_at DESC, content.created_at DESC
        LIMIT 250`,
      [status, search],
    );
    return noStore({
      items: result.rows,
      integration: {
        postiz_ready: false,
        reason: "Postiz staging credentials and the Phase 4 publisher workflow are not configured yet.",
      },
    });
  } catch (error) { return apiFailure(error); }
}
