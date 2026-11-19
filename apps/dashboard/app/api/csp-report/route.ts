import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_REPORT_BYTES = 8_192;

function sanitizeUri(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const trimmed = raw.trim().slice(0, 200);
  if (/^(?:inline|eval|data|blob|about|self)$/i.test(trimmed)) return trimmed.toLowerCase();
  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return trimmed.split(/[?#]/)[0].slice(0, 120);
  }
}

export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > MAX_REPORT_BYTES) {
    return new NextResponse(null, { status: 413 });
  }
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_REPORT_BYTES) {
    return new NextResponse(null, { status: raw ? 413 : 204 });
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | Array<Record<string, unknown>>;
    const report = Array.isArray(parsed)
      ? (parsed[0]?.body as Record<string, unknown> | undefined) ?? parsed[0]
      : (parsed["csp-report"] as Record<string, unknown> | undefined) ?? parsed;
    if (report && typeof report === "object") {
      console.warn(
        JSON.stringify({
          event: "csp_violation_report",
          directive: String(report["effective-directive"] || report["violated-directive"] || "").slice(0, 80),
          blocked: sanitizeUri(report["blocked-uri"] ?? report.blockedURL),
          document: sanitizeUri(report["document-uri"] ?? report.documentURL),
        }),
      );
    }
  } catch {
    // Malformed CSP browser reports are dropped silently.
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
