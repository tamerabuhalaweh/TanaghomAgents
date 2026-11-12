// Tenant display names. `organizations.name` stays the canonical, non-localized
// label used in audit records and API payloads; the business-name columns are
// optional localized labels chosen by the owner during onboarding.

export type TenantNameLocale = "en" | "ar";

export interface TenantNames {
  name: string;
  businessNameEn?: string | null;
  businessNameAr?: string | null;
}

function cleaned(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolves the label to show for a tenant in one language:
 * localized business name, then the other language's business name, then the
 * canonical tenant name. The canonical name is never rewritten by the choice
 * of locale.
 */
export function tenantDisplayName(tenant: TenantNames, locale: TenantNameLocale): string {
  const english = cleaned(tenant.businessNameEn);
  const arabic = cleaned(tenant.businessNameAr);
  const canonical = cleaned(tenant.name);
  if (locale === "ar") return arabic || english || canonical;
  return english || arabic || canonical;
}
