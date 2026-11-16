export type DialectId = "msa" | "sa" | "gulf" | "levant" | "egypt";
export interface ArabicDialect {
  id: DialectId;
  en: string;
  ar: string;
}
export const DIALECT_IDS: readonly DialectId[];
export const DIALECTS: readonly ArabicDialect[];
export function isDialectId(value: unknown): value is DialectId;
export function normalizeDialect(value: unknown): DialectId | null;
export function inferDialectFromLocation(location: string | null | undefined): DialectId;
export function resolveArabicDialect(input?: {
  campaignDialect?: string | null;
  brandKitDialect?: string | null;
  location?: string | null;
}): DialectId;
export function dialectLabel(id: DialectId, locale?: "en" | "ar"): string;
