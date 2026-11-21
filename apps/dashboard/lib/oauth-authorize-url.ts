// Validation of the provider authorize URL that Postiz returns for a social
// channel. Kept free of I/O so the guard is executed directly by the tests.

export type AuthorizeUrlErrorCode = "social_provider_not_configured" | "postiz_oauth_url_invalid";

export class AuthorizeUrlError extends Error {
  code: AuthorizeUrlErrorCode;
  status: number;
  constructor(code: AuthorizeUrlErrorCode, status: number) {
    super(code);
    this.name = "AuthorizeUrlError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Postiz builds the authorize URL from its own provider configuration. An
 * unconfigured provider emits the literal string "undefined" (or "null") as the
 * client id, which is non-empty and would otherwise send the browser to a dead
 * provider page. Anything that is not a usable https authorize URL is refused
 * here instead of being opened in the browser.
 */
export function validateAuthorizeUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new AuthorizeUrlError("social_provider_not_configured", 409);
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AuthorizeUrlError("postiz_oauth_url_invalid", 502);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new AuthorizeUrlError("postiz_oauth_url_invalid", 502);
  }
  for (const name of ["client_id", "client_key"]) {
    const clientValue = parsed.searchParams.get(name)?.trim() ?? "";
    if (parsed.searchParams.has(name) && (!clientValue || /^(undefined|null)$/i.test(clientValue))) {
      throw new AuthorizeUrlError("social_provider_not_configured", 409);
    }
  }
  return parsed.toString();
}
