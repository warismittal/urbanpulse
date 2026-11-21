"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Ambulance,
  BrainCircuit,
  Clapperboard,
  Clock,
  Plane,
  TrainFront,
  FerrisWheel,
  ArrowRight,
  Car,
  Cctv,
  CloudFog,
  Droplets,
  Factory,
  Flame,
  LayoutDashboard,
  MapPin,
  Megaphone,
  Smartphone,
  Square,
  Users,
} from "lucide-react";
import { CityView, WorldLabels, useCity3D, type PaletteId, type Quality } from "@/components/city3d/CityView";
import { Segmented, Toggle } from "@/components/common/kit";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CCTV_NODES, FAIR, PALETTES, PLACES, RAIL, ROAD_NODES, RUNWAY } from "@/lib/city3d/config";
import { formatHour } from "@/lib/city3d/daynight";
import type { ScenarioKind3 } from "@/lib/city3d/layers3d";
import { STATIONS, aqiBand, stationReading } from "@/lib/sim/environment";
import { SCENES, eventLog, startSurveillance } from "@/lib/sim/surveillance";
import { useCity, useNow } from "@/lib/store/city-store";
import { cn, formatAgo } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { canOpen, roleInfo } from "@/lib/auth/roles";

type Mode = "overview" | "traffic" | "emergency" | "surveillance" | "environment" | "citizen";

const MODES: { id: Mode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "City", icon: LayoutDashboard },
  { id: "traffic", label: "Traffic", icon: Car },
  { id: "emergency", label: "Emergency", icon: Flame },
  { id: "surveillance", label: "CCTV", icon: Cctv },
  { id: "environment", label: "Air", icon: CloudFog },
  { id: "citizen", label: "Citizen", icon: Smartphone },
];

const VIEWS = [
  { id: "city", label: "City", x: -60, z: -90, r: 330, phi: 0.93 },
  { id: "downtown", label: "Downtown", x: 0, z: -95, r: 170, phi: 0.95 },
  { id: "river", label: "River", x: -120, z: -40, r: 230, phi: 0.85 },
  { id: "airport", label: "Airport", x: -10, z: -225, r: 190, phi: 0.9 },
  { id: "fair", label: "Fair", x: FAIR.x, z: FAIR.z, r: 95, phi: 1.0 },
  { id: "rail", label: "Station", x: RAIL.station, z: RAIL.z, r: 120, phi: 1.0 },
  { id: "sea", label: "Horizon", x: -98, z: -106, r: 900, phi: 1.32 },
];

/** Map a 3D city point onto the 2D digital-twin map, so citizen reports land in the same store. */
function to2D(x: number, z: number) {
  const u = (x + 240) / 287;
  const v = (z + 260) / 312;
  return { x: 40 + Math.max(0, Math.min(1, u)) * 960, y: 40 + Math.max(0, Math.min(1, v)) * 720 };
}

