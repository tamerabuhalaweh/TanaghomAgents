const DUMMY_ORIGIN = "https://app.e3lani.local";
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

/**
 * Validates a post-login redirect target so only safe same-origin relative
 * paths (with optional query/hash) are followed.
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed || CONTROL_CHARS_RE.test(trimmed)) return fallback;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback;
  }
  const rawPath = trimmed.split(/[?#]/, 1)[0];
  if (rawPath.includes("\\")) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(trimmed, DUMMY_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== DUMMY_ORIGIN) return fallback;
  if (parsed.pathname === "/login" || parsed.pathname.startsWith("/login/")) {
    return fallback;
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Builds `/login` (or `/login?next=<encoded path>`) while preserving query params
 * on protected workspace routes and avoiding redirect loops.
 */
export function buildLoginRedirectUrl(pathname: string, search = ""): string {
  const normalizedSearch = search && !search.startsWith("?") ? `?${search}` : search;
  const safe = safeNextPath(`${pathname}${normalizedSearch}`, "");
  if (!safe || safe === "/") return "/login";
  return `/login?next=${encodeURIComponent(safe)}`;
}
