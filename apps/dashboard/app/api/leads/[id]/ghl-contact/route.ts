import type { NextRequest } from "next/server";

import { requestGhlContactSync } from "@/lib/server/ghl-contact-sync";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return requestGhlContactSync(request, (await context.params).id);
}
