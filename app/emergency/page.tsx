"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Car, Droplets, Factory, Flame, Megaphone, Pause, Play, RotateCcw, Route, Users } from "lucide-react";
import { CityMap, FieldImage, PoiMarker } from "@/components/map/CityMap";
import { Panel, Segmented, StatTile, Toggle } from "@/components/common/kit";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { EDGES, NODES, SECTORS, SOURCES, BLOCK, sectorLabel } from "@/lib/city/model";
import { FCOLS, FROWS, SCENARIO_META, runScenario, type ScenarioKind, type ScenarioParams, type Unit } from "@/lib/sim/emergency";
import { getSim } from "@/lib/sim/runtime";
import { useCity } from "@/lib/store/city-store";
import { cn, formatNumber } from "@/lib/utils";

const KINDS: { id: ScenarioKind; icon: React.ComponentType<{ className?: string }>; blurb: string }[] = [
  { id: "fire", icon: Flame, blurb: "Building fire, smoke plume, crews and evacuation of occupants" },
  { id: "flood", icon: Droplets, blurb: "Rainfall inundation over low-lying sectors, road closures, pumps" },
  { id: "accident", icon: Car, blurb: "Crash on a road link, lane closures, diversion, ambulances" },
  { id: "gas", icon: Factory, blurb: "Toxic chlorine release with wind-driven Gaussian plume and AEGL zones" },
  { id: "earthquake", icon: Activity, blurb: "Shaking intensity, building damage, casualties and USAR" },
  { id: "evacuation", icon: Users, blurb: "Zone evacuation to shelters, routes, clearance time" },
];

const UNIT_GLYPH: Record<Unit["kind"], { letter: string; color: string; label: string }> = {
  fire: { letter: "F", color: "var(--accent)", label: "Fire" },
  ambulance: { letter: "A", color: "var(--danger)", label: "Ambulance" },
  police: { letter: "P", color: "var(--info)", label: "Police" },
  hazmat: { letter: "H", color: "var(--warning)", label: "HAZMAT" },
  rescue: { letter: "R", color: "var(--primary)", label: "Rescue" },
  pump: { letter: "W", color: "var(--series-1)", label: "Pump" },
};

const SPEEDS = [10, 30, 60] as const;

function defaultsFor(kind: ScenarioKind): ScenarioParams {
  const meta = SCENARIO_META[kind];
  const s = SECTORS[meta.defaultSector];
  if (kind === "gas") return { kind, x: SOURCES[1].x, y: SOURCES[1].y, level: 2, windFrom: 120, windSpeed: 2.5 };
  if (kind === "accident") return { kind, x: s.x, y: s.cy, level: 2, windFrom: 315, windSpeed: 3 };
  return { kind, x: s.cx, y: s.cy, level: meta.levels[Math.min(1, meta.levels.length - 1)].value, windFrom: 315, windSpeed: 3 };
}

// Field colouring per hazard type.
const COLORS: Record<string, (v: number) => [number, number, number, number]> = {
  smoke: (v) => (v < 0.04 ? [0, 0, 0, 0] : [128, 128, 128, Math.min(210, v * 320)]),
  water: (v) => (v <= 0 ? [0, 0, 0, 0] : [48, 120, 210, 90 + Math.min(150, v * 220)]),
  gas: (v) => (v <= 0 ? [0, 0, 0, 0] : v < 0.287 ? [236, 200, 40, 120] : v < 0.616 ? [240, 130, 40, 170] : [220, 50, 40, 200]),
  shaking: (v) => {
    const m = v * 10;
    if (m < 4) return [0, 0, 0, 0];
    const t = Math.min(1, (m - 4) / 5);
    return [230 - t * 60, 200 - t * 180, 60 - t * 40, 70 + t * 110];
  },
  zone: (v) => (v > 0 ? [220, 60, 50, 55] : [0, 0, 0, 0]),
};

