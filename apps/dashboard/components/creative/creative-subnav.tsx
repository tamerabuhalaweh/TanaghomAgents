"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { CreativeLocale } from "@/lib/i18n/creative";

const items = [
  { href: "/creative", en: "Overview", ar: "نظرة عامة" },
  { href: "/creative/designs", en: "Designs & Carousels", ar: "التصاميم والكاروسيل" },
  { href: "/creative/motion", en: "Motion Studio", ar: "استوديو الموشن" },
  { href: "/creative/brand-kits", en: "Brand Kits", ar: "الهوية البصرية" },
  { href: "/creative/templates", en: "Templates", ar: "القوالب" },
] as const;

export function CreativeSubnav({ locale }: { locale: CreativeLocale }) {
  const pathname = usePathname();
  const ar = locale === "ar";
  return (
    <nav className="creative-subnav" aria-label={ar ? "تنقل استوديو الإبداع" : "Creative Studio navigation"}>
      {items.map((item) => {
        const active = item.href === "/creative" ? pathname === "/creative" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`creative-subnav-link ${active ? "creative-subnav-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {ar ? item.ar : item.en}
          </Link>
        );
      })}
    </nav>
  );
}
