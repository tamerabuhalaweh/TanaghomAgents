// Zero-Node client mirror of packages/agent-runtime/dialects.mjs. The parity
// test imports both modules and compares the registry and inference fixtures.

export type DialectId = "msa" | "sa" | "gulf" | "levant" | "egypt";

export interface ArabicDialect {
  id: DialectId;
  en: string;
  ar: string;
}

export const DIALECT_IDS: readonly DialectId[] = Object.freeze(["msa", "sa", "gulf", "levant", "egypt"]);

export const DIALECTS: readonly ArabicDialect[] = Object.freeze([
  Object.freeze({ id: "msa", en: "Modern Standard Arabic (White Arabic)", ar: "الفصحى المعاصرة" }),
  Object.freeze({ id: "sa", en: "Saudi Arabic", ar: "اللهجة السعودية" }),
  Object.freeze({ id: "gulf", en: "Gulf Arabic (Khaleeji)", ar: "اللهجة الخليجية" }),
  Object.freeze({ id: "levant", en: "Levantine Arabic", ar: "اللهجة الشامية" }),
  Object.freeze({ id: "egypt", en: "Egyptian Arabic", ar: "اللهجة المصرية" }),
]);

const SA = [
  "saudi", "saudi arabia", "ksa", "riyadh", "jeddah", "dammam", "khobar",
  "makkah", "madinah", "السعودية", "المملكة العربية السعودية", "الرياض", "جدة",
  "الدمام", "الخبر", "مكة", "المدينة",
];
const GULF = [
  "uae", "emirates", "united arab emirates", "dubai", "abu dhabi", "sharjah",
  "kuwait", "qatar", "doha", "bahrain", "manama", "oman", "muscat",
  "الإمارات", "الإمارات العربية المتحدة", "دبي", "أبوظبي", "الشارقة", "الكويت",
  "قطر", "الدوحة", "البحرين", "المنامة", "سلطنة عمان", "مسقط", "عمان",
];
const LEVANT = [
  "jordan", "amman", "irbid", "zarqa", "lebanon", "beirut", "palestine",
  "ramallah", "syria", "damascus", "الأردن", "عمّان", "إربد", "الزرقاء",
  "لبنان", "بيروت", "فلسطين", "رام الله", "سوريا", "دمشق",
];
const EGYPT = [
  "egypt", "cairo", "alexandria", "giza", "مصر", "القاهرة", "الإسكندرية", "الجيزة",
];

function normalize(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\u0640/g, "")
    // Keep shadda: it separates عمّان (Amman) from عمان (Oman).
    .replace(/[\u064B-\u0650\u0652-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[^\p{L}\p{N}\u0651]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(tokens: string[], phrase: string) {
  const needle = normalize(phrase).split(" ").filter(Boolean);
  if (!needle.length || needle.length > tokens.length) return false;
  for (let index = 0; index <= tokens.length - needle.length; index += 1) {
    if (needle.every((word, offset) => tokens[index + offset] === word)) return true;
  }
  return false;
}

function matches(tokens: string[], values: string[]) {
  return values.some((value) => containsPhrase(tokens, value));
}

export function isDialectId(value: unknown): value is DialectId {
  return typeof value === "string" && (DIALECT_IDS as readonly string[]).includes(value);
}

export function normalizeDialect(value: unknown): DialectId | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isDialectId(normalized) ? normalized : null;
}

export function inferDialectFromLocation(location: string | null | undefined): DialectId {
  const tokens = normalize(location).split(" ").filter(Boolean);
  if (!tokens.length) return "msa";
  if (matches(tokens, SA)) return "sa";
  if (matches(tokens, GULF)) return "gulf";
  if (matches(tokens, LEVANT)) return "levant";
  if (matches(tokens, EGYPT)) return "egypt";
  return "msa";
}

export function resolveArabicDialect({ campaignDialect, brandKitDialect, location }: {
  campaignDialect?: string | null;
  brandKitDialect?: string | null;
  location?: string | null;
} = {}): DialectId {
  return normalizeDialect(campaignDialect)
    || normalizeDialect(brandKitDialect)
    || inferDialectFromLocation(location)
    || "msa";
}

export function dialectLabel(id: DialectId, locale: "en" | "ar" = "en") {
  const dialect = DIALECTS.find((item) => item.id === id);
  if (!dialect) return "";
  return locale === "ar" ? dialect.ar : dialect.en;
}
