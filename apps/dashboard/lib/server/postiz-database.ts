import "server-only";

import { readFileSync } from "node:fs";

import { Pool, type PoolConfig } from "pg";

export class PostizDatabaseError extends Error {}

function postizDatabaseUrlFromFile() {
  const path = process.env.POSTIZ_DATABASE_URL_FILE?.trim() || "/run/secrets/postiz_database_url";
  try {
    return readFileSync(/* turbopackIgnore: true */ path, "utf8").trim();
  } catch {
    return "";
  }
}

export function postizDatabaseUrl() {
  const configured = process.env.POSTIZ_DATABASE_URL?.trim() || postizDatabaseUrlFromFile();
  if (!configured) throw new PostizDatabaseError("postiz_database_not_configured");
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new PostizDatabaseError("postiz_database_url_invalid");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol) || !parsed.hostname) {
    throw new PostizDatabaseError("postiz_database_url_invalid");
  }
  return configured;
}

export function postizDatabaseConfigured() {
  try {
    postizDatabaseUrl();
    return true;
  } catch {
    return false;
  }
}

export function createPostizPool(connectionString = postizDatabaseUrl()) {
  const config: PoolConfig = {
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    application_name: "tanaghom-postiz-provisioner",
  };
  return new Pool(config);
}

let pool: Pool | null = null;

/**
 * The dashboard only needs the Postiz database for tenant organization
 * provisioning. The pool is deliberately small and is never used for channel
 * listings; those go through the tenant's Public API key.
 */
export function postizDatabase() {
  if (!pool) pool = createPostizPool();
  return pool;
}
