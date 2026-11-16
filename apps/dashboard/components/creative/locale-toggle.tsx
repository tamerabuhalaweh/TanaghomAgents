"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { applyLocale } from "@/lib/client/use-locale";
import { CREATIVE_LOCALE_COOKIE, t, type CreativeLocale } from "@/lib/i18n/creative";

export function LocaleToggle({ locale }: { locale: CreativeLocale }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function select(next: CreativeLocale) {
    if (next === locale || pending) return;
    document.cookie = `${CREATIVE_LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => {
      applyLocale(next);
      router.refresh();
    });
  }
  return (
    <div className="creative-row" role="group" aria-label={t(locale, "locale.label")}>
      {(["en", "ar"] as const).map((code) => (
        <button
          key={code}
          type="button"
          className={code === locale ? "creative-button" : "creative-button creative-button-secondary"}
          aria-pressed={code === locale}
          aria-busy={pending}
          disabled={pending}
          onClick={() => select(code)}
        >
          {code === "en" ? t(locale, "locale.english") : t(locale, "locale.arabic")}
        </button>
      ))}
    </div>
  );
}
