import type { NextRequest } from "next/server";

import {
  listNotificationDestinations,
  notificationApiError,
  saveNotificationDestination,
} from "@/lib/server/notification-management";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

function failure(error: unknown) {
  const known = notificationApiError(error);
  return known ? noStore({ error: known.message }, { status: known.status }) : apiFailure(error);
}

export async function GET(request: NextRequest) {
  try { return noStore(await listNotificationDestinations(request)); }
  catch (error) { return failure(error); }
}

export async function PUT(request: NextRequest) {
  try { return noStore(await saveNotificationDestination(request)); }
  catch (error) { return failure(error); }
}
