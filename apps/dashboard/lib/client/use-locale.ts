"use client";

import { useRouter } from "next/navigation";
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";

import {
  CREATIVE_LOCALE_COOKIE,
  directionOf,
  normalizeLocale,
  type CreativeLocale,
} from "@/lib/i18n/creative";

export const LOCALE_CHANGE_EVENT = "tanaghom:locale-change";

type LocaleValue = {
  locale: CreativeLocale;
  dir: "rtl" | "ltr";
  setLocale: (next: CreativeLocale) => void;
};

const LocaleContext = createContext<LocaleValue | null>(null);

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

/** Seeds the client tree from the server-rendered locale so the first frame never flashes English. */
export function LocaleProvider({ initialLocale = "en", children }: { initialLocale?: CreativeLocale; children: ReactNode }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<CreativeLocale>(initialLocale);

  useEffect(() => {
    setLocaleState(initialLocale);
  }, [initialLocale]);

  useEffect(() => {
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

  return createElement(
    LocaleContext.Provider,
    { value: { locale, dir: directionOf(locale), setLocale } },
    children,
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  const router = useRouter();
  const [fallbackLocale, setFallbackLocale] = useState<CreativeLocale>("en");

  useEffect(() => {
    if (context) return;
    setFallbackLocale(readLocaleCookie());
    function onChange(event: Event) {
      setFallbackLocale(normalizeLocale((event as CustomEvent<CreativeLocale>).detail));
    }
    window.addEventListener(LOCALE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(LOCALE_CHANGE_EVENT, onChange);
  }, [context]);

  if (context) return context;

  function setLocale(next: CreativeLocale) {
    if (typeof document === "undefined") return;
    document.cookie = `${CREATIVE_LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    applyLocale(next);
    setFallbackLocale(next);
    router.refresh();
  }

  return { locale: fallbackLocale, dir: directionOf(fallbackLocale), setLocale };
}