"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useLocale } from "@/lib/client/use-locale";

const ROUTE_TITLES: Array<{ prefix: string; en: string; ar: string }> = [
  { prefix: "/workspace", en: "AI workspace", ar: "مساحة العمل الذكية" },
  { prefix: "/creative/designs", en: "Design Studio", ar: "استوديو التصاميم" },
  { prefix: "/creative/templates", en: "Templates", ar: "القوالب" },
  { prefix: "/creative/brand-kits", en: "Brand kits", ar: "الهويات البصرية" },
  { prefix: "/creative", en: "Creative Studio", ar: "استوديو الإبداع" },
  { prefix: "/approvals", en: "Approvals", ar: "الاعتمادات" },
  { prefix: "/content", en: "Content", ar: "المحتوى" },
  { prefix: "/campaigns", en: "Campaigns", ar: "الحملات" },
  { prefix: "/leads", en: "Leads", ar: "العملاء المحتملون" },
  { prefix: "/knowledge", en: "Knowledge", ar: "المعرفة" },
  { prefix: "/reports", en: "Reports", ar: "التقارير" },
  { prefix: "/actions", en: "Agent actions", ar: "إجراءات الوكلاء" },
  { prefix: "/agents", en: "Agents", ar: "الوكلاء" },
  { prefix: "/quality", en: "Quality & rollout", ar: "الجودة والطرح" },
  { prefix: "/inbox", en: "Supervisor inbox", ar: "صندوق المشرف" },
  { prefix: "/onboarding", en: "Workspace setup", ar: "إعداد مساحة العمل" },
  { prefix: "/team", en: "Team & access", ar: "الفريق والوصول" },
  { prefix: "/system", en: "System monitoring", ar: "مراقبة النظام" },
  { prefix: "/settings", en: "Settings", ar: "الإعدادات" },
];

/** The tab title follows the UI language, not the server-rendered metadata. */
export function LocalisedDocumentTitle() {
  const pathname = usePathname();
  const { locale } = useLocale();

  useEffect(() => {
    const match = pathname === "/"
      ? { en: "Overview", ar: "لوحة التحكم" }
      : ROUTE_TITLES.find((entry) => pathname.startsWith(entry.prefix));
    if (!match) return;
    const product = locale === "ar" ? "إعلاني" : "E3lani";
    document.title = `${locale === "ar" ? match.ar : match.en} · ${product}`;
  }, [pathname, locale]);

  return null;
}
