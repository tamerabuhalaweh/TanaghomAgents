import "server-only";

import { Pool } from "pg";

declare global {
  var tanaghomPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  return new Pool({
    connectionString,
    max: 5,
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
