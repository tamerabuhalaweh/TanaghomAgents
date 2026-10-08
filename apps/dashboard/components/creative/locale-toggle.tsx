"use client";

import { useRouter } from "next/navigation";

import { CREATIVE_LOCALE_COOKIE, t, type CreativeLocale } from "@/lib/i18n/creative";

export function LocaleToggle({ locale }: { locale: CreativeLocale }) {
  const router = useRouter();
  function select(next: CreativeLocale) {
    if (next === locale) return;
    document.cookie = `${CREATIVE_LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }
  return (
    <div className="creative-row" role="group" aria-label={t(locale, "locale.label")}>
      {(["en", "ar"] as const).map((code) => (
        <button
          key={code}
          type="button"
          className={code === locale ? "creative-button" : "creative-button creative-button-secondary"}
          aria-pressed={code === locale}
          onClick={() => select(code)}
        >
          {code === "en" ? t(locale, "locale.english") : t(locale, "locale.arabic")}
        </button>
      ))}
    </div>
  );
}
