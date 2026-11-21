"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, LogOut, Menu, Search, X } from "lucide-react";
import { ThemeToggle } from "@/components/common/ThemeToggle";
import { CommandPalette } from "@/components/layout/command-palette";
import { SosButton } from "@/components/layout/sos";
import { useAuth } from "@/lib/auth/auth-context";
import { canOpen, roleInfo } from "@/lib/auth/roles";
import { useCity, useNow } from "@/lib/store/city-store";
import { cn, formatAgo } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "3D City" },
  { href: "/overview", label: "Dashboard" },
  { href: "/traffic", label: "Traffic" },
  { href: "/emergency", label: "Emergency" },
  { href: "/surveillance", label: "Surveillance" },
  { href: "/environment", label: "Environment" },
  { href: "/citizen", label: "Citizen app" },
];

const SEV_DOT = { critical: "bg-danger", warning: "bg-warning", info: "bg-info" } as const;

export function Navbar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const links = user ? NAV_LINKS.filter((l) => canOpen(user.role, l.href)) : [];
  const [menuState, setMenuState] = useState<{ menu: "none" | "alerts" | "mobile"; path: string }>({ menu: "none", path: pathname });
  const menu = menuState.path === pathname ? menuState.menu : "none";
  const setMenu = (m: "none" | "alerts" | "mobile") => setMenuState({ menu: m, path: pathname });
  const alertsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (alertsRef.current && !alertsRef.current.contains(e.target as Node)) {
        setMenuState((c) => (c.menu === "alerts" ? { ...c, menu: "none" } : c));
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <header className="sticky top-0 z-40 border-b border-hair bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="UrbanPulse home">
          <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-primary text-on-primary" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 13h4l2.5-6 4 11 3-8 2 3H22" />
            </svg>
          </span>
          <span className="text-[16px] font-semibold tracking-[-0.01em] text-ink">UrbanPulse</span>
        </Link>

        <nav className="ml-8 hidden h-full items-center lg:flex" aria-label="Modules">
          {links.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-14 items-center px-3 text-[14px] transition-colors duration-150",
                  active ? "font-medium text-ink" : "text-muted hover:text-ink"
                )}
              >
                {link.label}
                {active ? <span className="absolute inset-x-3 -bottom-px h-0.5 bg-primary" aria-hidden="true" /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event("urbanpulse:palette"))}
                className="hidden h-9 items-center gap-2 rounded-control border border-hair px-2.5 text-[13px] text-muted transition-colors hover:border-hair-strong hover:text-ink md:flex"
                aria-label="Search and jump (Ctrl K)"
              >
                <Search className="h-4 w-4" /> Jump to… <kbd className="rounded border border-hair px-1 text-[10px]">Ctrl K</kbd>
              </button>
              <SosButton />
              <AlertsMenu open={menu === "alerts"} onToggle={() => setMenu(menu === "alerts" ? "none" : "alerts")} innerRef={alertsRef} />
            </>
          ) : null}
          <ThemeToggle />
          {user ? <UserMenu /> : null}
          <button
            type="button"
            onClick={() => setMenu(menu === "mobile" ? "none" : "mobile")}
            aria-label={menu === "mobile" ? "Close menu" : "Open menu"}
            aria-expanded={menu === "mobile"}
            className="grid h-10 w-10 place-items-center rounded-[6px] text-ink transition-colors hover:bg-surface-raised lg:hidden"
          >
            {menu === "mobile" ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menu === "mobile" ? (
        <nav aria-label="Mobile" className="flex flex-col border-t border-hair bg-surface px-4 pb-4 pt-2 lg:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenu("none")}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center rounded-[6px] px-3 text-[14px]",
                isActive(link.href) ? "bg-surface-raised font-medium text-ink" : "text-muted"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <CommandPalette />
    </header>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, []);
  if (!user) return null;
  const info = roleInfo(user.role);
  const initials = user.name.split(/\s+/).filter((w) => /[A-Za-z]/.test(w[0] ?? "")).slice(-2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" className="flex h-9 items-center gap-2 rounded-control pl-1 pr-2 hover:bg-surface-raised" aria-label={`Account: ${user.name}, ${info.label}`}>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-[11px] font-semibold text-on-primary">{initials || "U"}</span>
        <span className="hidden text-left leading-4 xl:block">
          <span className="block text-[12px] font-medium text-ink">{user.name}</span>
          <span className="block text-[11px] text-muted">{info.label}</span>
        </span>
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 rounded-card border border-hair bg-overlay p-2 shadow-pop">
          <div className="px-2 py-1.5">
            <p className="text-[13px] font-medium text-ink">{user.name}</p>
            <p className="text-[12px] text-muted">{user.email}</p>
            <p className="mt-1 text-[12px] text-muted">
              {info.label} · {info.department}
            </p>
          </div>
          <button
            role="menuitem"
            onClick={() => {
              logout();
              router.replace("/auth/login");
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-[13px] text-ink hover:bg-surface-raised"
          >
            <LogOut className="h-4 w-4 text-muted" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AlertsMenu({ open, onToggle, innerRef }: { open: boolean; onToggle: () => void; innerRef: React.RefObject<HTMLDivElement | null> }) {
  const { alerts } = useCity();
  const now = useNow(15000);
  const recent = alerts.filter((a) => now - a.ts < 30 * 60_000);
  const critical = recent.filter((a) => a.severity === "critical").length;
  return (
    <div className="relative" ref={innerRef}>
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Alerts, ${recent.length} in the last 30 minutes`}
        className="relative grid h-9 w-9 place-items-center rounded-control border border-hair text-muted transition-colors hover:border-hair-strong hover:text-ink"
      >
        <Bell className="h-[18px] w-[18px]" />
        {recent.length > 0 ? (
          <span
            className={cn(
              "absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
              critical ? "bg-danger text-on-primary" : "bg-primary text-on-primary"
            )}
          >
            {recent.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-[min(380px,calc(100vw-32px))] rounded-card border border-hair bg-overlay p-2 shadow-pop">
          <p className="px-2 pb-2 pt-1 text-[12px] text-muted">City alerts</p>
          <ul className="max-h-96 space-y-1 overflow-y-auto">
            {alerts.slice(0, 12).map((a) => (
              <li key={a.id} className="rounded-[6px] px-2 py-2 hover:bg-surface-raised">
                <p className="flex items-start gap-2 text-[13px] font-medium leading-5 text-ink">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", SEV_DOT[a.severity])} aria-hidden="true" />
                  <span className="min-w-0">
                    {a.title}
                    <span className="block text-[12px] font-normal text-muted">
                      {a.severity === "critical" ? "Critical" : a.severity === "warning" ? "Warning" : "Info"} · {a.source} · {formatAgo(a.ts, now)}
                      {a.public ? " · broadcast" : ""}
                    </span>
                  </span>
                </p>
              </li>
            ))}
            {alerts.length === 0 ? <li className="px-2 py-4 text-[13px] text-muted">No alerts.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
