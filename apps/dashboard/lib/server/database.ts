import "server-only";

import { Pool } from "pg";

declare global {
  var tanaghomPool: Pool | undefined;
}

function poolMax() {
  const raw = process.env.PG_POOL_MAX ?? process.env.DATABASE_POOL_MAX;
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(80, Math.max(5, parsed));
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  return new Pool({
    connectionString,
    max: poolMax(),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "tanaghom-dashboard-api",
  });
}

export function database() {
  if (!globalThis.tanaghomPool) {
    globalThis.tanaghomPool = createPool();
  }
  return globalThis.tanaghomPool;
}
