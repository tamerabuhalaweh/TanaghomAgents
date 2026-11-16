export const ARABIC_NUMERIC_LOCALE = "ar-SA-u-nu-latn";
export const ARABIC_DATE_LOCALE = "ar-SA-u-nu-latn";

export type UiLocale = "ar" | "en";

export interface ArabicPluralForms {
  zero?: string;
  one: string;
  two: string;
  few: string;
  many: string;
  other: string;
}

const ARABIC_PLURAL_RULES = new Intl.PluralRules("ar-SA");

/** Formats an Arabic count with the correct zero/one/two/few/many/other form. */
export function formatArabicCount(count: number, forms: ArabicPluralForms): string {
  const category = ARABIC_PLURAL_RULES.select(count) as keyof ArabicPluralForms;
  const template = forms[category] ?? forms.other;
  return template.replaceAll("{count}", formatNumber(count, "ar"));
}

const EASTERN_ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;
const DIGIT_MAP: Record<string, string> = {
  "\u0660": "0", "\u0661": "1", "\u0662": "2", "\u0663": "3", "\u0664": "4",
  "\u0665": "5", "\u0666": "6", "\u0667": "7", "\u0668": "8", "\u0669": "9",
  "\u06F0": "0", "\u06F1": "1", "\u06F2": "2", "\u06F3": "3", "\u06F4": "4",
  "\u06F5": "5", "\u06F6": "6", "\u06F7": "7", "\u06F8": "8", "\u06F9": "9",
};

/**
 * Normalizes Arabic-Indic and Eastern Persian digits to Western digits 0-9.
 * Apply before parsing or validating numbers typed in Arabic UI fields.
 */
export function normalizeDigits(value: string): string {
  return value.replace(EASTERN_ARABIC_DIGITS, (digit) => DIGIT_MAP[digit] ?? digit);
}

/** Keeps only digits after normalization, for phone and numeric identifier fields. */
export function normalizeNumericInput(value: string, options: { allowDecimal?: boolean } = {}): string {
  const normalized = normalizeDigits(value);
  if (!options.allowDecimal) return normalized.replace(/\D/g, "");
  const firstDot = normalized.indexOf(".");
  if (firstDot === -1) return normalized.replace(/\D/g, "");
  return `${normalized.slice(0, firstDot).replace(/\D/g, "")}.${normalized.slice(firstDot + 1).replace(/\D/g, "")}`;
}

export function numericLocale(locale: UiLocale): string {
  return locale === "ar" ? ARABIC_NUMERIC_LOCALE : "en-US";
}

export function dateLocale(locale: UiLocale): string {
  return locale === "ar" ? ARABIC_DATE_LOCALE : "en-GB";
}

export function formatNumber(value: number, locale: UiLocale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(numericLocale(locale), options).format(value);
}

export function formatMoney(
  value: number,
  locale: UiLocale,
  currency = "USD",
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(numericLocale(locale), {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
    ...options,
  }).format(value);
}

/**
 * Formats a percentage from a 0-1 ratio. The percent sign always sits directly
 * after the digits (15%), with no left-side space, in both locales.
 */
export function formatPercent(ratio: number, locale: UiLocale, fractionDigits = 0): string {
  const number = new Intl.NumberFormat(numericLocale(locale), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(ratio * 100);
  return `${number}%`;
}

export function formatDate(
  value: string | number | Date,
  locale: UiLocale,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(dateLocale(locale), {
    day: "2-digit",
    month: "long",
    year: "numeric",
    ...options,
  }).format(date);
}

export function formatDateTime(
  value: string | number | Date,
  locale: UiLocale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(dateLocale(locale), options).format(date);
}
