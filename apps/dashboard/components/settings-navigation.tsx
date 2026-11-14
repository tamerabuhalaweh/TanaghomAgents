"use client";

import { BellRing, Bot, Building2, KeyRound, LibraryBig, PlugZap, Share2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/onboarding", label: "Business profile", icon: Building2 },
  { href: "/settings/integrations", label: "Integrations", icon: PlugZap },
  { href: "/settings/channels", label: "Channels", icon: Share2 },
  { href: "/settings/skills", label: "Skill Library", icon: LibraryBig },
  { href: "/settings/agents", label: "Agent Studio", icon: Bot },
  { href: "/settings/notifications", label: "Notifications", icon: BellRing },
  { href: "/settings/security", label: "Security", icon: KeyRound },
];

export function SettingsNavigation() {
  const pathname = usePathname();
  return <nav className="settings-navigation" aria-label="Settings sections">
    {links.map(({ href, label, icon: Icon }) => {
      const active = pathname.startsWith(href);
      return <Link key={href} href={href} className={active ? "settings-navigation-active" : ""} aria-current={active ? "page" : undefined}>
        <Icon size={16} /><span>{label}</span>
      </Link>;
    })}
  </nav>;
}