export default function City3DPage() {
  const [palette, setPalette] = useState<PaletteId | "auto">("auto");
  const [quality, setQuality] = useState<Quality>("high");
  const [mode, setMode] = useState<Mode>("overview");
  const [reporting, setReporting] = useState<null | "pothole" | "garbage" | "water">(null);
  const { addComplaint } = useCity();
  const { toast } = useToast();

  const onCanvasClick = (x: number, z: number) => {
    if (!reporting) return;
    const p = to2D(x, z);
    const c = addComplaint({ category: reporting, description: `Reported from the 3D city at (${x.toFixed(0)}, ${z.toFixed(0)})`, x: p.x, y: p.y, sector: 0, reporter: "You" });
    toast({ tone: "success", title: `Complaint ${c.id} filed`, description: "Track it in the Citizen app." });
    setReporting(null);
  };

  return (
    <CityView key={quality} palette={palette} quality={quality} onCanvasClick={onCanvasClick}>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 top-14 z-10">
        <SidePanel mode={mode} setMode={setMode} reporting={reporting} setReporting={setReporting} />
        <TopRight palette={palette} setPalette={setPalette} quality={quality} setQuality={setQuality} />
        <AlertTicker />
        {reporting ? (
          <div className="pointer-events-auto absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-[13px] text-white shadow-pop">
            Click the spot in the city to report a {reporting === "water" ? "water leak" : reporting}.{" "}
            <button className="ml-2 underline" onClick={() => setReporting(null)}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
      <PlaceLabels mode={mode} />
      <ModeSync mode={mode} />
      <CityActions setMode={setMode} />
      <div className="h-[calc(100vh-56px)]" aria-hidden="true" />
    </CityView>
  );
}

/** Actions sent from the command palette and the SOS button. */
function CityActions({ setMode }: { setMode: (m: Mode) => void }) {
  const h = useCity3D();
  useEffect(() => {
    if (!h) return;
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { type: string; [k: string]: unknown };
      if (d.type === "fly") h.engine.rig.flyTo(d.x as number, d.z as number, (d.r as number) ?? 120, 0.95);
      if (d.type === "hour") h.engine.setHour(d.value as number);
      if (d.type === "film") h.engine.setFilm(!h.engine.film);
      if (d.type === "mode") setMode(d.value as Mode);
      if (d.type === "ambulance" || d.type === "sos") {
        const unit = (d.unit as "ambulance" | "fire" | "police") ?? "ambulance";
        const base = PLACES.find((p) => p.kind === (unit === "ambulance" ? "hospital" : unit))!;
        const dests = PLACES.filter((p) => p.kind === "residential" || p.kind === "station" || p.kind === "civic");
        const to = dests[Math.floor(Math.random() * dests.length)];
        const label = `${unit === "ambulance" ? "Ambulance" : unit === "fire" ? "Fire engine" : "Police"} → ${to.name}`;
        if (h.traffic.dispatch(unit, label, base.x, base.z, to.x, to.z)) {
          setMode("traffic");
          h.engine.rig.flyTo(base.x, base.z, 150, 0.9);
        }
      }
    };
    window.addEventListener("urbanpulse:city", on);
    return () => window.removeEventListener("urbanpulse:city", on);
  }, [h, setMode]);
  return null;
}

function ModeSync({ mode }: { mode: Mode }) {
  const h = useCity3D();
  const { pushAlert } = useCity();
  useEffect(() => {
    if (!h) return;
    h.sensors.setMode(mode);
    h.traffic.setHeatVisible(mode === "traffic" || mode === "overview");
    h.traffic.setAIVisible(mode === "traffic");
  }, [h, mode]);
  // Start the sky at the visitor's local time; the clock then runs at an hour a minute.
  useEffect(() => {
    if (!h) return;
    const d = new Date();
    h.engine.setHour(d.getHours() + d.getMinutes() / 60);
  }, [h]);
  // Live events from the 3D simulation feed the shared alert store.
  useEffect(() => {
    if (!h) return;
    let seen = h.traffic.events.length;
    let lastPlane = "";
    let crossing = false;
    const t = window.setInterval(() => {
      const ev = h.traffic.events;
      for (; seen < ev.length; seen++) {
        if (ev[seen].text.includes("arrived")) pushAlert({ severity: "info", source: "traffic", title: ev[seen].text, body: "Signal pre-emption cleared the route.", public: false });
      }
      const st = h.life.status();
      if (st.plane !== lastPlane && /Touchdown|Take-off roll/.test(st.plane)) pushAlert({ severity: "info", source: "traffic", title: st.plane.startsWith("Touchdown") ? "Flight landed on runway 27" : "Flight departing runway 27", body: "Airport operations", public: false });
      lastPlane = st.plane;
      if (st.crossingClosed && !crossing) pushAlert({ severity: "info", source: "traffic", title: "Level crossing closed on Airport Road", body: "Train approaching — traffic held at the barriers.", public: false });
      crossing = st.crossingClosed;
    }, 1000);
    return () => window.clearInterval(t);
  }, [h, pushAlert]);
  // Air-quality pillars use the same station model as the Environment dashboard.
  const now = useNow(5000);
  useEffect(() => {
    if (!h) return;
    const hour = new Date(now).getHours() + new Date(now).getMinutes() / 60;
    const rs = STATIONS.map((st) => stationReading(st, 0, hour));
    h.sensors.setAqi(
      rs.map((r) => r.aqi),
      rs.map((r) => aqiBand(r.aqi).color)
    );
  }, [h, now]);
  return null;
}

function PlaceLabels({ mode }: { mode: Mode }) {
  const items = useMemo(
    () =>
      PLACES.filter((p) => p.kind !== "park").map((p) => ({ id: p.id, text: p.name, x: p.x, y: p.height + 18, z: p.z })),
    []
  );
  return <WorldLabels items={items} visible={mode === "overview" || mode === "citizen"} />;
}

/* --------------------------------------------------------------- panels */

const glass = "pointer-events-auto rounded-card border border-white/40 bg-white/75 shadow-pop backdrop-blur-md dark:border-white/10 dark:bg-[#141816]/80";

function TopRight({ palette, setPalette, quality, setQuality }: { palette: PaletteId | "auto"; setPalette: (p: PaletteId | "auto") => void; quality: Quality; setQuality: (q: Quality) => void }) {
  const h = useCity3D();
  const [, tick] = useState(0);
  const [rate, setRate] = useState("60");
  const film = h?.engine.film ?? false;
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const hour = h?.engine.hour ?? 17;
  const setSpeed = (v: string) => {
    setRate(v);
    if (!h) return;
    if (v === "live") {
      const d = new Date();
      h.engine.setHour(d.getHours() + d.getMinutes() / 60);
      h.engine.timeRate = 1 / 3600;
    } else h.engine.timeRate = v === "0" ? 0 : 1 / Number(v);
    setPalette("auto");
  };
  return (
    <div className="pointer-events-none absolute right-4 top-4 flex max-w-[min(720px,calc(100vw-420px))] flex-col items-end gap-2">
      <div className={cn(glass, "flex flex-wrap items-center justify-end gap-2 p-2")}>
        <Segmented
          ariaLabel="Camera view"
          value=""
          onChange={(v) => {
            const view = VIEWS.find((x) => x.id === v);
            if (view) h?.engine.rig.flyTo(view.x, view.z, view.r, view.phi);
          }}
          options={VIEWS.map((v) => ({ id: v.id, label: v.label }))}
        />
        <Segmented ariaLabel="Quality" value={quality} onChange={(q) => setQuality(q)} options={[{ id: "high", label: "HQ" }, { id: "medium", label: "Fast" }]} />
      </div>
      <div className={cn(glass, "flex flex-wrap items-center justify-end gap-2 p-2")}>
        <span className="flex items-center gap-1.5 pl-1 text-[13px] font-semibold tabular-nums text-ink">
          <Clock className="h-4 w-4 text-muted" /> {formatHour(hour)}
        </span>
        <input
          aria-label="Time of day"
          type="range"
          min={0}
          max={23.9}
          step={0.1}
          value={hour}
          onChange={(e) => {
            h?.engine.setHour(Number(e.target.value));
            setPalette("auto");
            tick((x) => x + 1);
          }}
          className="w-28"
        />
        <Segmented
          ariaLabel="Clock speed"
          value={rate}
          onChange={setSpeed}
          options={[
            { id: "live", label: "Live" },
            { id: "60", label: "1 h/min" },
            { id: "10", label: "Fast" },
            { id: "0", label: "Pause" },
          ]}
        />
        <Segmented
          ariaLabel="Look"
          value={String(palette)}
          onChange={(v) => setPalette(v === "auto" ? "auto" : (Number(v) as PaletteId))}
          options={[{ id: "auto", label: "Sun" }, ...([1, 2, 3] as PaletteId[]).map((id) => ({ id: String(id), label: PALETTES[id].name }))]}
        />
        <button
          onClick={() => {
            h?.engine.setFilm(!film);
            tick((x) => x + 1);
          }}
          aria-pressed={film}
          className={cn("flex items-center gap-1 rounded-control px-2 py-1 text-[12px] transition-colors", film ? "bg-primary text-on-primary" : "text-muted hover:bg-black/5 hover:text-ink dark:hover:bg-white/5")}
          title="Vintage film look"
        >
          <Clapperboard className="h-3.5 w-3.5" /> Film
        </button>
      </div>
    </div>
  );
}

function AlertTicker() {
  const { alerts } = useCity();
  const now = useNow(10000);
  const list = alerts.slice(0, 3);
  if (!list.length) return null;
  return (
    <div className={cn(glass, "absolute bottom-4 right-4 w-[min(380px,calc(100vw-32px))] p-3")}>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Latest alerts</p>
      <ul className="space-y-1.5">
        {list.map((a) => (
          <li key={a.id} className="flex gap-2 text-[12px] leading-5">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", a.severity === "critical" ? "bg-danger" : a.severity === "warning" ? "bg-warning" : "bg-info")} />
            <span className="min-w-0">
              <span className="font-medium text-ink">{a.title}</span>
              <span className="text-muted"> · {formatAgo(a.ts, now)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SidePanel({
  mode,
  setMode,
  reporting,
  setReporting,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  reporting: string | null;
  setReporting: (r: null | "pothole" | "garbage" | "water") => void;
}) {
  const h = useCity3D();
  const { user } = useAuth();
  const allowed = user ? roleInfo(user.role).modes : [];
  const modes = MODES.filter((m) => allowed.includes(m.id));
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 500);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (user && !allowed.includes(mode)) setMode("overview");
  }, [user, allowed, mode, setMode]);
  return (
    <aside className={cn(glass, "absolute bottom-4 left-4 top-4 flex w-[min(380px,calc(100vw-32px))] flex-col overflow-hidden")}>
      <div className="border-b border-black/5 px-4 pb-2 pt-3 dark:border-white/10">
        <p className="text-[15px] font-semibold text-ink">Live city</p>
        <p className="text-[12px] text-muted">{h ? "Drag to orbit · right-drag to pan · scroll to zoom" : "Loading…"}</p>
        <div className="mt-2.5 grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, modes.length)}, minmax(0, 1fr))` }} role="tablist" aria-label="Layer">
          {modes.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-control px-1 py-1.5 text-[10px] font-medium transition-colors",
                mode === m.id ? "bg-primary text-on-primary" : "text-muted hover:bg-black/5 hover:text-ink dark:hover:bg-white/5"
              )}
            >
              <m.icon className="h-4 w-4" />
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div key={mode} className="min-h-0 flex-1 animate-[fadein_.3s_ease-out] overflow-y-auto px-4 py-3">
        {!h ? <p className="text-[13px] text-muted">The city is loading…</p> : null}
        {h && mode === "overview" ? <OverviewMode /> : null}
        {h && mode === "traffic" ? <TrafficMode /> : null}
        {h && mode === "emergency" ? <EmergencyMode /> : null}
        {h && mode === "surveillance" ? <CctvMode /> : null}
        {h && mode === "environment" ? <AirMode /> : null}
        {h && mode === "citizen" ? <CitizenMode reporting={reporting} setReporting={setReporting} /> : null}
      </div>
    </aside>
  );
}

function Kpi({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-control bg-black/[0.04] px-3 py-2 dark:bg-white/5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={cn("text-[17px] font-semibold tabular-nums", tone === "bad" ? "text-danger" : tone === "warn" ? "text-warning" : tone === "good" ? "text-success" : "text-ink")}>{value}</p>
    </div>
  );
}

function MoreLink({ href, label }: { href: string; label: string }) {
  const { user } = useAuth();
  if (!user || !canOpen(user.role, href)) return null;
  return (
    <Link href={href} className="mt-4 flex items-center justify-between rounded-control border border-black/10 px-3 py-2 text-[13px] text-ink hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5">
      {label}
      <ArrowRight className="h-4 w-4 text-muted" />
    </Link>
  );
}

function FlyList({ items }: { items: { id: string; label: string; sub?: string; x: number; z: number }[] }) {
  const h = useCity3D()!;
  return (
    <ul className="space-y-0.5">
      {items.map((it) => (
        <li key={it.id}>
          <button onClick={() => h.engine.rig.flyTo(it.x, it.z, 120, 0.95)} className="flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left text-[13px] hover:bg-black/5 dark:hover:bg-white/5">
            <span className="min-w-0">
              <span className="block truncate text-ink">{it.label}</span>
              {it.sub ? <span className="block truncate text-[11px] text-muted">{it.sub}</span> : null}
            </span>
            <MapPin className="h-3.5 w-3.5 shrink-0 text-muted" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function OverviewMode() {
  const h = useCity3D()!;
  const s = h.traffic.stats();
  const sc = h.scenarios.status;
  const { alerts } = useCity();
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Vehicles on road" value={s.vehicles} />
        <Kpi label="Avg speed" value={`${s.speedKmh.toFixed(0)} km/h`} tone={s.speedKmh < 15 ? "warn" : "good"} />
        <Kpi label="Signals" value={`${s.signals} adaptive`} />
        <Kpi label="Active incident" value={sc ? sc.phase : "None"} tone={sc ? "bad" : "good"} />
      </div>
      <LifeStatus />
      <p className="eyebrow mb-1 mt-4">Key buildings</p>
      <FlyList items={PLACES.filter((p) => ["command", "hospital", "police", "fire", "civic", "airport", "station"].includes(p.kind)).map((p) => ({ id: p.id, label: p.name, x: p.x, z: p.z }))} />
      <p className="mt-4 text-[12px] text-muted">{alerts.length} alerts on record. The full KPI dashboard and analytics are one click away.</p>
      <MoreLink href="/overview" label="Open the dashboard" />
    </div>
  );
}

function LifeStatus() {
  const h = useCity3D()!;
  const st = h.life.status();
  const rows: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; x: number; z: number; r: number }[] = [
    { icon: TrainFront, label: "Heritage steam train", value: st.train, x: RAIL.station, z: RAIL.z, r: 110 },
    { icon: Plane, label: "Flight AI-27", value: st.plane, x: (RUNWAY.x0 + RUNWAY.x1) / 2, z: RUNWAY.z, r: 200 },
    { icon: FerrisWheel, label: "Riverside Fair", value: `Wheel ${st.fair.wheel.toLowerCase()} · carousel ${st.fair.carousel.toLowerCase()} · ~${st.fair.visitors} visitors`, x: FAIR.x, z: FAIR.z, r: 95 },
  ];
  return (
    <>
      <p className="eyebrow mb-1 mt-4">City life · {formatHour(h.engine.hour)}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.label}>
            <button onClick={() => h.engine.rig.flyTo(r.x, r.z, r.r, 0.98)} className="flex w-full items-start gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5">
              <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0">
                <span className="block text-[13px] text-ink">{r.label}</span>
                <span className="block text-[11px] leading-4 text-muted">{r.value}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-muted">{st.lamps} street lamps switch on at dusk{st.crossingClosed ? " · level crossing closed" : ""}.</p>
    </>
  );
}

function EdgeAIPanel() {
  const h = useCity3D()!;
  const tr = h.traffic;
  const ai = tr.stats().ai;
  const total = Object.values(ai.states).reduce((a, b) => a + b, 0) || 1;
  const bar: [keyof typeof ai.states, string, string][] = [
    ["free", "Clear road", "#2fd07a"],
    ["follow", "Following", "#35b7ff"],
    ["yield", "Yielding", "#ffb21e"],
    ["brake", "Braking for hazard", "#ff4b3a"],
    ["stop", "Stopped (signal / queue)", "#ff2a6a"],
  ];
  return (
    <div className="mt-4 rounded-control border border-black/10 p-3 dark:border-white/10">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <BrainCircuit className="h-4 w-4 text-primary" /> On-board perception (edge AI)
        </p>
        <Toggle checked={tr.aiVisible} onChange={(v) => tr.setAIVisible(v)} label="" />
      </div>
      <p className="mt-1 text-[11px] leading-4 text-muted">Every vehicle projects its planned path and checks it against the footprints of nearby vehicles; junctions are reserved so crossing paths never overlap. Scan beams show each car&apos;s state.</p>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full" aria-hidden="true">
        {bar.map(([k, , c]) => (
          <span key={k} style={{ width: `${(ai.states[k] / total) * 100}%`, background: c }} />
        ))}
      </div>
      <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        {bar.map(([k, label, c]) => (
          <li key={k} className="flex items-center justify-between gap-1">
            <span className="flex items-center gap-1 text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: c }} /> {label}
            </span>
            <span className="tabular-nums text-ink">{ai.states[k]}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <Kpi label="Path checks/s" value={ai.checksPerSec.toLocaleString()} />
        <Kpi label="Fleet scan" value={`${ai.latencyMs} ms`} />
        <Kpi label="Overlaps" value={ai.overlaps} tone={ai.overlaps ? "bad" : "good"} />
        <Kpi label="Yields" value={ai.yields} />
        <Kpi label="Hazard brakes" value={ai.brakes} />
        <Kpi label="Junction holds" value={ai.conflictsHeld} />
        <Kpi label="Box kept clear" value={ai.boxHeld} />
        <Kpi label="Re-routes" value={ai.reroutes} />
        <Kpi label="Min gap" value={`${Math.max(0, ai.minClearance).toFixed(1)} m`} tone={ai.minClearance < 0 ? "warn" : "good"} />
      </div>
      <p className="mt-1.5 text-[10px] leading-4 text-muted">Overlaps and min gap come from an independent audit of every vehicle pair, twice a second.</p>
    </div>
  );
}

function TrafficMode() {
  const h = useCity3D()!;
  const tr = h.traffic;
  const s = tr.stats();
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Vehicles" value={s.vehicles} />
        <Kpi label="Avg speed" value={`${s.speedKmh.toFixed(0)} km/h`} tone={s.speedKmh < 15 ? "warn" : "good"} />
        <Kpi label="Queued" value={`${Math.round(s.stoppedPct * 100)}%`} />
        <Kpi label="Phase changes" value={tr.switches} />
      </div>
      <label className="mt-3 block text-[12px] text-muted" htmlFor="fleet3d">
        Vehicles on the island: {tr.target}
      </label>
      <input id="fleet3d" type="range" min={0} max={160} step={4} defaultValue={tr.target} onChange={(e) => tr.setTarget(Number(e.target.value))} className="w-full" />
      <Toggle checked={tr.adaptive} onChange={(v) => (tr.adaptive = v)} label="Adaptive signals" hint="Serve the longer queue; off = fixed 20 s cycle." />
      <Toggle checked={tr.priorityEnabled} onChange={(v) => (tr.priorityEnabled = v)} label="Emergency green wave" hint="Signals ahead of ambulances turn green; traffic pulls over." />
      <Button
        size="sm"
        className="mt-2 w-full"
        onClick={() => {
          const dests = PLACES.filter((p) => p.kind === "residential" || p.kind === "station" || p.kind === "airport");
          const d = dests[Math.floor(Math.random() * dests.length)];
          const hosp = PLACES.find((p) => p.kind === "hospital")!;
          tr.dispatch("ambulance", `Ambulance → ${d.name}`, hosp.x, hosp.z, d.x, d.z);
          h.engine.rig.flyTo(hosp.x, hosp.z, 150, 0.9);
        }}
      >
        <Ambulance className="h-4 w-4" /> Dispatch ambulance
      </Button>
      <ul className="mt-2 space-y-1.5">
        {tr.units
          .filter((u) => u.kind === "ambulance")
          .slice(0, 4)
          .map((u) => {
            const took = (u.arrivedAt ?? tr.t) - u.startedAt;
            return (
              <li key={u.id} className="rounded-control bg-black/[0.04] px-2.5 py-1.5 text-[12px] dark:bg-white/5">
                <p className="text-ink">{u.label}</p>
                <p className="text-muted">
                  {u.done ? "Arrived in" : "Elapsed"} {took.toFixed(0)} s · {u.signalsCleared} signals cleared
                  {u.done && u.estimate > took ? <span className="text-success"> · {(u.estimate - took).toFixed(0)} s saved</span> : null}
                </p>
              </li>
            );
          })}
      </ul>
      <EdgeAIPanel />
      <p className="eyebrow mb-1 mt-4">Most congested roads</p>
      <ul className="space-y-1 text-[12px]">
        {s.worst.map((w) => (
          <li key={w.id} className="flex justify-between">
            <span className="text-ink">{w.name}</span>
            <span className="tabular-nums text-muted">{Math.round(w.value * 100)}/100</span>
          </li>
        ))}
      </ul>
      <MoreLink href="/traffic" label="Full traffic analytics (thousands of vehicles, CV, forecast)" />
    </div>
  );
}

const SCENARIOS: { id: ScenarioKind3; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "fire", label: "Building fire", icon: Flame },
  { id: "flood", label: "River flood", icon: Droplets },
  { id: "accident", label: "Road accident", icon: Car },
  { id: "gas", label: "Gas leak", icon: Factory },
  { id: "earthquake", label: "Earthquake", icon: Activity },
  { id: "evacuation", label: "Evacuation", icon: Users },
];

function EmergencyMode() {
  const h = useCity3D()!;
  const sc = h.scenarios;
  const [level, setLevel] = useState(2);
  const { pushAlert } = useCity();
  const { toast } = useToast();
  const st = sc.status;
  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => sc.start(s.id, { level })}
            className={cn("flex flex-col items-center gap-1 rounded-control border px-1 py-2 text-[11px] transition-colors", sc.active === s.id ? "border-danger bg-danger-soft text-danger" : "border-black/10 text-ink hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5")}
          >
            <s.icon className="h-4 w-4" />
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Segmented ariaLabel="Severity" value={String(level)} onChange={(v) => setLevel(Number(v))} options={[{ id: "1", label: "Minor" }, { id: "2", label: "Major" }, { id: "3", label: "Severe" }]} />
        {sc.active ? (
          <Button size="sm" variant="secondary" onClick={() => sc.stop()}>
            <Square className="h-3.5 w-3.5" /> Stop
          </Button>
        ) : null}
      </div>
      {sc.active === "gas" || sc.active === "fire" ? (
        <div className="mt-2">
          <label className="text-[12px] text-muted" htmlFor="wind3d">
            Wind from {Math.round(sc.windFrom)}°
          </label>
          <input id="wind3d" type="range" min={0} max={359} defaultValue={sc.windFrom} onChange={(e) => (sc.windFrom = Number(e.target.value))} className="w-full" />
        </div>
      ) : null}
      {st ? (
        <div className="mt-3">
          <p className="text-[14px] font-semibold text-ink">{st.title}</p>
          <p className="text-[12px] text-muted">
            {st.phase} · T+{Math.floor(st.elapsed / 60)}:{String(Math.floor(st.elapsed % 60)).padStart(2, "0")}
          </p>
          <div className="mt-2 grid grid-cols-1 gap-1.5">
            {st.metrics.map((m) => (
              <div key={m.label} className="flex justify-between text-[12px]">
                <span className="text-muted">{m.label}</span>
                <span className={cn("font-medium tabular-nums", m.tone === "bad" ? "text-danger" : m.tone === "warn" ? "text-warning" : m.tone === "good" ? "text-success" : "text-ink")}>{m.value}</span>
              </div>
            ))}
          </div>
          {st.units.length ? (
            <>
              <p className="eyebrow mb-1 mt-3">Responders</p>
              <ul className="space-y-1 text-[12px]">
                {st.units.map((u, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-ink">{u.label}</span>
                    <span className="text-muted">{u.status}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="eyebrow mb-1 mt-3">Log</p>
          <ul className="space-y-1 text-[12px] text-ink">
            {st.log.map((l, i) => (
              <li key={i}>
                <span className="tabular-nums text-muted">+{Math.floor(l.t / 60)}m </span>
                {l.text}
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded-control bg-black/[0.04] px-2.5 py-2 text-[12px] text-ink dark:bg-white/5">{st.advice}</p>
          <Button
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              pushAlert({ severity: st.kind === "accident" ? "warning" : "critical", source: "emergency", title: st.title, body: `${st.phase}. ${st.advice}`, public: true });
              toast({ tone: "success", title: "Broadcast sent", description: "Shown in the Citizen app's alerts." });
            }}
          >
            <Megaphone className="h-4 w-4" /> Broadcast to citizens
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-muted">Pick a scenario. Responders drive the real roads, signals turn green ahead of them, and flooded or blocked roads close in the traffic model.</p>
      )}
      <MoreLink href="/emergency" label="Detailed scenario models and timelines" />
    </div>
  );
}

function CctvMode() {
  const now = useNow(1000);
  useEffect(() => startSurveillance(), []);
  const events = eventLog.slice(0, 6);
  return (
    <div>
      <p className="eyebrow mb-1">Junction cameras</p>
      <FlyList items={CCTV_NODES.map((c) => ({ id: String(c.node), label: c.name, sub: "Vehicle counting · congestion", x: ROAD_NODES[c.node][0], z: ROAD_NODES[c.node][1] }))} />
      <p className="eyebrow mb-1 mt-4">Analytics events</p>
      <ul className="space-y-1.5">
        {events.length === 0 ? <li className="text-[12px] text-muted">Waiting for events…</li> : null}
        {events.map((e) => (
          <li key={e.id} className="text-[12px]">
            <span className={cn("mr-1.5 inline-block h-2 w-2 rounded-full", e.severity === "critical" ? "bg-danger" : e.severity === "warning" ? "bg-warning" : "bg-info")} />
            <span className="text-ink">{e.title}</span>
            <span className="text-muted"> · {SCENES.find((s) => s.id === e.camera)?.name} · {formatAgo(e.ts, now)}</span>
          </li>
        ))}
      </ul>
      <MoreLink href="/surveillance" label="Open the camera wall" />
    </div>
  );
}

function AirMode() {
  const now = useNow(5000);
  const hour = new Date(now).getHours() + new Date(now).getMinutes() / 60;
  const rs = STATIONS.map((st) => ({ st, r: stationReading(st, 0, hour) })).sort((a, b) => b.r.aqi - a.r.aqi);
  const avg = Math.round(rs.reduce((a, x) => a + x.r.aqi, 0) / rs.length);
  const band = aqiBand(avg);
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-full text-[18px] font-semibold" style={{ background: band.color, color: avg > 100 && avg <= 300 ? "#1a1a1a" : "#fff" }}>
          {avg}
        </span>
        <div>
          <p className="text-[14px] font-semibold text-ink">City AQI · {band.label}</p>
          <p className="text-[12px] leading-5 text-muted">{band.advice}</p>
        </div>
      </div>
      <p className="mt-3 text-[12px] text-muted">Pillars over the city show each monitoring site — taller and redder is worse.</p>
      <ul className="mt-2 space-y-1 text-[12px]">
        {rs.slice(0, 8).map(({ st, r }) => (
          <li key={st.id} className="flex items-center justify-between">
            <span className="text-ink">{st.name.replace("CAAQMS ", "")}</span>
            <span className="rounded px-1.5 font-medium tabular-nums" style={{ background: aqiBand(r.aqi).color, color: r.aqi > 100 && r.aqi <= 300 ? "#1a1a1a" : "#fff" }}>
              {r.aqi}
            </span>
          </li>
        ))}
      </ul>
      <MoreLink href="/environment" label="PM2.5/PM10, noise, heat, green cover, ML forecast" />
    </div>
  );
}

function CitizenMode({ reporting, setReporting }: { reporting: string | null; setReporting: (r: null | "pothole" | "garbage" | "water") => void }) {
  const { complaints } = useCity();
  return (
    <div>
      <p className="text-[13px] text-ink">Report a problem by clicking where it is in the city.</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {(
          [
            ["pothole", "Pothole"],
            ["garbage", "Garbage"],
            ["water", "Water leak"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setReporting(id)}
            className={cn("rounded-control border px-2 py-2 text-[12px]", reporting === id ? "border-primary bg-primary-soft text-primary" : "border-black/10 text-ink hover:bg-black/5 dark:border-white/10")}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-muted">{complaints.length} complaints filed — track them in the Citizen app.</p>
      <p className="eyebrow mb-1 mt-4">Emergency services</p>
      <FlyList items={PLACES.filter((p) => ["hospital", "police", "fire", "shelter"].includes(p.kind)).map((p) => ({ id: p.id, label: p.name, sub: p.kind === "shelter" ? "Relief shelter" : p.kind === "hospital" ? "Hospital · 108" : p.kind === "police" ? "Police · 112" : "Fire · 101", x: p.x, z: p.z }))} />
      <MoreLink href="/citizen" label="Open the Citizen app" />
    </div>
  );
}
