import { database } from "@/lib/server/database";
import { noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function GET() {
  const authConfigured = Boolean(process.env.SUPABASE_URL);
  try {
    await database().query("SELECT 1");
    return noStore({
      ok: authConfigured,
      components: {
        api: "ready",
        authentication: authConfigured ? "configured" : "not_configured",
        database: "connected",
      },
    }, { status: authConfigured ? 200 : 503 });
  } catch {
    return noStore({
      ok: false,
      components: {
        api: "ready",
        authentication: authConfigured ? "configured" : "not_configured",
        database: process.env.DATABASE_URL ? "unavailable" : "not_configured",
      },
    }, { status: 503 });
  }
}
