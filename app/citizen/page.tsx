"use client";

import React, { useMemo, useRef, useState } from "react";
import { Bell, Bus, Camera, Check, Construction, Droplets, Flame, Hospital, MapPin, Navigation, Phone, Shield, Star, Trash2, X } from "lucide-react";
import { CityMap, PoiMarker } from "@/components/map/CityMap";
import { FlowChip, Panel, Segmented } from "@/components/common/kit";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { BUS_ROUTES, EDGES, NODES, POIS, POI_LABEL, SECTORS, METRES_PER_UNIT, edgeBetween, nearestNode, sectorAt, sectorLabel, shortestPath, type PoiKind } from "@/lib/city/model";
import { edgeLabel } from "@/lib/city/labels";
import { useSim } from "@/lib/sim/runtime";
import type { TrafficSim } from "@/lib/sim/traffic";
import { STATIONS, aqiBand, liveTrafficAt, stationReading } from "@/lib/sim/environment";
import { CATEGORY_META, STAGES, complaintStage, useCity, useNow, type Complaint, type ComplaintCategory } from "@/lib/store/city-store";
import { clockLabel, cn, formatAgo } from "@/lib/utils";

type Tab = "report" | "complaints" | "live" | "nearby" | "transport" | "alerts";

const HOME = SECTORS[10]; // the demo citizen lives in Sector 11

const CAT_ICON: Record<ComplaintCategory, React.ComponentType<{ className?: string }>> = { pothole: Construction, garbage: Trash2, water: Droplets };

