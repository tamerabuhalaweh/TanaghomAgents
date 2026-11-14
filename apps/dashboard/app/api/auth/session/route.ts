import type { NextRequest } from "next/server";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

interface OrganizationRow {
  name: string;
  business_name_en: string | null;
  business_name_ar: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const organization = await database().query<OrganizationRow>(
      `SELECT name, business_name_en, business_name_ar
         FROM tanaghom.organizations
        WHERE id = $1::uuid AND is_active`,
      [user.organizationId],
    );
    const row = organization.rows[0];
    const verification = await database().query<{ email_verified_at: Date | null }>(
      "SELECT email_verified_at FROM tanaghom.users WHERE id = $1::uuid",
      [user.authUserId],
    );
    const emailVerified = Boolean(verification.rows[0]?.email_verified_at);
    return noStore({
      user: { ...user, email_verified: emailVerified },
      organization: row
        ? {
            name: row.name,
            businessNameEn: row.business_name_en,
            businessNameAr: row.business_name_ar,
          }
        : null,
    });
  } catch (error) {
    return apiFailure(error);
  }
}
