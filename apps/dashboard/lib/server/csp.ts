export type CspMode = "report-only" | "enforce" | "off";

const DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "frame-src 'self' https://challenges.cloudflare.com",
  "connect-src 'self' https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "report-uri /api/csp-report",
];

export function resolveCspMode(env: NodeJS.ProcessEnv = process.env): CspMode {
  const raw = (env.CSP_MODE || "report-only").trim().toLowerCase();
  if (raw === "enforce" || raw === "off" || raw === "report-only") return raw;
  return "report-only";
}

export function buildGlobalCspHeader(env: NodeJS.ProcessEnv = process.env): {
  header: "Content-Security-Policy" | "Content-Security-Policy-Report-Only";
  value: string;
} | null {
  const mode = resolveCspMode(env);
  if (mode === "off") return null;
  return {
    header: mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
    value: DIRECTIVES.join("; "),
  };
}
