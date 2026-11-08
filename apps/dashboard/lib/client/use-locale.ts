"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  CREATIVE_LOCALE_COOKIE,
  directionOf,
  normalizeLocale,
  type CreativeLocale,
} from "@/lib/i18n/creative";

export const LOCALE_CHANGE_EVENT = "tanaghom:locale-change";

export function readLocaleCookie(): CreativeLocale {
  if (typeof document === "undefined") return "en";
  const entry = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CREATIVE_LOCALE_COOKIE}=`));
  return normalizeLocale(entry?.split("=")[1]);
}

/** Applies a locale to the document without writing the cookie or refreshing. */
export function applyLocale(next: CreativeLocale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = next;
  document.documentElement.dir = directionOf(next);
  window.dispatchEvent(new CustomEvent<CreativeLocale>(LOCALE_CHANGE_EVENT, { detail: next }));
}

export function useLocale() {
  const router = useRouter();
  const [locale, setLocaleState] = useState<CreativeLocale>("en");

  useEffect(() => {
    setLocaleState(readLocaleCookie());
    function onChange(event: Event) {
      setLocaleState(normalizeLocale((event as CustomEvent<CreativeLocale>).detail));
    }
    window.addEventListener(LOCALE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(LOCALE_CHANGE_EVENT, onChange);
  }, []);

  function setLocale(next: CreativeLocale) {
    if (typeof document === "undefined") return;
    document.cookie = `${CREATIVE_LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    applyLocale(next);
    setLocaleState(next);
    router.refresh();
  }

  return { locale, dir: directionOf(locale), setLocale };
}
