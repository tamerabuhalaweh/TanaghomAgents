"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Bot,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  CheckCheck,
  ChevronDown,
  ClipboardCheck,
  CircleHelp,
  ContactRound,
  LayoutDashboard,
  MessagesSquare,
  Menu,
  Settings,
  LibraryBig,
  BookOpenCheck,
  UsersRound,
  ShieldCheck,
  Palette,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "./brand-mark";
import { LocaleToggle } from "./creative/locale-toggle";
import { SessionProfile } from "./session-profile";
import { TenantName } from "./tenant-name";
import { useLocale } from "@/lib/client/use-locale";

type NavItem = { href: string; label: string; arabic: string; icon: typeof LayoutDashboard };

// The five customer workflow pillars stay visible at all times.
const customerNavigation: NavItem[] = [
  { href: "/", label: "Overview", arabic: "نظرة عامة", icon: LayoutDashboard },
  { href: "/workspace", label: "AI workspace", arabic: "مساحة العمل الذكية", icon: UsersRound },
  { href: "/creative", label: "Creative Studio", arabic: "استوديو الإبداع", icon: Palette },
  { href: "/approvals", label: "Approvals", arabic: "الاعتمادات", icon: CheckCheck },
  { href: "/content", label: "Content", arabic: "المحتوى", icon: LibraryBig },
];

// Operator and administration destinations live behind one disclosure.
const operationsNavigation: NavItem[] = [
  { href: "/campaigns", label: "Campaigns", arabic: "الحملات", icon: BriefcaseBusiness },
  { href: "/leads", label: "Leads", arabic: "العملاء المحتملون", icon: ContactRound },
  { href: "/inbox", label: "Supervisor inbox", arabic: "صندوق المشرف", icon: MessagesSquare },
  { href: "/reports", label: "Reports", arabic: "التقارير", icon: ChartNoAxesCombined },
  { href: "/actions", label: "Agent actions", arabic: "إجراءات الوكلاء", icon: ClipboardCheck },
  { href: "/knowledge", label: "Knowledge", arabic: "المعرفة", icon: BookOpenCheck },
  { href: "/agents", label: "Agents", arabic: "الوكلاء", icon: Bot },
  { href: "/quality", label: "Quality & rollout", arabic: "الجودة والطرح", icon: ShieldCheck },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  function closeMenu({ returnFocus = false } = {}) {
    setMenuOpen(false);
    if (returnFocus) menuButtonRef.current?.focus();
  }

  const navLabel = (item: NavItem) => (ar ? item.arabic : item.label);
  const moreActive = operationsNavigation.some((item) => pathname.startsWith(item.href));

  function renderNavLink(item: NavItem) {
    const { href, icon: Icon } = item;
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link key={href} href={href} className={`nav-link ${active ? "nav-link-active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => closeMenu()}>
        <Icon size={18} strokeWidth={1.8} />
        <span>{navLabel(item)}</span>
      </Link>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{ar ? "تخطَّ إلى المحتوى الرئيسي" : "Skip to main content"}</a>
      <header className="mobile-header">
        <Link className="brand" href="/" aria-label={ar ? "نظرة عامة على تناغم" : "Tanaghom overview"}>
          <BrandMark />
          <span>Tanaghom</span>
        </Link>
        <TenantName variant="mobile" />
        <button ref={menuButtonRef} className="icon-button" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-controls="primary-navigation" aria-label={menuOpen ? (ar ? "إغلاق التنقل" : "Close navigation") : (ar ? "فتح التنقل" : "Open navigation")}>
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <Link className="brand desktop-brand" href="/" aria-label={ar ? "نظرة عامة على تناغم" : "Tanaghom overview"}>
          <BrandMark />
          <span>Tanaghom</span>
        </Link>

        <nav id="primary-navigation" className="primary-navigation" aria-label={ar ? "التنقل الأساسي" : "Primary navigation"}>
          {customerNavigation.map(renderNavLink)}
          <details className="sidebar-more" open={moreActive}>
            <summary>
              <ChevronDown size={16} aria-hidden="true" />
              <span>{ar ? "المزيد والعمليات" : "More & operations"}</span>
            </summary>
            <div className="sidebar-more-links">
              {operationsNavigation.map(renderNavLink)}
            </div>
          </details>
        </nav>

        <div className="sidebar-footer">
          <Link href="/team" className={`nav-link ${pathname.startsWith("/team") ? "nav-link-active" : ""}`} aria-current={pathname.startsWith("/team") ? "page" : undefined} onClick={() => closeMenu()}>
            <UsersRound size={18} />
            <span>{ar ? "الفريق والصلاحيات" : "Team & access"}</span>
          </Link>
          <Link href="/system" className={`nav-link ${pathname.startsWith("/system") ? "nav-link-active" : ""}`} aria-current={pathname.startsWith("/system") ? "page" : undefined} onClick={() => closeMenu()}>
            <Bell size={18} />
            <span>{ar ? "التنبيهات" : "Alerts"}</span>
          </Link>
          <Link href="/settings/integrations" className={`nav-link ${pathname.startsWith("/settings") ? "nav-link-active" : ""}`} aria-current={pathname.startsWith("/settings") ? "page" : undefined} onClick={() => closeMenu()}>
            <Settings size={18} />
            <span>{ar ? "الإعدادات" : "Settings"}</span>
          </Link>
          <SessionProfile />
        </div>
      </aside>

      {menuOpen ? <button className="sidebar-backdrop" type="button" aria-label={ar ? "إغلاق التنقل" : "Close navigation"} onClick={() => closeMenu({ returnFocus: true })} /> : null}

      <div className="workspace">
        <header className="topbar">
          <TenantName />
          <span className="environment-badge">{ar ? "بيئة العرض" : "Staging"}</span>
          <div className="topbar-actions">
            <LocaleToggle locale={locale} />
            <Link className="icon-button notification-button" href="/system" aria-label={ar ? "فتح تنبيهات النظام" : "Open system alerts"}>
              <Bell size={19} />
              <span aria-hidden="true" />
            </Link>
            <button className="icon-button" type="button" aria-label={ar ? "فتح المساعدة" : "Open help"}>
              <CircleHelp size={19} />
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content">{children}</main>
      </div>

      <nav className="mobile-navigation" aria-label={ar ? "تنقل الجوال" : "Mobile navigation"}>
        {customerNavigation.map((item) => {
          const { href, icon: Icon } = item;
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={active ? "mobile-nav-active" : ""} aria-current={active ? "page" : undefined}>
              <span className="mobile-nav-icon"><Icon size={20} /></span>
              <span>{navLabel(item)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
