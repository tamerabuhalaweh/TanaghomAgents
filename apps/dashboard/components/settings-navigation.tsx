"use client";

import { BellRing, LibraryBig, PlugZap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/settings/integrations", label: "Integrations", icon: PlugZap },
  { href: "/settings/skills", label: "Skill Library", icon: LibraryBig },
  { href: "/settings/notifications", label: "Notifications", icon: BellRing },
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