export default function CitizenPage() {
  const { complaints, alerts } = useCity();
  const [tab, setTab] = useState<Tab>("report");
  const [home, setHome] = useState<{ x: number; y: number }>({ x: HOME.cx, y: HOME.cy });
  const publicAlerts = alerts.filter((a) => a.public);
  const now = useNow(2000);
  const open = complaints.filter((c) => complaintStage(c, now).stage !== "resolved").length;

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4 pb-2 pt-7">
        <div className="max-w-[760px]">
          <h1 className="text-[28px] leading-9 text-ink">Citizen app</h1>
          <p className="mt-1.5 text-[14px] leading-6 text-muted">
            What a resident sees: report civic issues and track them to resolution, check traffic and air near home, find emergency services and buses, and receive alerts.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-control border border-hair bg-surface px-3 py-2 text-[13px] text-muted">
          <MapPin className="h-4 w-4 text-primary" />
          Home: <span className="font-medium text-ink">{sectorLabel(sectorAt(home.x, home.y) ?? HOME)}</span>
        </span>
      </header>
      <Tabs<Tab>
        ariaLabel="Citizen app sections"
        value={tab}
        onChange={setTab}
        items={[
          { id: "report", label: "Report an issue" },
          { id: "complaints", label: "My complaints", count: open },
          { id: "live", label: "Traffic & air" },
          { id: "nearby", label: "Nearby services" },
          { id: "transport", label: "Buses" },
          { id: "alerts", label: "Alerts", count: publicAlerts.length },
        ]}
      />
      <div className="pt-5">
        {tab === "report" ? <ReportTab onDone={() => setTab("complaints")} home={home} /> : null}
        {tab === "complaints" ? <ComplaintsTab /> : null}
        {tab === "live" ? <LiveTab home={home} /> : null}
        {tab === "nearby" ? <NearbyTab home={home} setHome={setHome} /> : null}
        {tab === "transport" ? <TransportTab home={home} /> : null}
        {tab === "alerts" ? <AlertsTab /> : null}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- report */

function ReportTab({ onDone, home }: { onDone: () => void; home: { x: number; y: number } }) {
  const { addComplaint, complaints } = useCity();
  const { toast } = useToast();
  const [cat, setCat] = useState<ComplaintCategory>("pothole");
  const [desc, setDesc] = useState("");
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [photo, setPhoto] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPhoto = (f: File | undefined) => {
    if (!f) return;
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, 360 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      setPhoto(c.toDataURL("image/jpeg", 0.72));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const submit = () => {
    if (!pin) return setError("Tap the map to mark where the problem is.");
    if (desc.trim().length < 8) return setError("Add a short description (at least 8 characters).");
    const s = sectorAt(pin.x, pin.y);
    const c = addComplaint({ category: cat, description: desc.trim(), x: pin.x, y: pin.y, sector: s?.id ?? 0, photo, reporter: "You" });
    toast({ tone: "success", title: `Complaint ${c.id} registered`, description: `Routed to ${CATEGORY_META[cat].department}. SLA ${CATEGORY_META[cat].slaHours} h.` });
    setDesc("");
    setPin(null);
    setPhoto(undefined);
    setError(null);
    onDone();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <Panel title="Where is it?" description="Tap the map to drop a pin. Existing reports are shown so you don't file a duplicate." bodyClassName="p-2">
        <CityMap onMapClick={(x, y) => (setPin({ x, y }), setError(null))} cursor="crosshair" dimSectors>
          {complaints.map((c) => (
            <g key={c.id} transform={`translate(${c.x},${c.y})`} opacity={0.75}>
              <title>{`${c.id} · ${CATEGORY_META[c.category].label}`}</title>
              <circle r={6} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          ))}
          <g transform={`translate(${home.x},${home.y})`}>
            <circle r={5} fill="var(--primary)" opacity={0.5} />
          </g>
          {pin ? (
            <g transform={`translate(${pin.x},${pin.y})`}>
              <path d="M0,0 C-10,-14 -10,-26 0,-28 C10,-26 10,-14 0,0 Z" fill="var(--danger)" stroke="var(--surface)" strokeWidth={2} />
              <circle cy={-19} r={4} fill="var(--surface)" />
            </g>
          ) : null}
        </CityMap>
      </Panel>
      <Panel title="Report an issue">
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink">What kind of problem?</legend>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(CATEGORY_META) as ComplaintCategory[]).map((k) => {
              const Icon = CAT_ICON[k];
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={cat === k}
                  onClick={() => setCat(k)}
                  className={cn("flex flex-col items-center gap-1.5 rounded-card border px-2 py-3 text-[12px] transition-colors", cat === k ? "border-primary bg-primary-soft font-medium text-primary" : "border-hair text-ink hover:border-hair-strong")}
                >
                  <Icon className="h-5 w-5" />
                  {CATEGORY_META[k].label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="mt-4 block text-[13px] font-medium text-ink" htmlFor="desc">
          Description
        </label>
        <textarea
          id="desc"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={3}
          placeholder={cat === "pothole" ? "e.g. Deep pothole in the left lane near the bus stop" : cat === "garbage" ? "e.g. Garbage heap at the park gate for 3 days" : "e.g. Pipe burst, water flowing on the road"}
          className="mt-1.5 w-full rounded-control border border-hair-control bg-field px-3 py-2 text-[14px] text-ink placeholder:text-muted"
        />
        <div className="mt-3 flex items-center gap-3">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
            <Camera className="h-3.5 w-3.5" /> {photo ? "Change photo" : "Add photo"}
          </Button>
          {photo ? (
            <span className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="Attached" className="h-12 w-16 rounded-[6px] object-cover" />
              <button type="button" aria-label="Remove photo" onClick={() => setPhoto(undefined)} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-canvas">
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <span className="text-[12px] text-muted">Optional, helps the crew find it</span>
          )}
        </div>
        <div className="mt-4 rounded-control bg-sunken px-3 py-2 text-[12px] leading-5 text-muted">
          {pin ? (
            <>
              Location: <span className="text-ink">{sectorLabel(sectorAt(pin.x, pin.y) ?? HOME)}</span>
            </>
          ) : (
            "No location yet — tap the map."
          )}
          <br />
          Routed to <span className="text-ink">{CATEGORY_META[cat].department}</span> · resolution target {CATEGORY_META[cat].slaHours} h
        </div>
        {error ? <p className="mt-2 text-[12px] font-medium text-danger">{error}</p> : null}
        <Button className="mt-4 w-full" onClick={submit}>
          Submit report
        </Button>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------- complaints */

function ComplaintsTab() {
  const { complaints, rateComplaint } = useCity();
  const now = useNow(1000);
  if (!complaints.length) return <p className="text-[13px] text-muted">No complaints yet.</p>;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {complaints.map((c) => (
        <ComplaintCard key={c.id} c={c} now={now} onRate={(r) => rateComplaint(c.id, r)} />
      ))}
    </div>
  );
}

function ComplaintCard({ c, now, onRate }: { c: Complaint; now: number; onRate: (r: number) => void }) {
  const { index } = complaintStage(c, now);
  const Icon = CAT_ICON[c.category];
  const meta = CATEGORY_META[c.category];
  const resolved = index === 3;
  return (
    <article className="rounded-card border border-hair bg-surface p-4">
      <div className="flex items-start gap-3">
        {c.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.photo} alt="" className="h-14 w-16 shrink-0 rounded-[6px] object-cover" />
        ) : (
          <span className="grid h-14 w-16 shrink-0 place-items-center rounded-[6px] bg-surface-raised text-muted">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[14px] font-semibold text-ink">
              {meta.label} · <span className="font-mono text-[12px] font-medium text-muted">{c.id}</span>
            </p>
            <span className={cn("rounded-full px-2.5 text-[12px] font-medium leading-6", resolved ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>{STAGES[index].label}</span>
          </div>
          <p className="mt-0.5 text-[13px] leading-5 text-ink">{c.description}</p>
          <p className="mt-0.5 text-[12px] text-muted">
            {sectorLabel(SECTORS[c.sector])} · {meta.department} · filed {formatAgo(c.ts, now)}
          </p>
        </div>
      </div>
      <ol className="mt-4 grid grid-cols-4 gap-1" aria-label="Progress">
        {STAGES.map((s, i) => (
          <li key={s.id} className="min-w-0">
            <div className={cn("h-1.5 rounded-full", i <= index ? (resolved ? "bg-success" : "bg-primary") : "bg-hair")} />
            <p className={cn("mt-1.5 flex items-center gap-1 truncate text-[11px]", i <= index ? "text-ink" : "text-muted")}>
              {i <= index ? <Check className="h-3 w-3 shrink-0" /> : null}
              {s.label}
            </p>
            {i > 0 && i <= index ? <p className="text-[10px] text-muted">{formatAgo(c.ts + c.schedule[i - 1] * 1000, now)}</p> : null}
          </li>
        ))}
      </ol>
      {resolved ? (
        <div className="mt-3 flex items-center justify-between border-t border-hair pt-3">
          <span className="text-[12px] text-muted">{c.rating ? "Thanks for the feedback" : "How was the fix?"}</span>
          <span className="flex gap-0.5" role="radiogroup" aria-label="Rate the resolution">
            {[1, 2, 3, 4, 5].map((r) => (
              <button key={r} type="button" role="radio" aria-checked={c.rating === r} aria-label={`${r} star${r > 1 ? "s" : ""}`} onClick={() => onRate(r)} className="p-0.5">
                <Star className={cn("h-4 w-4", (c.rating ?? 0) >= r ? "fill-warning text-warning" : "text-muted")} />
              </button>
            ))}
          </span>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-muted">
          {index === 0 ? "Waiting for assignment to a field crew." : index === 1 ? "A crew has been assigned and is on the way." : "Crew on site — work in progress."} Demo clock runs fast.
        </p>
      )}
    </article>
  );
}

/* ---------------------------------------------------------- traffic & air */

function routeTime(sim: TrafficSim, from: number, to: number) {
  const p = shortestPath(from, to, (e) => (sim.blocked[e.id] ? Infinity : sim.travelTime[e.id]));
  if (!p) return null;
  const live = p.reduce((a, id) => a + sim.travelTime[id], 0) + p.length * 6;
  const free = p.reduce((a, id) => a + EDGES[id].length / (EDGES[id].arterial ? 2.8 : 2.2), 0) + p.length * 6;
  const km = (p.reduce((a, id) => a + EDGES[id].length, 0) * METRES_PER_UNIT) / 1000;
  return { path: p, live, free, km };
}

function LiveTab({ home }: { home: { x: number; y: number } }) {
  const { sim } = useSim();
  const [dest, setDest] = useState(SECTORS[27].id);
  const station = [...STATIONS].sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[0];
  const hour = (sim.t / 3600) % 24;
  const minuteKey = Math.floor(sim.t / 60);
  const reading = useMemo(() => stationReading(station, 0, hour, liveTrafficAt(sim, station.x, station.y)), [station.id, minuteKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const band = aqiBand(reading.aqi);
  const hn = nearestNode(home.x, home.y);
  const nearRoads = EDGES.filter((e) => Math.hypot((NODES[e.from].x + NODES[e.to].x) / 2 - home.x, (NODES[e.from].y + NODES[e.to].y) / 2 - home.y) < 110)
    .sort((a, b) => sim.congestion[b.id] - sim.congestion[a.id])
    .slice(0, 5);
  const trip = routeTime(sim, hn, nearestNode(SECTORS[dest].cx, SECTORS[dest].cy));
  const delay = trip ? trip.live - trip.free : 0;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Air near you" description={`${station.name} · updated ${clockLabel(sim.t)}`}>
        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full" style={{ background: band.color }}>
            <span className={cn("text-center text-[24px] font-semibold leading-none", reading.aqi > 100 && reading.aqi <= 300 ? "text-[#1a1a1a]" : "text-white")}>
              {reading.aqi}
              <span className="block text-[10px] font-medium">AQI</span>
            </span>
          </div>
          <div>
            <p className="text-[15px] font-semibold text-ink">{band.label}</p>
            <p className="text-[12px] leading-5 text-muted">{band.advice}</p>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-muted">
          PM2.5 {reading.pm25.toFixed(0)} µg/m³ · PM10 {reading.pm10.toFixed(0)} µg/m³ · wind {Math.round(reading.weather.windSpeed * 3.6)} km/h
        </p>
        {reading.aqi > 200 ? <p className="mt-2 rounded-control bg-warning-soft px-3 py-2 text-[12px] text-warning">Wear an N95 outdoors and keep children's outdoor play short today.</p> : null}
      </Panel>
      <Panel title="Roads around home">
        <ul className="space-y-2">
          {nearRoads.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="truncate text-ink">{edgeLabel(e.id)}</span>
              <FlowChip value={sim.congestion[e.id]} />
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Commute check">
        <label className="mb-1.5 block text-[12px] text-muted" htmlFor="dest">
          From home to
        </label>
        <Select id="dest" value={dest} onChange={(e) => setDest(Number(e.target.value))}>
          {SECTORS.filter((s) => s.use !== "water").map((s) => (
            <option key={s.id} value={s.id}>
              {sectorLabel(s)}
            </option>
          ))}
        </Select>
        {trip ? (
          <div className="mt-3">
            <p className="text-[26px] font-semibold tabular-nums text-ink">
              {Math.round(trip.live / 60)} min <span className="text-[13px] font-normal text-muted">· {trip.km.toFixed(1)} km</span>
            </p>
            <p className={cn("text-[12px]", delay > 120 ? "text-warning" : "text-muted")}>
              {delay > 60 ? `${Math.round(delay / 60)} min slower than free-flow` : "Roads are clear on this route"}
            </p>
            <p className="mt-2 text-[12px] text-muted">Via {[...new Set(trip.path.map((id) => EDGES[id].name))].slice(0, 3).join(" → ")}</p>
          </div>
        ) : (
          <p className="mt-3 text-[12px] text-danger">No open route right now.</p>
        )}
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------------- nearby */

const KIND_ICON: Record<PoiKind, React.ComponentType<{ className?: string }>> = { hospital: Hospital, police: Shield, fire: Flame, shelter: MapPin };

function NearbyTab({ home, setHome }: { home: { x: number; y: number }; setHome: (p: { x: number; y: number }) => void }) {
  const { sim } = useSim();
  const [kind, setKind] = useState<PoiKind | "all">("all");
  const [focus, setFocus] = useState<string | null>(null);
  const hn = nearestNode(home.x, home.y);
  const list = useMemo(
    () =>
      POIS.filter((p) => kind === "all" || p.kind === kind)
        .map((p) => {
          const r = routeTime(sim, hn, p.node);
          return { p, km: r?.km ?? 0, min: r ? r.live / 60 : Infinity, path: r?.path ?? [] };
        })
        .sort((a, b) => a.min - b.min),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, hn, Math.floor(sim.t / 30)]
  );
  const focused = list.find((l) => l.p.id === focus) ?? list[0];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <Panel title="Map" description="Tap the map to set your location. Travel times use live traffic." bodyClassName="p-2">
        <CityMap onMapClick={(x, y) => setHome({ x, y })} cursor="crosshair" showPois={kind === "all" ? ["hospital", "police", "fire", "shelter"] : [kind]} dimSectors>
          {focused?.path.length ? (
            <polyline points={[[home.x, home.y], ...[NODES[EDGES[focused.path[0]].from], ...focused.path.map((id) => NODES[EDGES[id].to])].map((n) => [n.x, n.y]), [focused.p.x, focused.p.y]].map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--primary)" strokeWidth={4} strokeLinejoin="round" strokeDasharray="8 5" />
          ) : null}
          {focused ? <PoiMarker kind={focused.p.kind} x={focused.p.x} y={focused.p.y} size={22} title={focused.p.name} /> : null}
          <g transform={`translate(${home.x},${home.y})`}>
            <circle r={14} fill="var(--primary)" opacity={0.2} />
            <circle r={6} fill="var(--primary)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        </CityMap>
      </Panel>
      <Panel
        title="Nearby emergency services"
        action={
          <Segmented
            ariaLabel="Service type"
            value={kind}
            onChange={setKind}
            options={[
              { id: "all", label: "All" },
              { id: "hospital", label: "Hospitals" },
              { id: "police", label: "Police" },
              { id: "fire", label: "Fire" },
              { id: "shelter", label: "Shelters" },
            ]}
          />
        }
        bodyClassName="p-0"
      >
        <ul className="divide-y divide-hair">
          {list.map(({ p, km, min }) => {
            const Icon = KIND_ICON[p.kind];
            return (
              <li key={p.id}>
                <button type="button" onClick={() => setFocus(p.id)} className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-raised", focused?.p.id === p.id && "bg-surface-raised")}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-raised text-muted">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{p.name}</span>
                    <span className="block text-[12px] text-muted">
                      {POI_LABEL[p.kind]} · {km.toFixed(1)} km · {Number.isFinite(min) ? `${Math.max(1, Math.round(min))} min by road` : "route closed"}
                    </span>
                  </span>
                  <a href={`tel:${p.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex shrink-0 items-center gap-1 rounded-control border border-hair px-2 py-1 text-[12px] text-ink hover:border-hair-strong">
                    <Phone className="h-3 w-3" /> {p.phone}
                  </a>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-hair px-4 py-2.5 text-[12px] text-muted">Emergency: 112 · Ambulance 108 · Fire 101 · Disaster helpline 1078</p>
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------- transport */

const ROUTE_COLOR = { "series-1": "var(--series-1)", "series-2": "var(--series-2)", "series-3": "var(--series-3)" } as const;

function busState(sim: TrafficSim, routeId: string) {
  const r = BUS_ROUTES.find((x) => x.id === routeId)!;
  const loop = [...r.nodes, ...r.nodes.slice(0, -1).reverse().slice(0, -1)];
  const legs: { from: number; to: number; t: number }[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const e = edgeBetween(a, b);
    const t = e ? sim.travelTime[e.id] * 1.15 + 25 : 60;
    legs.push({ from: a, to: b, t });
  }
  const cycle = legs.reduce((a, l) => a + l.t, 0);
  const n = Math.max(1, Math.round(cycle / (r.headwayMin * 60)));
  const buses = Array.from({ length: n }, (_, k) => {
    let phase = (sim.t + (k * cycle) / n) % cycle;
    let i = 0;
    while (phase > legs[i].t) {
      phase -= legs[i].t;
      i++;
    }
    const f = phase / legs[i].t;
    const A = NODES[legs[i].from];
    const B = NODES[legs[i].to];
    return { k, leg: i, x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, phaseAbs: (sim.t + (k * cycle) / n) % cycle };
  });
  const cum: number[] = [];
  legs.reduce((a, l, i) => ((cum[i] = a), a + l.t), 0);
  return { r, loop, legs, cycle, buses, cum };
}

function TransportTab({ home }: { home: { x: number; y: number } }) {
  const { sim } = useSim();
  const [route, setRoute] = useState(BUS_ROUTES[0].id);
  const states = BUS_ROUTES.map((r) => busState(sim, r.id));
  const st = states.find((s) => s.r.id === route)!;
  const stops = st.r.nodes;
  const nearestStop = [...stops].sort((a, b) => Math.hypot(NODES[a].x - home.x, NODES[a].y - home.y) - Math.hypot(NODES[b].x - home.x, NODES[b].y - home.y))[0];
  const [stop, setStop] = useState<number | null>(null);
  const sel = stop != null && stops.includes(stop) ? stop : nearestStop;
  const arrivals = useMemo(() => {
    const idxs = st.loop.map((n, i) => (n === sel ? i : -1)).filter((i) => i >= 0);
    const out: { mins: number; dir: string; occ: number }[] = [];
    for (const b of st.buses) {
      for (const i of idxs) {
        let wait = st.cum[i] - b.phaseAbs;
        if (wait < 0) wait += st.cycle;
        const dir = i < st.r.nodes.length ? `towards ${terminal(st.r.nodes[st.r.nodes.length - 1])}` : `towards ${terminal(st.r.nodes[0])}`;
        const occ = Math.min(0.98, 0.35 + 0.55 * Math.sin(((sim.t / 3600 - 6) / 14) * Math.PI) ** 2 + ((b.k * 13) % 7) / 40);
        out.push({ mins: wait / 60, dir, occ });
      }
    }
    return out.sort((a, b) => a.mins - b.mins).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, sel, Math.floor(sim.t / 10)]);
  const walkM = Math.round((Math.hypot(NODES[sel].x - home.x, NODES[sel].y - home.y) * METRES_PER_UNIT) / 10) * 10;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <Panel title="Live buses" description="Positions update with real traffic: buses slow down on congested roads." bodyClassName="p-2">
        <CityMap dimSectors showLabels={false} onMapClick={(x, y) => {
          const n = nearestNode(x, y);
          if (stops.includes(n)) setStop(n);
        }} cursor="pointer">
          {states.map((s) => (
            <g key={s.r.id} opacity={s.r.id === route ? 1 : 0.35}>
              <polyline points={s.r.nodes.map((n) => `${NODES[n].x},${NODES[n].y}`).join(" ")} fill="none" stroke={ROUTE_COLOR[s.r.color]} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
              {s.r.nodes.map((n) => (
                <circle key={n} cx={NODES[n].x} cy={NODES[n].y} r={n === sel && s.r.id === route ? 8 : 4.5} fill="var(--surface)" stroke={ROUTE_COLOR[s.r.color]} strokeWidth={2.5} />
              ))}
              {s.buses.map((b) => (
                <g key={b.k} transform={`translate(${b.x},${b.y})`}>
                  <rect x={-8} y={-6} width={16} height={12} rx={3} fill={ROUTE_COLOR[s.r.color]} stroke="var(--surface)" strokeWidth={1.5} />
                  <text y={3.5} textAnchor="middle" fontSize={8} fontWeight={700} fill="var(--surface)">
                    {s.r.id}
                  </text>
                </g>
              ))}
            </g>
          ))}
          <g transform={`translate(${home.x},${home.y})`}>
            <circle r={6} fill="var(--primary)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        </CityMap>
      </Panel>
      <div className="space-y-4">
        <Panel title="Routes" bodyClassName="p-2">
          <ul>
            {states.map((s) => (
              <li key={s.r.id}>
                <button type="button" onClick={() => (setRoute(s.r.id), setStop(null))} className={cn("flex w-full items-center gap-3 rounded-[6px] px-2 py-2 text-left hover:bg-surface-raised", route === s.r.id && "bg-surface-raised")}>
                  <span className="grid h-7 w-9 shrink-0 place-items-center rounded-[6px] text-[12px] font-bold text-surface" style={{ background: ROUTE_COLOR[s.r.color] }}>
                    {s.r.id}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{s.r.name}</span>
                    <span className="block text-[11px] text-muted">
                      Every {s.r.headwayMin} min · {s.buses.length} buses · round trip {Math.round(s.cycle / 60)} min
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={<span className="inline-flex items-center gap-2"><Bus className="h-4 w-4 text-muted" /> Next buses</span>} description={`Stop: ${terminal(sel)} · ${walkM} m walk from home. Tap a stop on the map to change.`}>
          <ul className="space-y-2">
            {arrivals.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink">
                    Route {st.r.id} {a.dir}
                  </span>
                  <span className="block text-[11px] text-muted">{a.occ > 0.85 ? "Standing room only" : a.occ > 0.6 ? "Seats limited" : "Seats available"}</span>
                </span>
                <span className="shrink-0 text-right text-[15px] font-semibold tabular-nums text-ink">{a.mins < 1 ? "Due" : `${Math.round(a.mins)} min`}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-2 border-t border-hair pt-3 text-[12px] text-muted">
            <Navigation className="h-3.5 w-3.5" />
            Corridor now: <FlowChip value={avgCong(sim, st.r.nodes)} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function avgCong(sim: TrafficSim, nodes: number[]) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const e = edgeBetween(nodes[i], nodes[i + 1]);
    if (e) (s += sim.congestion[e.id]), n++;
  }
  return n ? s / n : 0;
}

function terminal(node: number) {
  const n = NODES[node];
  const v = EDGES.find((e) => e.dir === "v" && (e.from === node || e.to === node))?.name;
  const h = EDGES.find((e) => e.dir === "h" && (e.from === node || e.to === node))?.name;
  return v && h ? `${v.replace(" Road", " Rd")} / ${h.replace(" Road", " Rd")}` : `Stop ${n.id}`;
}

/* ----------------------------------------------------------------- alerts */

function AlertsTab() {
  const { alerts } = useCity();
  const now = useNow(5000);
  const [sev, setSev] = useState<"all" | "critical" | "warning" | "info">("all");
  const list = alerts.filter((a) => a.public && (sev === "all" || a.severity === sev));
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel
        title={<span className="inline-flex items-center gap-2"><Bell className="h-4 w-4 text-muted" /> Emergency alerts</span>}
        description="Broadcasts from the city command centre. Run a scenario in Emergency and broadcast it to see it here."
        action={
          <Segmented
            ariaLabel="Severity"
            value={sev}
            onChange={setSev}
            options={[
              { id: "all", label: "All" },
              { id: "critical", label: "Critical" },
              { id: "warning", label: "Warning" },
              { id: "info", label: "Info" },
            ]}
          />
        }
      >
        {list.length === 0 ? <p className="py-6 text-center text-[13px] text-muted">No alerts.</p> : null}
        <ul className="space-y-3">
          {list.map((a) => (
            <li key={a.id} className={cn("rounded-card border px-4 py-3", a.severity === "critical" ? "border-danger/50 bg-danger-soft" : a.severity === "warning" ? "border-warning/40 bg-warning-soft" : "border-hair bg-surface")}>
              <p className={cn("text-[11px] font-semibold uppercase tracking-wide", a.severity === "critical" ? "text-danger" : a.severity === "warning" ? "text-warning" : "text-info")}>
                {a.severity} · {a.source} · {formatAgo(a.ts, now)}
              </p>
              <p className="mt-1 text-[14px] font-semibold text-ink">{a.title}</p>
              <p className="mt-0.5 text-[13px] leading-5 text-ink/85">{a.body}</p>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Notify me about">
        {["Emergencies in my sector", "Air quality turns Poor", "Road closures on my commute", "Water supply interruptions", "Updates on my complaints"].map((l, i) => (
          <label key={l} className="flex items-center justify-between gap-3 py-1.5 text-[13px] text-ink">
            {l}
            <input type="checkbox" defaultChecked={i !== 3} className="h-4 w-4 accent-[var(--primary)]" />
          </label>
        ))}
        <p className="mt-3 border-t border-hair pt-3 text-[12px] leading-5 text-muted">
          In a crisis call <span className="font-semibold text-ink">112</span>. Alerts are also sent by SMS and cell broadcast to everyone in the affected area.
        </p>
      </Panel>
    </div>
  );
}

