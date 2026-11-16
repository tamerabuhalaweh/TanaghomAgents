"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRight,
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
  { href: "/", label: "Overview", arabic: "لوحة التحكم", icon: LayoutDashboard },
  { href: "/workspace", label: "AI workspace", arabic: "مساحة العمل الذكية", icon: UsersRound },
  { href: "/creative", label: "Creative Studio", arabic: "استوديو الإبداع", icon: Palette },
  { href: "/approvals", label: "Approvals", arabic: "الاعتمادات", icon: CheckCheck },
  { href: "/content", label: "Content", arabic: "المحتوى", icon: LibraryBig },
];

// Customer growth features stay visible. Only operator diagnostics use a disclosure.
const growthNavigation: NavItem[] = [
  { href: "/campaigns", label: "Campaigns", arabic: "الحملات", icon: BriefcaseBusiness },
  { href: "/leads", label: "Leads", arabic: "العملاء المحتملون", icon: ContactRound },
  { href: "/knowledge", label: "Knowledge", arabic: "المعرفة", icon: BookOpenCheck },
  { href: "/reports", label: "Reports", arabic: "التقارير", icon: ChartNoAxesCombined },
];

const advancedNavigation: NavItem[] = [
  { href: "/actions", label: "Agent actions", arabic: "إجراءات الوكلاء", icon: ClipboardCheck },
  { href: "/agents", label: "Agents", arabic: "الوكلاء", icon: Bot },
  { href: "/quality", label: "Quality & rollout", arabic: "الجودة والطرح", icon: ShieldCheck },
  { href: "/inbox", label: "Supervisor inbox", arabic: "صندوق المشرف", icon: MessagesSquare },
];

