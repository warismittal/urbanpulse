"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { canOpen } from "@/lib/auth/roles";
import { FAIR, PLACES, RAIL, RUNWAY } from "@/lib/city3d/config";
import { cn } from "@/lib/utils";

interface Command {
  label: string;
  hint: string;
  run: () => void;
  path?: string;
}

/** Tell the 3D city to do something (it listens while it's on screen). */
export function cityAction(detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent("urbanpulse:city", { detail }));
}

/** Ctrl/⌘+K: jump to any module, place in the 3D city, or run an action. Adapted from Ideociety. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const path = usePathname();
  const { user } = useAuth();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("urbanpulse:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("urbanpulse:palette", onOpen);
    };
  }, []);
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (p: string) => () => router.push(p);
    const in3d = (detail: Record<string, unknown>) => () => {
      if (path !== "/") router.push("/");
      setTimeout(() => cityAction(detail), path === "/" ? 0 : 1500);
    };
    const list: Command[] = [
      { label: "3D city", hint: "Live twin", run: go("/"), path: "/" },
      { label: "Dashboard", hint: "KPIs", run: go("/overview"), path: "/overview" },
      { label: "Traffic analytics", hint: "Signals · forecast", run: go("/traffic"), path: "/traffic" },
      { label: "Emergency scenarios", hint: "Fire · flood · quake", run: go("/emergency"), path: "/emergency" },
      { label: "Surveillance camera wall", hint: "CV analytics", run: go("/surveillance"), path: "/surveillance" },
      { label: "Environment", hint: "AQI · noise · heat", run: go("/environment"), path: "/environment" },
      { label: "Citizen app", hint: "Report · track", run: go("/citizen"), path: "/citizen" },
      { label: "Set time: sunrise", hint: "3D", run: in3d({ type: "hour", value: 6.2 }), path: "/" },
      { label: "Set time: noon", hint: "3D", run: in3d({ type: "hour", value: 12 }), path: "/" },
      { label: "Set time: sunset", hint: "3D", run: in3d({ type: "hour", value: 18.1 }), path: "/" },
      { label: "Set time: night", hint: "3D", run: in3d({ type: "hour", value: 21.5 }), path: "/" },
      { label: "Vintage film look", hint: "3D", run: in3d({ type: "film" }), path: "/" },
      { label: "Show vehicle perception (edge AI)", hint: "3D traffic", run: in3d({ type: "mode", value: "traffic" }), path: "/" },
      { label: "Dispatch an ambulance", hint: "3D traffic", run: in3d({ type: "ambulance" }), path: "/" },
      { label: "Go to the fairground", hint: "3D", run: in3d({ type: "fly", x: FAIR.x, z: FAIR.z, r: 95 }), path: "/" },
      { label: "Go to the railway station", hint: "3D", run: in3d({ type: "fly", x: RAIL.station, z: RAIL.z, r: 120 }), path: "/" },
      { label: "Go to the runway", hint: "3D", run: in3d({ type: "fly", x: (RUNWAY.x0 + RUNWAY.x1) / 2, z: RUNWAY.z, r: 190 }), path: "/" },
      ...PLACES.map((p) => ({ label: `Go to ${p.name}`, hint: "3D", run: in3d({ type: "fly", x: p.x, z: p.z, r: 120 }), path: "/" })),
    ];
    return user ? list.filter((c) => !c.path || canOpen(user.role, c.path)) : [];
  }, [router, path, user]);

  const results = useMemo(() => commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())).slice(0, 40), [commands, query]);
  if (!open || !user) return null;
  const run = (c: Command) => {
    setOpen(false);
    c.run();
  };
  return (
    <div className="fixed inset-0 z-[60] grid place-items-start bg-black/45 px-4 pt-[14vh] backdrop-blur-[2px] animate-[fadein_.15s_ease-out]" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Jump to" className="mx-auto w-full max-w-lg rounded-card border border-hair bg-overlay p-2 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-2">
          <Search className="h-4 w-4 text-muted" />
          <input
            ref={input}
            value={query}
            placeholder="Where to, or what to do?"
            aria-label="Search"
            className="w-full bg-transparent py-3 text-[16px] text-ink placeholder:text-muted focus:outline-none"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
              if (e.key === "Enter" && results[active]) run(results[active]);
            }}
          />
          <kbd className="rounded border border-hair px-1.5 text-[11px] text-muted">Esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto" role="listbox">
          {results.map((c, i) => (
            <li key={c.label} role="option" aria-selected={i === active}>
              <button onClick={() => run(c)} onMouseEnter={() => setActive(i)} className={cn("flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-left text-[14px]", i === active ? "bg-surface-raised text-ink" : "text-muted")}>
                <span>{c.label}</span>
                <span className="text-[12px]">{c.hint}</span>
              </button>
            </li>
          ))}
          {results.length === 0 ? <li className="px-3 py-4 text-[14px] text-muted">Nothing matches “{query}”.</li> : null}
        </ul>
      </div>
    </div>
  );
}