export default function EmergencyPage() {
  const { toast } = useToast();
  const { pushAlert } = useCity();
  const [params, setParams] = useState<ScenarioParams>(() => defaultsFor("flood"));
  const [t, setT] = useState(8 * 60);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(30);
  const [applyToTraffic, setApplyToTraffic] = useState(true);
  const [broadcasted, setBroadcasted] = useState<string | null>(null);

  // Snap time so expensive fields recompute at most every 5 simulated seconds.
  const tKey = Math.floor(t / 5) * 5;
  const state = useMemo(() => runScenario(params, tKey), [params, tKey]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.2, (now - last) / 1000);
      last = now;
      setT((x) => {
        const next = x + dt * speed;
        return next >= state.duration ? state.duration : next;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, state.duration]);

  useEffect(() => {
    if (t >= state.duration && playing) setPlaying(false);
  }, [t, state.duration, playing]);

  // Push road closures into the live traffic simulation.
  const closureKey = state.closures.join(",");
  const appliedRef = useRef<number[]>([]);
  useEffect(() => {
    const sim = getSim();
    const next = applyToTraffic ? state.closures : [];
    const prev = appliedRef.current;
    const changed = next.length !== prev.length || next.some((id, i) => id !== prev[i]);
    if (!changed) return;
    prev.forEach((id) => (sim.blocked[id] = 0));
    next.forEach((id) => (sim.blocked[id] = 1));
    sim.recomputeRoutes();
    appliedRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closureKey, applyToTraffic]);
  useEffect(
    () => () => {
      const sim = getSim();
      appliedRef.current.forEach((id) => (sim.blocked[id] = 0));
      sim.recomputeRoutes();
    },
    []
  );

  const choose = (kind: ScenarioKind) => {
    setParams(defaultsFor(kind));
    setT(0);
    setPlaying(true);
    setBroadcasted(null);
  };

  const onMapClick = useCallback(
    (x: number, y: number) => {
      setParams((p) => {
        if (p.kind === "gas") {
          // Leaks start at an industrial source.
          const src = [...SOURCES].filter((s) => s.kind === "industrial").sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
          return { ...p, x: src.x, y: src.y };
        }
        return { ...p, x, y };
      });
      setT(0);
      setPlaying(true);
      setBroadcasted(null);
    },
    []
  );

  const broadcast = () => {
    const worst = state.zones[0];
    pushAlert({
      severity: params.kind === "evacuation" || params.kind === "gas" || params.kind === "earthquake" ? "critical" : "warning",
      source: "emergency",
      title: state.title,
      body: `${state.summary}. ${state.advice}${worst ? ` ${worst.label}.` : ""}`,
      sector: SECTORS.find((s) => params.x >= s.x && params.x < s.x + BLOCK && params.y >= s.y && params.y < s.y + BLOCK)?.id,
      public: true,
    });
    setBroadcasted(state.title);
    toast({ tone: "success", title: "Alert broadcast to citizens", description: "Sent to the citizen app, sirens and cell broadcast (simulated)." });
  };

  const meta = SCENARIO_META[params.kind];
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60);

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4 pb-5 pt-7">
        <div className="max-w-[720px]">
          <h1 className="text-[28px] leading-9 text-ink">Emergency simulation</h1>
          <p className="mt-1.5 text-[14px] leading-6 text-muted">
            Run a disaster on the city, watch it unfold on a timeline, see who is affected and which units respond. Click the map to move the incident.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" role="radiogroup" aria-label="Scenario">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={params.kind === k.id}
            onClick={() => choose(k.id)}
            className={cn(
              "rounded-card border px-3 py-2.5 text-left transition-colors",
              params.kind === k.id ? "border-primary bg-primary-soft" : "border-hair bg-surface hover:border-hair-strong"
            )}
          >
            <span className={cn("flex items-center gap-2 text-[13px] font-medium", params.kind === k.id ? "text-primary" : "text-ink")}>
              <k.icon className="h-4 w-4" />
              {SCENARIO_META[k.id].label}
            </span>
            <span className="mt-0.5 block text-[11px] leading-4 text-muted">{k.blurb}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <Panel
            title={state.title}
            description={state.summary}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {playing ? "Pause" : "Play"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => (setT(0), setPlaying(true))}>
                  <RotateCcw className="h-3.5 w-3.5" /> Restart
                </Button>
                <Segmented ariaLabel="Timeline speed" value={String(speed)} onChange={(v) => setSpeed(Number(v) as (typeof SPEEDS)[number])} options={SPEEDS.map((s) => ({ id: String(s), label: `${s}×` }))} />
              </div>
            }
            bodyClassName="p-2"
          >
            <CityMap onMapClick={onMapClick} cursor="crosshair" showPois={["hospital", "fire", "police", "shelter"]} dimSectors ariaLabel={`${state.title} map`}
              under={state.field && state.fieldKind ? <FieldImage field={state.field} cols={FCOLS} rows={FROWS} color={COLORS[state.fieldKind]} opacity={0.85} /> : null}
            >
              {state.affected.slice(0, 12).map((a) => {
                const s = SECTORS[a.sector];
                return <rect key={a.sector} x={s.x + 7} y={s.y + 7} width={BLOCK - 14} height={BLOCK - 14} rx={7} fill="none" stroke="var(--danger)" strokeOpacity={0.3 + a.level * 0.6} strokeWidth={1.5} strokeDasharray="5 4" />;
              })}
              {state.closures.map((id) => {
                const e = EDGES[id];
                const a = NODES[e.from];
                const b = NODES[e.to];
                return <line key={id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--danger)" strokeWidth={5} strokeLinecap="round" strokeDasharray="2 6" />;
              })}
              {state.diversion?.length ? (
                <polyline points={state.diversion.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--primary)" strokeWidth={4} strokeDasharray="10 6" strokeLinejoin="round" opacity={0.9} />
              ) : null}
              {state.evac?.flows.map((f, i) => (
                <g key={i}>
                  <polyline points={f.path.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--success)" strokeOpacity={0.55} strokeWidth={1.5 + Math.min(5, f.people / 1500)} strokeLinejoin="round" />
                  <FlowDots path={f.path} active={f.departed > f.arrived} t={t} />
                </g>
              ))}
              {params.kind === "gas" || params.kind === "fire" ? <WindArrow from={params.windFrom} speed={params.windSpeed} /> : null}
              {state.units.map((u) => (
                <g key={u.id}>
                  {u.status !== "On scene" ? <polyline points={u.path.map((p) => p.join(",")).join(" ")} fill="none" stroke={UNIT_GLYPH[u.kind].color} strokeWidth={1.5} strokeDasharray="3 4" opacity={0.6} /> : null}
                  <g transform={`translate(${u.x},${u.y})`}>
                    <title>{`${u.label} · ${u.from} · ${u.status}`}</title>
                    <circle r={8} fill={UNIT_GLYPH[u.kind].color} stroke="var(--surface)" strokeWidth={2} />
                    <text y={3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--surface)">
                      {UNIT_GLYPH[u.kind].letter}
                    </text>
                  </g>
                </g>
              ))}
              <IncidentMarker x={params.x} y={params.y} />
            </CityMap>
            <div className="flex items-center gap-3 px-2 pb-1 pt-3">
              <span className="w-20 shrink-0 text-[13px] font-semibold tabular-nums text-ink">
                T+{String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
              </span>
              <input
                type="range"
                min={0}
                max={state.duration}
                step={5}
                value={Math.round(t)}
                onChange={(e) => {
                  setT(Number(e.target.value));
                  setPlaying(false);
                }}
                className="w-full"
                aria-label="Scenario timeline"
              />
              <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-muted">{Math.round(state.duration / 60)} min</span>
            </div>
            <MapLegend kind={state.fieldKind} />
          </Panel>

          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Incident log">
              <ol className="space-y-2.5">
                {state.log.map((l, i) => (
                  <li key={i} className="flex gap-3 text-[13px]">
                    <span className="w-12 shrink-0 tabular-nums text-muted">+{Math.floor(l.t / 60)}:{String(Math.floor(l.t % 60)).padStart(2, "0")}</span>
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", l.severity === "critical" ? "bg-danger" : l.severity === "warning" ? "bg-warning" : "bg-info")} aria-hidden="true" />
                    <span className="text-ink">{l.text}</span>
                  </li>
                ))}
              </ol>
            </Panel>
            <Panel title="Affected sectors" description={state.affected.length ? `${state.affected.length} sector(s)` : undefined}>
              {state.affected.length ? (
                <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {state.affected.slice(0, 14).map((a) => (
                    <li key={a.sector} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="truncate text-ink">{sectorLabel(SECTORS[a.sector])}</span>
                      <span className="shrink-0 text-[12px] tabular-nums text-muted">{a.note}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted">{params.kind === "accident" ? "Localised incident — see diversion on the map." : "No sector affected yet."}</p>
              )}
            </Panel>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel title="Scenario settings">
            <label className="mb-1.5 block text-[13px] font-medium text-ink" htmlFor="lvl">
              {meta.levelLabel}
            </label>
            <Select id="lvl" value={params.level} onChange={(e) => (setParams((p) => ({ ...p, level: Number(e.target.value) })), setT(0), setPlaying(true))}>
              {meta.levels.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
            {params.kind === "gas" || params.kind === "fire" ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] text-muted" htmlFor="wd">
                    Wind from {Math.round(params.windFrom)}° ({compass(params.windFrom)})
                  </label>
                  <input id="wd" type="range" min={0} max={359} value={params.windFrom} onChange={(e) => setParams((p) => ({ ...p, windFrom: Number(e.target.value) }))} className="w-full" />
                </div>
                <div>
                  <label className="block text-[12px] text-muted" htmlFor="ws">
                    Wind speed {params.windSpeed.toFixed(1)} m/s
                  </label>
                  <input id="ws" type="range" min={0.8} max={8} step={0.1} value={params.windSpeed} onChange={(e) => setParams((p) => ({ ...p, windSpeed: Number(e.target.value) }))} className="w-full" />
                </div>
              </div>
            ) : null}
            {params.kind === "flood" || params.kind === "accident" ? (
              <Toggle checked={applyToTraffic} onChange={setApplyToTraffic} label="Apply closures to live traffic" hint="Closed roads are blocked in the traffic simulation and drivers re-route." />
            ) : null}
            <p className="mt-2 text-[12px] text-muted">Incident at {sectorLabel(SECTORS.find((s) => params.x >= s.x && params.x < s.x + BLOCK && params.y >= s.y && params.y < s.y + BLOCK) ?? SECTORS[0])}. Click the map to move it.</p>
          </Panel>

          <div className="grid grid-cols-2 gap-2">
            {state.metrics.map((m) => (
              <StatTile key={m.label} label={m.label} value={m.value} tone={m.tone === "good" ? "good" : m.tone === "warn" ? "warn" : m.tone === "bad" ? "bad" : "default"} className="px-3 py-2.5 [&_span.font-display]:text-[20px]" />
            ))}
          </div>

          {state.zones.length ? (
            <Panel title="Hazard zones">
              <ul className="space-y-2">
                {state.zones.map((z) => (
                  <li key={z.label} className="flex items-start justify-between gap-3 text-[13px]">
                    <span className="flex items-start gap-2">
                      <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px]", z.tone === "critical" ? "bg-danger" : z.tone === "warning" ? "bg-warning" : "bg-info")} aria-hidden="true" />
                      <span className="text-ink">{z.label}</span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums text-muted">
                      {formatNumber(z.population)} people
                      <span className="block text-[11px]">{z.areaKm2.toFixed(2)} km²</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {state.evac ? (
            <Panel title="Shelters">
              <ul className="space-y-2.5">
                {state.evac.shelters
                  .filter((s) => s.assigned > 0)
                  .map((s) => (
                    <li key={s.name}>
                      <div className="flex justify-between text-[13px]">
                        <span className="text-ink">{s.name}</span>
                        <span className="tabular-nums text-muted">
                          {formatNumber(s.arrived)} / {formatNumber(s.capacity)}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                        <div className="h-full bg-success" style={{ width: `${Math.min(100, (s.arrived / s.capacity) * 100)}%` }} />
                      </div>
                    </li>
                  ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title={<span className="inline-flex items-center gap-2"><Route className="h-4 w-4 text-muted" /> Responding units</span>}>
            <ul className="space-y-2">
              {state.units.map((u) => (
                <li key={u.id} className="flex items-center gap-3 text-[13px]">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold text-surface" style={{ background: UNIT_GLYPH[u.kind].color }} aria-hidden="true">
                    {UNIT_GLYPH[u.kind].letter}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{u.label}</span>
                    <span className="block truncate text-[11px] text-muted">{u.from}</span>
                  </span>
                  <span className="shrink-0 text-right text-[12px] text-muted">
                    {u.status}
                    <span className="block tabular-nums">{u.status === "On scene" ? `at +${Math.round(u.arriveAt / 60)} min` : `ETA ${Math.max(0, Math.ceil((u.arriveAt - t) / 60))} min`}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title={<span className="inline-flex items-center gap-2"><Megaphone className="h-4 w-4 text-muted" /> Public warning</span>}>
            <p className="text-[13px] leading-5 text-ink">{state.advice}</p>
            <Button className="mt-3 w-full" variant={broadcasted === state.title ? "secondary" : "primary"} onClick={broadcast}>
              <Megaphone className="h-4 w-4" />
              {broadcasted === state.title ? "Broadcast again" : "Broadcast to citizens"}
            </Button>
            <p className="mt-2 text-[12px] text-muted">Appears in the citizen app&apos;s alerts and the alerts bell.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function compass(deg: number) {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

function IncidentMarker({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`} style={{ pointerEvents: "none" }}>
      <circle r={16} fill="var(--danger)" opacity={0.18}>
        <animate attributeName="r" values="10;22;10" dur="2s" repeatCount="indefinite" />
      </circle>
      <path d="M0,-11 L10,7 L-10,7 Z" fill="var(--danger)" stroke="var(--surface)" strokeWidth={2} strokeLinejoin="round" />
      <text y={5} textAnchor="middle" fontSize={10} fontWeight={800} fill="var(--surface)">
        !
      </text>
    </g>
  );
}

function WindArrow({ from, speed }: { from: number; speed: number }) {
  const to = from + 180;
  return (
    <g transform={`translate(985,58)`}>
      <circle r={26} fill="var(--surface)" opacity={0.85} stroke="var(--hair-strong)" />
      <g transform={`rotate(${to})`}>
        <path d="M0,16 L0,-14 M-6,-6 L0,-15 L6,-6" stroke="var(--ink)" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text y={42} textAnchor="middle" fontSize={11} fill="var(--muted)">
        wind {speed.toFixed(1)} m/s
      </text>
    </g>
  );
}

function FlowDots({ path, active, t }: { path: [number, number][]; active: boolean; t: number }) {
  if (!active || path.length < 2) return null;
  let len = 0;
  const segs = path.slice(1).map((p, i) => {
    const d = Math.hypot(p[0] - path[i][0], p[1] - path[i][1]);
    len += d;
    return d;
  });
  const pos = (d: number) => {
    let r = d;
    for (let i = 0; i < segs.length; i++) {
      if (r <= segs[i]) {
        const f = segs[i] ? r / segs[i] : 0;
        return [path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f];
      }
      r -= segs[i];
    }
    return path[path.length - 1];
  };
  const n = 4;
  return (
    <>
      {Array.from({ length: n }, (_, k) => {
        const d = ((t * 6 + (k * len) / n) % len + len) % len;
        const [x, y] = pos(d);
        return <circle key={k} cx={x} cy={y} r={3} fill="var(--success)" />;
      })}
    </>
  );
}

function MapLegend({ kind }: { kind?: string }) {
  const items: { label: string; color: string }[] =
    kind === "gas"
      ? [
          { label: "> 20 ppm", color: "rgb(220,50,40)" },
          { label: "2.8–20 ppm", color: "rgb(240,130,40)" },
          { label: "0.5–2.8 ppm", color: "rgb(236,200,40)" },
        ]
      : kind === "water"
        ? [{ label: "Flood water (darker = deeper)", color: "rgb(48,120,210)" }]
        : kind === "shaking"
          ? [
              { label: "MMI V–VI", color: "rgb(222,180,55)" },
              { label: "MMI VII", color: "rgb(205,120,40)" },
              { label: "MMI VIII+", color: "rgb(175,40,25)" },
            ]
          : kind === "smoke"
            ? [{ label: "Smoke plume", color: "rgb(128,128,128)" }]
            : kind === "zone"
              ? [{ label: "Evacuation zone", color: "rgb(220,60,50)" }, { label: "Evacuation routes", color: "var(--success)" }]
              : [{ label: "Closed road", color: "var(--danger)" }, { label: "Diversion", color: "var(--primary)" }];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-2 text-[12px] text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-2">
        {(["hospital", "fire", "police", "shelter"] as const).map((k) => (
          <svg key={k} width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true">
            <PoiMarker kind={k} x={0} y={0} size={13} />
          </svg>
        ))}
        Hospital · Fire · Police · Shelter
      </span>
    </div>
  );
}
