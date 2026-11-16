"use client";

import { BellRing, Bot, Building2, CreditCard, KeyRound, LibraryBig, PlugZap, Share2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/client/use-locale";

const links = [
  { href: "/onboarding", label: "Business profile", arabic: "ملف النشاط التجاري", icon: Building2 },
  { href: "/settings/integrations", label: "Integrations", arabic: "التكاملات", icon: PlugZap },
  { href: "/settings/channels", label: "Channels", arabic: "القنوات", icon: Share2 },
  { href: "/settings/skills", label: "Skill Library", arabic: "مكتبة المهارات", icon: LibraryBig },
  { href: "/settings/agents", label: "Agent Studio", arabic: "استوديو الوكلاء", icon: Bot },
  { href: "/settings/notifications", label: "Notifications", arabic: "الإشعارات", icon: BellRing },
  { href: "/settings/billing", label: "Billing", arabic: "الفوترة", icon: CreditCard },
  { href: "/settings/security", label: "Security", arabic: "الأمان", icon: KeyRound },
];

export function SettingsNavigation() {
  const pathname = usePathname();
  const { locale } = useLocale();
  const ar = locale === "ar";
  return <nav className="settings-navigation" aria-label={ar ? "أقسام الإعدادات" : "Settings sections"}>
    {links.map(({ href, label, arabic, icon: Icon }) => {
      const active = pathname.startsWith(href);
      return <Link key={href} href={href} className={active ? "settings-navigation-active" : ""} aria-current={active ? "page" : undefined}>
        <Icon size={16} /><span>{ar ? arabic : label}</span>
      </Link>;
    })}
  </nav>;
}
