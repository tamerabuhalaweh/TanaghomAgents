"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useLocale } from "@/lib/client/use-locale";

const ROUTE_TITLES: Array<{ prefix: string; en: string; ar: string }> = [
  { prefix: "/workspace", en: "AI workspace", ar: "مساحة العمل الذكية" },
  { prefix: "/creative/designs", en: "Design Studio", ar: "استوديو التصاميم" },
  { prefix: "/creative/templates", en: "Templates", ar: "القوالب" },
  { prefix: "/creative/brand-kits", en: "Brand kits", ar: "الهويات البصرية" },
  { prefix: "/creative/assets", en: "Creative Assets", ar: "الأصول الإبداعية" },
  { prefix: "/creative/jobs", en: "Creative Jobs", ar: "المهام الإبداعية" },
  { prefix: "/creative/motion", en: "Motion", ar: "الحركة" },
  { prefix: "/creative/generate", en: "New image", ar: "صورة جديدة" },
  { prefix: "/creative/product", en: "Product Studio", ar: "استوديو المنتجات" },
  { prefix: "/creative/video", en: "New video", ar: "فيديو جديد" },
  { prefix: "/creative", en: "Creative Studio", ar: "استوديو الإبداع" },
  { prefix: "/approvals", en: "Approvals", ar: "الاعتمادات" },
  { prefix: "/content", en: "Content Library", ar: "مكتبة المحتوى" },
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
  { prefix: "/settings/channels", en: "Social channels", ar: "قنوات التواصل" },
  { prefix: "/settings/integrations", en: "Integrations", ar: "التكاملات" },
  { prefix: "/settings/notifications", en: "Notifications", ar: "الإشعارات" },
  { prefix: "/settings/security", en: "Security", ar: "الأمان" },
  { prefix: "/settings/billing", en: "Billing", ar: "الفوترة والباقة" },
  { prefix: "/settings/agents", en: "Agent Studio", ar: "استوديو الوكلاء" },
  { prefix: "/settings/skills", en: "Skill Library", ar: "مكتبة المهارات" },
  { prefix: "/settings", en: "Settings", ar: "الإعدادات" },
];

export function titleForRoute(pathname: string, locale: "en" | "ar"): string | null {
  const match = pathname === "/"
    ? { en: "Overview", ar: "لوحة التحكم" }
    : ROUTE_TITLES.find((entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`));
  if (!match) return null;
  const product = locale === "ar" ? "إعلاني" : "E3lani";
  return `${locale === "ar" ? match.ar : match.en} · ${product}`;
}

/** The tab title follows the UI language, not the server-rendered metadata. */
export function LocalisedDocumentTitle() {
  const pathname = usePathname();
  const { locale } = useLocale();

  useEffect(() => {
    const expected = titleForRoute(pathname, locale);
    if (!expected) return;
    if (document.title !== expected) document.title = expected;
    // Next.js metadata reconciliation can asynchronously reset document.title after
    // soft navigation or router.refresh(); keep the active locale title pinned.
    const observer = new MutationObserver(() => {
      if (document.title !== expected) document.title = expected;
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [pathname, locale]);

  return null;
}