const helpLinks: NavItem[] = [
  { href: "/onboarding", label: "Workspace setup", arabic: "إعداد مساحة العمل", icon: UsersRound },
  { href: "/settings/channels", label: "Connect social channels", arabic: "ربط قنوات التواصل", icon: Bell },
  { href: "/creative/brand-kits", label: "Create a brand kit", arabic: "إنشاء هوية بصرية", icon: Palette },
  { href: "/workspace", label: "Draft with your AI team", arabic: "اكتب مسودة مع فريق الذكاء الاصطناعي", icon: ClipboardCheck },
  { href: "/settings/billing", label: "Billing & plans", arabic: "الفوترة والخطط", icon: ShieldCheck },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const helpDialogRef = useRef<HTMLDialogElement>(null);

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
  const moreActive = advancedNavigation.some((item) => pathname.startsWith(item.href));
  const settingsActive = pathname.startsWith("/settings") || pathname === "/onboarding";

  function openHelp() { helpDialogRef.current?.showModal(); }
  function closeHelp() { helpDialogRef.current?.close(); }

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
        <Link className="brand" href="/" aria-label={ar ? "لوحة التحكم في تناغم" : "Tanaghom dashboard"}>
          <BrandMark />
          <span>Tanaghom</span>
        </Link>
        <TenantName variant="mobile" />
        <div className="mobile-header-actions">
          <button className="icon-button" type="button" aria-label={ar ? "فتح المساعدة" : "Open help"} aria-haspopup="dialog" onClick={openHelp}>
            <CircleHelp size={19} />
          </button>
          <button ref={menuButtonRef} className="icon-button" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-controls="primary-navigation" aria-label={menuOpen ? (ar ? "إغلاق التنقل" : "Close navigation") : (ar ? "فتح التنقل" : "Open navigation")}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <Link className="brand desktop-brand" href="/" aria-label={ar ? "لوحة التحكم في تناغم" : "Tanaghom dashboard"}>
          <BrandMark />
          <span>Tanaghom</span>
        </Link>

        <nav id="primary-navigation" className="primary-navigation" aria-label={ar ? "التنقل الأساسي" : "Primary navigation"}>
          {customerNavigation.map(renderNavLink)}
          <div className="nav-section">
            <p className="nav-section-label">{ar ? "النمو وإدارة العملاء" : "Growth & CRM"}</p>
            {growthNavigation.map(renderNavLink)}
          </div>
          <details className="sidebar-more" open={moreActive}>
            <summary>
              <ChevronDown size={16} aria-hidden="true" />
              <span>{ar ? "عمليات متقدمة" : "Advanced operations"}</span>
            </summary>
            <div className="sidebar-more-links">
              {advancedNavigation.map(renderNavLink)}
            </div>
          </details>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-trust">
            <span className="environment-badge">{ar ? "موافقة بشرية قبل النشر" : "Human-Reviewed Workspace"}</span>
            <button className="nav-link sidebar-help-button" type="button" aria-label={ar ? "فتح المساعدة" : "Open help"} aria-haspopup="dialog" onClick={() => { closeMenu(); openHelp(); }}>
              <CircleHelp size={18} />
              <span>{ar ? "المساعدة السريعة" : "Quick help"}</span>
            </button>
          </div>
          <div className="sidebar-locale"><LocaleToggle locale={locale} /></div>
          <Link href="/team" className={`nav-link ${pathname.startsWith("/team") ? "nav-link-active" : ""}`} aria-current={pathname.startsWith("/team") ? "page" : undefined} onClick={() => closeMenu()}>
            <UsersRound size={18} />
            <span>{ar ? "الفريق والصلاحيات" : "Team & access"}</span>
          </Link>
          <Link href="/system" className={`nav-link ${pathname.startsWith("/system") ? "nav-link-active" : ""}`} aria-current={pathname.startsWith("/system") ? "page" : undefined} onClick={() => closeMenu()}>
            <Bell size={18} />
            <span>{ar ? "التنبيهات" : "Alerts"}</span>
          </Link>
          <Link href="/settings/channels" className={`nav-link ${settingsActive ? "nav-link-active" : ""}`} aria-current={settingsActive ? "page" : undefined} onClick={() => closeMenu()}>
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
          <span className="environment-badge">{ar ? "موافقة بشرية قبل النشر" : "Human-Reviewed Workspace"}</span>
          <div className="topbar-actions">
            <LocaleToggle locale={locale} />
            <Link className="icon-button notification-button" href="/system" aria-label={ar ? "فتح تنبيهات النظام" : "Open system alerts"}>
              <Bell size={19} />
              <span aria-hidden="true" />
            </Link>
            <button ref={helpButtonRef} className="icon-button" type="button" aria-label={ar ? "فتح المساعدة" : "Open help"} aria-haspopup="dialog" onClick={openHelp}>
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

      <dialog ref={helpDialogRef} className="help-dialog" aria-modal="true" aria-labelledby="help-dialog-title" onClose={() => helpButtonRef.current?.focus()}>
        <header className="help-dialog-header">
          <div><span className="help-dialog-eyebrow"><CircleHelp size={17} aria-hidden="true" />{ar ? "مساعدة سريعة" : "Quick help"}</span><h2 id="help-dialog-title">{ar ? "دليل مساحة العمل" : "Workspace quick guide"}</h2><p>{ar ? "كل ما تحتاجه للانتقال من الإعداد إلى أول حملة معتمدة." : "Everything you need to move from setup to your first approved campaign."}</p></div>
          <button type="button" className="icon-button" onClick={closeHelp} aria-label={ar ? "إغلاق المساعدة" : "Close help"}><X size={19} /></button>
        </header>
        <nav className="help-dialog-links" aria-label={ar ? "روابط المساعدة" : "Help links"}>
          {helpLinks.map(({ href, label, arabic, icon: Icon }) => <Link key={href} href={href} onClick={closeHelp}>
            <span><Icon size={18} /></span><strong>{ar ? arabic : label}</strong><ArrowRight size={15} className="help-link-arrow" aria-hidden="true" />
          </Link>)}
        </nav>
        <section className="help-dialog-note">
          <ShieldCheck size={20} aria-hidden="true" />
          <div><strong>{ar ? "لماذا الاعتماد البشري؟" : "Why human-in-the-loop approval?"}</strong><p>{ar ? "يقترح فريق الذكاء الاصطناعي المحتوى، لكن لا يُنشر شيء إلا بعد مراجعة شخص مسؤول. يبقى الموجز والمصدر وسجل القرار مرتبطاً بكل مسودة لحماية علامتك." : "Your AI team proposes the work, but nothing publishes until a responsible person reviews it. The brief, sources, and decision history stay attached to every draft so your brand stays protected."}</p></div>
        </section>
      </dialog>
    </div>
  );
}
