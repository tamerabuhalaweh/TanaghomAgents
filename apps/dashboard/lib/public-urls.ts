function parseOrigin(raw: string | undefined): URL | null {
  const trimmed = raw?.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function getAppOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return parseOrigin(env.APP_BASE_URL)?.origin ?? "";
}

export function getMarketingOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return parseOrigin(env.PUBLIC_MARKETING_URL)?.origin ?? "";
}

export function isSplitDomainMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const app = parseOrigin(env.APP_BASE_URL);
  const marketing = parseOrigin(env.PUBLIC_MARKETING_URL);
  if (!app || !marketing) return false;
  return app.host.toLowerCase() !== marketing.host.toLowerCase();
}

export function appHref(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!isSplitDomainMode(env)) return normalized;
  return `${getAppOrigin(env)}${normalized}`;
}

export function marketingHref(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!isSplitDomainMode(env)) return normalized;
  return `${getMarketingOrigin(env)}${normalized}`;
}

export function normalizeRequestHost(rawHost: string | null | undefined): string {
  if (!rawHost) return "";
  return rawHost.split(",", 1)[0].trim().toLowerCase();
}

export function isMarketingHost(rawHost: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const marketing = parseOrigin(env.PUBLIC_MARKETING_URL);
  if (!marketing) return false;
  const host = normalizeRequestHost(rawHost);
  return Boolean(host && host === marketing.host.toLowerCase());
}

export function isAppHost(rawHost: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const app = parseOrigin(env.APP_BASE_URL);
  if (!app) return false;
  const host = normalizeRequestHost(rawHost);
  return Boolean(host && host === app.host.toLowerCase());
}
