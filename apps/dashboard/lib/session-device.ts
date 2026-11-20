export interface SessionDeviceSummary {
  label: string;
  ip: string | null;
}

function detectBrowser(ua: string, ar: boolean): string {
  if (/Edg\//i.test(ua)) return "Microsoft Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Chrome\//i.test(ua) && !/Chromium\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
  if (/^node\b/i.test(ua) || /undici/i.test(ua)) return ar ? "متصفح سابق (بدون تفاصيل الجهاز)" : "Previous web session";
  if (/curl\//i.test(ua)) return "curl";
  return ar ? "متصفح ويب" : "Web browser";
}

function detectOs(ua: string): string {
  if (/iPhone|iPad|iPod/i.test(ua)) return /iPad/i.test(ua) ? "iPadOS" : "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows NT/i.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "";
}

export function describeSessionDevice(
  rawUserAgent: string | null | undefined,
  locale: "en" | "ar" = "en",
): SessionDeviceSummary {
  const ar = locale === "ar";
  const raw = (rawUserAgent ?? "").trim();
  if (!raw) {
    return { label: ar ? "متصفح ويب" : "Web browser", ip: null };
  }

  let uaPart = raw;
  let ip: string | null = null;
  const ipMatch = raw.match(/(?:^|\|\s*)ip:([^\s|]+)\s*$/i);
  if (ipMatch) {
    ip = ipMatch[1].trim();
    uaPart = raw.slice(0, ipMatch.index).replace(/\|\s*$/, "").trim();
  }

  if (!uaPart) {
    return { label: ar ? "متصفح ويب" : "Web browser", ip };
  }

  const browser = detectBrowser(uaPart, ar);
  const os = detectOs(uaPart);
  const label = os ? (ar ? `${browser} على ${os}` : `${browser} on ${os}`) : browser;
  return { label, ip };
}
