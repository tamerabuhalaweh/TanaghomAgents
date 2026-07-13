import type { NextRequest } from "next/server";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";
import { inviteTeamMember, teamApiError } from "@/lib/server/team-management";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const owner = await authorize(request, ["owner"]);
    const result = await database().query(
      `SELECT member.id, member.email, member.display_name, member.role, member.is_active,
              member.invited_at, member.accepted_at, member.created_at,
              inviter.display_name AS invited_by_name
         FROM tanaghom.app_users member
         LEFT JOIN tanaghom.app_users inviter ON inviter.id = member.invited_by
        WHERE member.kind = 'human'
          AND member.organization_id = $1
        ORDER BY (member.role = 'owner') DESC, member.created_at ASC`,
      [owner.organizationId],
    );
    return noStore({
      users: result.rows,
      current_user_id: owner.id,
      invitations_configured: Boolean(process.env.SUPABASE_SECRET_KEY),
    });
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: NextRequest) {
  try { return noStore(await inviteTeamMember(request), { status: 201 }); }
  catch (error) {
    const known = teamApiError(error);
    return known ? noStore({ error: known.code }, { status: known.status }) : apiFailure(error);
  }
}
