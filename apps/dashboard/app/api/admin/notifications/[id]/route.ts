import type { NextRequest } from "next/server";

import {
  deleteNotificationDestination,
  notificationApiError,
} from "@/lib/server/notification-management";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { return noStore(await deleteNotificationDestination(request, (await context.params).id)); }
  catch (error) {
    const known = notificationApiError(error);
    return known ? noStore({ error: known.message }, { status: known.status }) : apiFailure(error);
  }
}
