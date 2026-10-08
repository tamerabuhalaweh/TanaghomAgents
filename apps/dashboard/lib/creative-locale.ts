import { cookies } from "next/headers";

import {
  directionOf,
  normalizeLocale,
  type CreativeLocale,
} from "@/lib/i18n/creative";

export async function creativeLocale(): Promise<{ locale: CreativeLocale; dir: "rtl" | "ltr" }> {
  const store = await cookies();
  const locale = normalizeLocale(store.get("tanaghom_locale")?.value);
  return { locale, dir: directionOf(locale) };
}
