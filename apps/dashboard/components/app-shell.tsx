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
  CircleHelp,
  ContactRound,
  LayoutDashboard,
  Menu,
  Settings,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { BrandMark } from "./brand-mark";

const primaryNavigation = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: BriefcaseBusiness },
  { href: "/approvals", label: "Approvals", icon: CheckCheck, count: 3 },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/leads", label: "Leads", icon: ContactRound },
  { href: "/reports", label: "Reports", icon: ChartNoAxesCombined },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="mobile-header">
        <Link className="brand" href="/" aria-label="Tanaghom overview">
          <BrandMark />
          <span>Tanaghom</span>
        </Link>
        <button className="icon-button" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-controls="primary-navigation" aria-label={menuOpen ? "Close navigation" : "Open navigation"}>
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <Link className="brand desktop-brand" href="/" aria-label="Tanaghom overview">
          <BrandMark />
          <span>Tanaghom</span>
        </Link>

        <nav id="primary-navigation" className="primary-navigation" aria-label="Primary navigation">
          {primaryNavigation.map(({ href, label, icon: Icon, count }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={`nav-link ${active ? "nav-link-active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setMenuOpen(false)}>
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
                {count ? <span className="nav-count" aria-label={`${count} pending`}>{count}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <Link href="/system" className="nav-link">
            <Bell size={18} />
            <span>Alerts</span>
            <span className="nav-count nav-count-warning" aria-label="2 alerts">2</span>
          </Link>
          <Link href="/system" className="nav-link">
            <Settings size={18} />
            <span>System</span>
          </Link>
          <button className="profile-switcher" type="button">
            <span className="avatar">KM</span>
            <span className="profile-copy"><strong>Kim Morgan</strong><small>Operations lead</small></span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
      </aside>

      {menuOpen ? <button className="sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}

      <div className="workspace">
        <header className="topbar">
          <span className="environment-badge">Staging</span>
          <div className="topbar-actions">
            <button className="icon-button notification-button" type="button" aria-label="Open notifications">
              <Bell size={19} />
              <span aria-hidden="true" />
            </button>
            <button className="icon-button" type="button" aria-label="Open help">
              <CircleHelp size={19} />
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content">{children}</main>
      </div>

      <nav className="mobile-navigation" aria-label="Mobile navigation">
        {primaryNavigation.slice(0, 5).map(({ href, label, icon: Icon, count }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={active ? "mobile-nav-active" : ""} aria-current={active ? "page" : undefined}>
              <span className="mobile-nav-icon"><Icon size={20} />{count ? <i>{count}</i> : null}</span>
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
