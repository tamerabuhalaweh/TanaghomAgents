"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";

import type { CreativeLocale } from "@/lib/i18n/creative";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      language: string;
      theme: "auto";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function TurnstileWidget({
  locale,
  onToken,
}: {
  locale: CreativeLocale;
  onToken: (token: string) => void;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const callback = useRef(onToken);
  callback.current = onToken;

  const renderWidget = useCallback(() => {
    if (!siteKey || !container.current || widgetId.current || !window.turnstile) return;
    widgetId.current = window.turnstile.render(container.current, {
      sitekey: siteKey,
      language: locale,
      theme: "auto",
      callback: (token) => callback.current(token),
      "expired-callback": () => callback.current(""),
      "error-callback": () => callback.current(""),
    });
  }, [locale, siteKey]);

  useEffect(() => {
    if (window.turnstile) renderWidget();
    return () => {
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
      callback.current("");
    };
  }, [renderWidget]);

  if (!siteKey) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={renderWidget}
      />
      <div className="turnstile-slot" ref={container} />
    </>
  );
}
