/**
 * Emergency scenario engine. Every scenario is a pure function of elapsed
 * time, so the timeline can be played, paused and scrubbed.
 *
 * Models are deliberately simple and documented so they can be swapped for
 * validated ones (e.g. ALOHA for toxic release, HAZUS for seismic damage):
 *  - Gas leak: steady-state Gaussian plume, Briggs urban dispersion (class D).
 *  - Earthquake: intensity attenuation MMI(M, R) + logistic fragility per sector.
 *  - Flood: water level rising over the sector elevation surface, connected fill.
 *  - Evacuation: staggered departures, shortest routes, road-capacity queuing.
 */
import {
  EDGES,
  MAP_H,
  MAP_W,
  METRES_PER_UNIT,
  NODES,
  POIS,
  SECTORS,
  SOURCES,
  BLOCK,
  MARGIN,
  type Poi,
  type PoiKind,
  nearestNode,
  sectorAt,
  sectorNeighbours,
  shortestPath,
  sectorLabel,
} from "@/lib/city/model";
import { clamp } from "@/lib/utils";

export const FCOLS = 104;
export const FROWS = 80;
const CELL = MAP_W / FCOLS; // 10 units = 50 m

export type ScenarioKind = "fire" | "flood" | "accident" | "gas" | "earthquake" | "evacuation";

export interface ScenarioParams {
  kind: ScenarioKind;
  x: number;
  y: number;
  /** 1..3 severity for fire / flood / accident / gas; magnitude for earthquake; radius (km) for evacuation. */
  level: number;
  windFrom: number; // degrees, meteorological (direction wind blows FROM)
  windSpeed: number; // m/s
}

export interface Unit {
  id: string;
  kind: "fire" | "ambulance" | "police" | "hazmat" | "rescue" | "pump";
  label: string;
  from: string;
  path: [number, number][];
  departAt: number;
  arriveAt: number;
  x: number;
  y: number;
  status: "Turning out" | "En route" | "On scene";
}

export interface LogEntry {
  t: number;
  text: string;
  severity: "critical" | "warning" | "info";
}

export interface Zone {
  label: string;
  tone: "critical" | "warning" | "info";
  population: number;
  areaKm2: number;
}

export interface EvacFlow {
  path: [number, number][];
  people: number;
  shelter: string;
  departed: number;
  arrived: number;
}

export interface ScenarioState {
  title: string;
  summary: string;
  field?: Float32Array;
  fieldKind?: "smoke" | "water" | "gas" | "shaking" | "zone";
  zones: Zone[];
  affected: { sector: number; level: number; note: string }[];
  units: Unit[];
  closures: number[];
  diversion?: [number, number][];
  log: LogEntry[];
  metrics: { label: string; value: string; tone?: "good" | "warn" | "bad" }[];
  evac?: { flows: EvacFlow[]; shelters: { name: string; capacity: number; assigned: number; arrived: number; x: number; y: number }[]; evacuatedPct: number; clearanceMin: number };
  advice: string;
  duration: number; // seconds of scenario timeline
}

export const SCENARIO_META: Record<ScenarioKind, { label: string; levelLabel: string; levels: { value: number; label: string }[]; defaultSector: number }> = {
  fire: {
    label: "Residential fire",
    levelLabel: "Building",
    levels: [
      { value: 1, label: "4-storey block" },
      { value: 2, label: "8-storey block" },
      { value: 3, label: "14-storey tower" },
    ],
    defaultSector: 19,
  },
  flood: {
    label: "Sector flooding",
    levelLabel: "Rainfall",
    levels: [
      { value: 1, label: "Heavy · 40 mm/h" },
      { value: 2, label: "Very heavy · 80 mm/h" },
      { value: 3, label: "Cloudburst · 120 mm/h" },
    ],
    defaultSector: 40,
  },
  accident: {
    label: "Road accident",
    levelLabel: "Severity",
    levels: [
      { value: 1, label: "Minor · one lane" },
      { value: 2, label: "Serious · injuries" },
      { value: 3, label: "Multi-vehicle pile-up" },
    ],
    defaultSector: 27,
  },
  gas: {
    label: "Industrial gas leak",
    levelLabel: "Chlorine release",
    levels: [
      { value: 1, label: "Valve leak · 0.5 kg/s" },
      { value: 2, label: "Line rupture · 2 kg/s" },
      { value: 3, label: "Tank failure · 6 kg/s" },
    ],
    defaultSector: 47,
  },
  earthquake: {
    label: "Earthquake",
    levelLabel: "Magnitude",
    levels: [
      { value: 5.2, label: "M 5.2" },
      { value: 6, label: "M 6.0" },
      { value: 6.8, label: "M 6.8" },
      { value: 7.5, label: "M 7.5" },
    ],
    defaultSector: 12,
  },
  evacuation: {
    label: "Emergency evacuation",
    levelLabel: "Evacuation radius",
    levels: [
      { value: 0.4, label: "400 m" },
      { value: 0.7, label: "700 m" },
      { value: 1, label: "1 km" },
    ],
    defaultSector: 38,
  },
};

/* ------------------------------------------------------------------ helpers */

const UNIT_SPEED = 2.6; // units/s ≈ 47 km/h with sirens
const nodePt = (n: number): [number, number] => [NODES[n].x, NODES[n].y];

function pathPoints(fromNode: number, toX: number, toY: number, blocked?: Set<number>): { pts: [number, number][]; length: number } {
  const target = nearestNode(toX, toY);
  const p = shortestPath(fromNode, target, (e) => (blocked?.has(e.id) ? Infinity : e.length)) ?? shortestPath(fromNode, target) ?? [];
  const pts: [number, number][] = [nodePt(fromNode)];
  for (const eid of p) pts.push(nodePt(EDGES[eid].to));
  pts.push([toX, toY]);
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return { pts, length };
}

function along(pts: [number, number][], d: number): [number, number] {
  let rem = d;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (rem <= seg) {
      const f = seg ? rem / seg : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    }
    rem -= seg;
  }
  return pts[pts.length - 1];
}

function nearestPois(kind: PoiKind, x: number, y: number, k: number, blocked?: Set<number>): (Poi & { dist: number })[] {
  return POIS.filter((p) => p.kind === kind)
    .map((p) => ({ ...p, dist: pathPoints(p.node, x, y, blocked).length }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, k);
}

function dispatch(
  t: number,
  kind: Unit["kind"],
  label: string,
  station: Poi,
  x: number,
  y: number,
  delay: number,
  blocked?: Set<number>
): Unit {
  const { pts, length } = pathPoints(station.node, x, y, blocked);
  const departAt = delay;
  const arriveAt = departAt + length / UNIT_SPEED;
  const travelled = clamp((t - departAt) * UNIT_SPEED, 0, length);
  const [ux, uy] = t < departAt ? pts[0] : along(pts, travelled);
  return {
    id: `${kind}-${station.id}-${label}`,
    kind,
    label,
    from: station.name,
    path: pts,
    departAt,
    arriveAt,
    x: ux,
    y: uy,
    status: t < departAt ? "Turning out" : t < arriveAt ? "En route" : "On scene",
  };
}

/** Residents per field cell, spread evenly over each sector's built area. */
const CELL_POP = (() => {
  const pop = new Float32Array(FCOLS * FROWS);
  const inner = (BLOCK - 18) / CELL; // cells per side
  for (let i = 0; i < pop.length; i++) {
    const cx = (i % FCOLS) * CELL + CELL / 2;
    const cy = Math.floor(i / FCOLS) * CELL + CELL / 2;
    const s = sectorAt(cx, cy);
    if (!s) continue;
    const lx = cx - s.x;
    const ly = cy - s.y;
    if (lx < 9 || ly < 9 || lx > BLOCK - 9 || ly > BLOCK - 9) continue;
    pop[i] = s.population / (inner * inner);
  }
  return pop;
})();

function zoneStats(field: Float32Array, threshold: number, upper = Infinity) {
  let people = 0;
  let cells = 0;
  for (let i = 0; i < field.length; i++) {
    if (field[i] >= threshold && field[i] < upper) {
      people += CELL_POP[i];
      cells++;
    }
  }
  const cellKm2 = ((CELL * METRES_PER_UNIT) / 1000) ** 2;
  return { people: Math.round(people), areaKm2: cells * cellKm2 };
}

function affectedSectors(field: Float32Array, threshold: number) {
  const acc = new Map<number, { sum: number; n: number; max: number }>();
  for (let i = 0; i < field.length; i++) {
    if (field[i] < threshold) continue;
    const s = sectorAt((i % FCOLS) * CELL + 5, Math.floor(i / FCOLS) * CELL + 5);
    if (!s) continue;
    const a = acc.get(s.id) ?? { sum: 0, n: 0, max: 0 };
    a.sum += field[i];
    a.n++;
    a.max = Math.max(a.max, field[i]);
    acc.set(s.id, a);
  }
  return [...acc.entries()].map(([sector, a]) => ({ sector, level: a.max, cells: a.n }));
}

const fmtPeople = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

/** Wind vector the plume travels along (towards), unit length. */
function windVector(windFrom: number): [number, number] {
  const to = ((windFrom + 180) * Math.PI) / 180;
  // Map y grows downward; north is up.
  return [Math.sin(to), -Math.cos(to)];
}

/* ----------------------------------------------------------------- scenarios */

export function runScenario(p: ScenarioParams, t: number): ScenarioState {
  switch (p.kind) {
    case "fire":
      return fire(p, t);
    case "flood":
      return flood(p, t);
    case "accident":
      return accident(p, t);
    case "gas":
      return gas(p, t);
    case "earthquake":
      return earthquake(p, t);
    case "evacuation":
      return evacuation(p, t);
  }
}

function fire(p: ScenarioParams, t: number): ScenarioState {
  const s = sectorAt(p.x, p.y) ?? SECTORS[0];
  const floors = p.level === 1 ? 4 : p.level === 2 ? 8 : 14;
  const occupants = floors * 4 * 3.6;
  const engines = nearestPois("fire", p.x, p.y, p.level >= 2 ? 2 : 1);
  const hosp = nearestPois("hospital", p.x, p.y, 1)[0];
  const police = nearestPois("police", p.x, p.y, 1)[0];
  const units: Unit[] = [
    ...engines.map((st, i) => dispatch(t, "fire", i === 0 ? "Fire tender + ladder" : "Second tender", st, p.x, p.y, 75 + i * 40)),
    dispatch(t, "ambulance", "Ambulance", hosp, p.x + 6, p.y + 4, 120),
    dispatch(t, "police", "Police cordon", police, p.x - 6, p.y - 4, 150),
  ];
  const firstOnScene = Math.min(...units.filter((u) => u.kind === "fire").map((u) => u.arriveAt));
  // Fire keeps growing until crews have set up an attack (~4 min after arrival), then decays.
  const attack = firstOnScene + 240;
  const grow = (x: number) => Math.min(1, (x / (300 + 120 * (3 - p.level))) ** 1.6);
  const sizeNow = t < attack ? grow(t) : grow(attack) * Math.max(0.05, 1 - (t - attack) / 900);
  const floorsInvolved = Math.max(1, Math.round(sizeNow * Math.min(floors, 2 + p.level * 2)));
  const evacuated = Math.round(occupants * clamp(1 - Math.exp(-t / 260), 0, 1));
  // Smoke plume downwind.
  const field = new Float32Array(FCOLS * FROWS);
  const [wx, wy] = windVector(p.windFrom);
  const reach = 40 + 220 * sizeNow;
  for (let i = 0; i < field.length; i++) {
    const cx = (i % FCOLS) * CELL + 5 - p.x;
    const cy = Math.floor(i / FCOLS) * CELL + 5 - p.y;
    const down = cx * wx + cy * wy;
    const cross = Math.abs(-cx * wy + cy * wx);
    if (down < -15) continue;
    const width = 12 + Math.max(0, down) * 0.28;
    const v = sizeNow * Math.exp(-(cross * cross) / (2 * width * width)) * Math.exp(-Math.max(0, down) / reach);
    field[i] = v;
  }
  const smoke = zoneStats(field, 0.25);
  const contained = t > attack + 420;
  const log: LogEntry[] = [
    { t: 0, text: `Smoke alarm and 101 call — ${floors}-storey residential block, ${sectorLabel(s)}`, severity: "critical" },
    { t: 30, text: "Building alarm triggered; residents self-evacuating by stairwells", severity: "warning" },
    { t: 75, text: `${engines[0].name} turned out`, severity: "info" },
    { t: firstOnScene, text: "First tender on scene; aerial ladder deployed, search & rescue begins", severity: "info" },
    { t: firstOnScene + 240, text: "Two residents with smoke inhalation handed to ambulance crew", severity: "warning" },
    { t: attack, text: "Attack established on fire floors; spread halted", severity: "info" },
    { t: attack + 420, text: "Fire under control; damping down and ventilation", severity: "info" },
    { t: attack + 900, text: "Structural check requested before residents re-enter", severity: "info" },
  ];
  return {
    title: `Fire · ${sectorLabel(s)}`,
    summary: `${contained ? "Under control" : t < firstOnScene ? "Growing — crews en route" : "Crews fighting fire"} · ${floorsInvolved} floor${floorsInvolved > 1 ? "s" : ""} involved`,
    field,
    fieldKind: "smoke",
    zones: [{ label: "Dense smoke — keep windows shut", tone: "warning", population: smoke.people, areaKm2: smoke.areaKm2 }],
    affected: affectedSectors(field, 0.25).map((a) => ({ sector: a.sector, level: a.level, note: "Smoke" })),
    units,
    closures: [],
    log: log.filter((l) => l.t <= t).reverse(),
    metrics: [
      { label: "First response", value: `${(firstOnScene / 60).toFixed(1)} min`, tone: firstOnScene < 480 ? "good" : "warn" },
      { label: "Occupants evacuated", value: `${evacuated} / ${Math.round(occupants)}`, tone: evacuated / occupants > 0.95 ? "good" : "warn" },
      { label: "Floors involved", value: String(floorsInvolved), tone: contained ? "good" : "bad" },
      { label: "Under smoke", value: fmtPeople(smoke.people), tone: "warn" },
    ],
    advice: "Residents downwind: close windows and switch off air-conditioning. Keep the approach road clear for tenders.",
    duration: 40 * 60,
  };
}

function flood(p: ScenarioParams, t: number): ScenarioState {
  const src = sectorAt(p.x, p.y) ?? SECTORS[40];
  const rate = p.level === 1 ? 40 : p.level === 2 ? 80 : 120;
  // Water level above the source sector's ground, rising then easing as pumps start.
  const pumpsAt = 20 * 60;
  const rise = (rate / 40) * 0.38 * Math.min(1, (t / 2400) ** 0.8) * (t > pumpsAt ? Math.max(0.45, 1 - (t - pumpsAt) / 6000) : 1);
  const level = src.elevation + 0.12 + rise;
  const flooded = new Map<number, number>();
  const queue = [src];
  flooded.set(src.id, level - src.elevation);
  while (queue.length) {
    const s = queue.shift()!;
    for (const nb of sectorNeighbours(s)) {
      if (flooded.has(nb.id)) continue;
      const depth = level - nb.elevation - 0.15; // kerbs and drains absorb the first 15 cm
      if (depth > 0.05) {
        flooded.set(nb.id, depth);
        queue.push(nb);
      }
    }
  }
  const field = new Float32Array(FCOLS * FROWS);
  for (let i = 0; i < field.length; i++) {
    const cx = (i % FCOLS) * CELL + 5;
    const cy = Math.floor(i / FCOLS) * CELL + 5;
    const s = sectorAt(cx, cy);
    if (!s || !flooded.has(s.id)) continue;
    const lx = (cx - s.x) / BLOCK;
    const ly = (cy - s.y) / BLOCK;
    const edgeFade = Math.min(lx, ly, 1 - lx, 1 - ly) * 4;
    const micro = Math.sin(cx * 0.11) * Math.cos(cy * 0.09) * 0.08;
    field[i] = clamp((flooded.get(s.id)! + micro) * Math.min(1, 0.6 + edgeFade), 0, 1.5) / 1.5;
  }
  const closures: number[] = [];
  for (const e of EDGES) {
    const a = NODES[e.from];
    const b = NODES[e.to];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const around = [sectorAt(mx + 3, my + 3), sectorAt(mx - 3, my - 3), sectorAt(mx + 3, my - 3), sectorAt(mx - 3, my + 3)];
    if (around.some((s) => s && (flooded.get(s.id) ?? 0) > 0.3)) closures.push(e.id);
  }
  const deep = zoneStats(field, 0.5 / 1.5);
  const shallow = zoneStats(field, 0.15 / 1.5, 0.5 / 1.5);
  const blocked = new Set(closures);
  const pumps = nearestPois("fire", src.cx, src.cy, 2, blocked);
  const shelters = nearestPois("shelter", src.cx, src.cy, 6).filter((sh) => !flooded.has(sh.sector)).slice(0, 2);
  const police = nearestPois("police", src.cx, src.cy, 1)[0];
  const units: Unit[] = [
    ...pumps.map((st, i) => dispatch(t, "pump", i ? "Pump unit 2" : "High-capacity pump", st, src.cx + (i ? 20 : -20), src.cy, pumpsAt - 600 + i * 120, blocked)),
    dispatch(t, "rescue", "SDRF boat team", POIS.find((x) => x.kind === "fire" && x.name.startsWith("Central"))!, src.cx, src.cy + 25, 600, blocked),
    dispatch(t, "police", "Traffic diversion", police, src.x, src.y, 300),
  ];
  const maxDepth = Math.max(...flooded.values());
  const log: LogEntry[] = [
    { t: 0, text: `IMD red alert: ${rate} mm/h rainfall; storm drains in ${sectorLabel(src)} surcharging`, severity: "warning" },
    { t: 600, text: "Water on carriageway; first road closures", severity: "warning" },
    { t: 900, text: `Inundation spreading to ${Math.max(0, flooded.size - 1)} neighbouring sector(s)`, severity: "critical" },
    { t: pumpsAt, text: "Dewatering pumps operating; level rise slowing", severity: "info" },
    { t: 1800, text: `Relief shelters opened: ${shelters.map((x) => x.name).join(", ")}`, severity: "info" },
    { t: 3000, text: "Ground-floor homes advised to move valuables and power off mains", severity: "warning" },
  ];
  return {
    title: `Flooding · ${sectorLabel(src)}`,
    summary: `${flooded.size} sector${flooded.size > 1 ? "s" : ""} under water · max depth ${maxDepth.toFixed(2)} m`,
    field,
    fieldKind: "water",
    zones: [
      { label: "Deep water > 0.5 m — rescue only", tone: "critical", population: deep.people, areaKm2: deep.areaKm2 },
      { label: "Shallow 0.15–0.5 m — avoid travel", tone: "warning", population: shallow.people, areaKm2: shallow.areaKm2 },
    ],
    affected: [...flooded.entries()].map(([sector, d]) => ({ sector, level: clamp(d / 1.5, 0, 1), note: `${d.toFixed(2)} m` })).sort((a, b) => b.level - a.level),
    units,
    closures,
    log: log.filter((l) => l.t <= t).reverse(),
    metrics: [
      { label: "Max depth", value: `${maxDepth.toFixed(2)} m`, tone: maxDepth > 0.5 ? "bad" : "warn" },
      { label: "Roads closed", value: String(closures.length / 2), tone: closures.length ? "warn" : "good" },
      { label: "Residents, deep water", value: fmtPeople(deep.people), tone: deep.people ? "bad" : "good" },
      { label: "Shelters open", value: String(shelters.length), tone: "good" },
    ],
    advice: "Do not drive or walk through moving water. Ground-floor residents in red sectors move to upper floors or the nearest relief shelter.",
    duration: 60 * 60,
  };
}

function accident(p: ScenarioParams, t: number): ScenarioState {
  // Snap to the nearest road link.
  let best = EDGES[0];
  let bestD = Infinity;
  for (const e of EDGES) {
    const a = NODES[e.from];
    const b = NODES[e.to];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const d = Math.hypot(mx - p.x, my - p.y);
    if (d < bestD) (bestD = d), (best = e);
  }
  const a = NODES[best.from];
  const b = NODES[best.to];
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;
  const twin = EDGES.find((e) => e.from === best.to && e.to === best.from)!;
  const closures = p.level >= 2 ? [best.id, twin.id] : [best.id];
  const clearAt = (p.level === 1 ? 25 : p.level === 2 ? 50 : 95) * 60;
  const open = t >= clearAt;
  const blocked = new Set(closures);
  const div = shortestPath(best.from, best.to, (e) => (blocked.has(e.id) ? Infinity : e.length));
  const diversion: [number, number][] = div ? [nodePt(best.from), ...div.map((id) => nodePt(EDGES[id].to))] : [];
  const hosps = nearestPois("hospital", x, y, p.level === 3 ? 2 : 1);
  const police = nearestPois("police", x, y, 1)[0];
  const units: Unit[] = [
    ...hosps.map((h, i) => dispatch(t, "ambulance", i ? "Second ambulance" : "Ambulance (ALS)", h, x + 4 * i, y + 3, 60 + i * 30)),
    dispatch(t, "police", "Traffic police", police, x - 5, y - 3, 90),
  ];
  if (p.level >= 2) units.push(dispatch(t, "fire", "Rescue tender (cutting gear)", nearestPois("fire", x, y, 1)[0], x + 7, y - 5, 90));
  const injured = p.level === 1 ? 0 : p.level === 2 ? 3 : 9;
  const firstAmb = Math.min(...units.filter((u) => u.kind === "ambulance").map((u) => u.arriveAt));
  const log: LogEntry[] = [
    { t: 0, text: `Collision detected by camera analytics on ${best.name}`, severity: "critical" },
    { t: 20, text: "112 call confirms; nearest units auto-dispatched", severity: "info" },
    { t: 60, text: `Signal plans updated; diversion via ${div ? `${div.length} links` : "none available"}`, severity: "info" },
    { t: firstAmb, text: injured ? `${injured} injured being triaged` : "No injuries; vehicles being moved", severity: injured ? "warning" : "info" },
    { t: clearAt - 300, text: "Tow truck clearing debris", severity: "info" },
    { t: clearAt, text: "Road reopened to traffic", severity: "info" },
  ];
  return {
    title: `Road accident · ${best.name}`,
    summary: open ? "Cleared — road reopened" : `${closures.length === 2 ? "Both directions" : "One direction"} closed · clearance in ${Math.ceil((clearAt - t) / 60)} min`,
    zones: [],
    affected: [],
    units,
    closures: open ? [] : closures,
    diversion: open ? undefined : diversion,
    log: log.filter((l) => l.t <= t).reverse(),
    metrics: [
      { label: "Ambulance on scene", value: `${(firstAmb / 60).toFixed(1)} min`, tone: firstAmb < 480 ? "good" : "warn" },
      { label: "Injured", value: String(injured), tone: injured ? "bad" : "good" },
      { label: "Lanes closed", value: String(closures.length * best.lanes), tone: open ? "good" : "warn" },
      { label: "Detour", value: diversion.length ? `+${(((diversion.length - 1) * BLOCK - BLOCK) * METRES_PER_UNIT / 1000).toFixed(1)} km` : "—" },
    ],
    advice: `Avoid ${best.name}; follow the signed diversion. Give way to emergency vehicles.`,
    duration: Math.max(40 * 60, clearAt + 300),
  };
}

/** Briggs urban dispersion coefficients, neutral (class D) stability; x in metres. */
function sigmas(x: number) {
  return { sy: 0.16 * x * (1 + 0.0004 * x) ** -0.5, sz: 0.14 * x * (1 + 0.0003 * x) ** -0.5 };
}

function gas(p: ScenarioParams, t: number): ScenarioState {
  const q = (p.level === 1 ? 0.5 : p.level === 2 ? 2 : 6) * 1000 * 1000; // mg/s
  const u = Math.max(0.8, p.windSpeed);
  const [wx, wy] = windVector(p.windFrom);
  const front = u * t; // metres the cloud has travelled
  const stopAt = 25 * 60; // leak isolated
  const tail = t > stopAt ? u * (t - stopAt) : -1;
  const ppmPer = 24.45 / 70.9; // chlorine mg/m3 -> ppm
  const field = new Float32Array(FCOLS * FROWS);
  for (let i = 0; i < field.length; i++) {
    const dx = ((i % FCOLS) * CELL + 5 - p.x) * METRES_PER_UNIT;
    const dy = (Math.floor(i / FCOLS) * CELL + 5 - p.y) * METRES_PER_UNIT;
    const down = dx * wx + dy * wy;
    if (down <= 5 || down > front || down < tail) continue;
    const cross = -dx * wy + dy * wx;
    const { sy, sz } = sigmas(down);
    const c = (q / (Math.PI * u * sy * sz)) * Math.exp(-(cross * cross) / (2 * sy * sy)); // ground-level, ground release
    field[i] = c * ppmPer; // ppm
  }
  // Display scale: log ppm mapped to 0..1 for colouring, thresholds in ppm.
  const AEGL3 = 20;
  const AEGL2 = 2.8;
  const AEGL1 = 0.5;
  const red = zoneStats(field, AEGL3);
  const orange = zoneStats(field, AEGL2, AEGL3);
  const yellow = zoneStats(field, AEGL1, AEGL2);
  const norm = new Float32Array(field.length);
  for (let i = 0; i < field.length; i++) norm[i] = field[i] < AEGL1 ? 0 : clamp(Math.log10(field[i] / AEGL1) / Math.log10(200 / AEGL1), 0.05, 1);
  const hazmatSt = nearestPois("fire", p.x, p.y, 1)[0];
  const hosp = nearestPois("hospital", p.x, p.y, 2);
  const police = nearestPois("police", p.x, p.y, 2);
  // Responders approach from upwind.
  const ux = p.x - wx * 30;
  const uy = p.y - wy * 30;
  const units: Unit[] = [
    dispatch(t, "hazmat", "HAZMAT team (SCBA)", hazmatSt, ux, uy, 120),
    ...hosp.map((h, i) => dispatch(t, "ambulance", `Ambulance ${i + 1}`, h, ux + 8 * (i + 1), uy, 150 + 40 * i)),
    ...police.map((st, i) => dispatch(t, "police", `Cordon ${i + 1}`, st, ux - 10 * (i + 1), uy + 6, 180)),
  ];
  const src = SOURCES.find((s) => Math.hypot(s.x - p.x, s.y - p.y) < 30);
  const dirName = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((p.windFrom + 180) % 360) / 45) % 8];
  const log: LogEntry[] = [
    { t: 0, text: `Chlorine release at ${src?.name ?? "industrial site"}; plant siren sounded`, severity: "critical" },
    { t: 90, text: `Plume moving ${dirName} at ${u.toFixed(1)} m/s; AEGL zones computed`, severity: "warning" },
    { t: 300, text: "Sirens and cell broadcast: shelter in place in orange zone, evacuate red zone", severity: "critical" },
    { t: 600, text: "HAZMAT team approaching from upwind, water curtain deployed", severity: "info" },
    { t: stopAt, text: "Leak isolated; cloud drifting downwind and diluting", severity: "info" },
  ];
  return {
    title: `Gas leak · ${src?.name ?? "Industrial area"}`,
    summary: t > stopAt ? "Leak isolated — residual cloud downwind" : `Active release · cloud front ${(front / 1000).toFixed(1)} km downwind`,
    field: norm,
    fieldKind: "gas",
    zones: [
      { label: "Red · > 20 ppm (AEGL-3) — evacuate", tone: "critical", population: red.people, areaKm2: red.areaKm2 },
      { label: "Orange · 2.8–20 ppm (AEGL-2) — shelter in place", tone: "warning", population: orange.people, areaKm2: orange.areaKm2 },
      { label: "Yellow · 0.5–2.8 ppm (AEGL-1) — irritation", tone: "info", population: yellow.people, areaKm2: yellow.areaKm2 },
    ],
    affected: affectedSectors(field, AEGL2).map((a) => ({ sector: a.sector, level: clamp(Math.log10(a.level / AEGL2) / 2, 0.1, 1), note: `${a.level.toFixed(0)} ppm peak` })).sort((a, b) => b.level - a.level),
    units,
    closures: [],
    log: log.filter((l) => l.t <= t).reverse(),
    metrics: [
      { label: "Release rate", value: `${q / 1e6} kg/s` },
      { label: "Red zone", value: fmtPeople(red.people), tone: red.people ? "bad" : "good" },
      { label: "Orange zone", value: fmtPeople(orange.people), tone: orange.people ? "warn" : "good" },
      { label: "Cloud reach", value: `${(Math.min(front, 6000) / 1000).toFixed(1)} km` },
    ],
    advice: "Red zone: leave crosswind (at right angles to the wind), never downwind. Orange zone: go indoors, shut windows, turn off fans and AC, wet cloth over nose and mouth.",
    duration: 45 * 60,
  };
}

function earthquake(p: ScenarioParams, t: number): ScenarioState {
  const M = p.level;
  const depthKm = 12;
  const field = new Float32Array(FCOLS * FROWS);
  const mmiAt = (x: number, y: number) => {
    const dkm = (Math.hypot(x - p.x, y - p.y) * METRES_PER_UNIT) / 1000;
    const R = Math.sqrt(dkm * dkm + depthKm * depthKm);
    return clamp(2.085 + 1.428 * M - 1.402 * Math.log(R) - 0.0007 * R, 1, 10);
  };
  for (let i = 0; i < field.length; i++) field[i] = mmiAt((i % FCOLS) * CELL + 5, Math.floor(i / FCOLS) * CELL + 5) / 10;
  // Drone / field survey reveals damage progressively.
  const surveyed = clamp(t / (25 * 60), 0, 1);
  const order = [...SECTORS].sort((a, b) => Math.hypot(a.cx - p.x, a.cy - p.y) - Math.hypot(b.cx - p.x, b.cy - p.y));
  const nSurveyed = Math.round(order.length * surveyed);
  let injured = 0;
  let trapped = 0;
  let heavy = 0;
  const affected: ScenarioState["affected"] = [];
  order.forEach((s, k) => {
    const mmi = mmiAt(s.cx, s.cy);
    const pDamage = s.population ? 1 / (1 + Math.exp(-(mmi - 9.4 + s.vulnerability) / 0.5)) : 0;
    injured += s.population * pDamage * 0.012;
    trapped += s.population * pDamage * 0.0025;
    if (pDamage > 0.15) heavy++;
    if (k < nSurveyed && pDamage > 0.04) affected.push({ sector: s.id, level: pDamage, note: `MMI ${mmi.toFixed(1)} · ${Math.round(pDamage * 100)}% heavy damage` });
  });
  affected.sort((a, b) => b.level - a.level);
  const beds = POIS.filter((x) => x.kind === "hospital").reduce((a, h) => a + (h.capacity ?? 0), 0);
  const surge = Math.round(beds * 0.35);
  const units: Unit[] = affected.slice(0, 4).flatMap((a, i) => {
    const s = SECTORS[a.sector];
    const st = nearestPois("fire", s.cx, s.cy, 1)[0];
    const h = nearestPois("hospital", s.cx, s.cy, 1)[0];
    return [dispatch(t, "rescue", `USAR team ${i + 1}`, st, s.cx, s.cy, 300 + i * 240), dispatch(t, "ambulance", `Ambulance ${i + 1}`, h, s.cx + 10, s.cy + 10, 240 + i * 180)];
  });
  const maxMmi = mmiAt(p.x, p.y);
  const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][Math.round(maxMmi) - 1];
  const log: LogEntry[] = [
    { t: 0, text: `M ${M.toFixed(1)} earthquake, depth ${depthKm} km; strongest shaking ${roman} near ${sectorLabel(sectorAt(p.x, p.y) ?? SECTORS[0])}`, severity: "critical" },
    { t: 60, text: "Metro and lifts halted; gas supply auto shut-off in high-intensity sectors", severity: "warning" },
    { t: 180, text: "Hospitals switched to mass-casualty mode", severity: "warning" },
    { t: 420, text: "Aftershock M " + (M - 1.3).toFixed(1), severity: "warning" },
    { t: 600, text: `Drone survey in progress — ${Math.round(surveyed * 100)}% of sectors assessed`, severity: "info" },
    { t: 1500, text: "Damage assessment complete; USAR teams prioritised by trapped estimates", severity: "info" },
  ];
  return {
    title: `Earthquake · M ${M.toFixed(1)}`,
    summary: `Peak intensity ${roman} · ${heavy} sector${heavy === 1 ? "" : "s"} with significant damage`,
    field,
    fieldKind: "shaking",
    zones: [],
    affected,
    units,
    closures: [],
    log: log.filter((l) => l.t <= t).reverse(),
    metrics: [
      { label: "Peak intensity", value: `MMI ${roman}`, tone: maxMmi >= 8 ? "bad" : maxMmi >= 6 ? "warn" : "good" },
      { label: "Injured (est.)", value: fmtPeople(injured), tone: injured > surge ? "bad" : "warn" },
      { label: "Trapped (est.)", value: fmtPeople(trapped), tone: trapped > 20 ? "bad" : "warn" },
      { label: "Surge beds", value: `${surge}`, tone: injured > surge ? "bad" : "good" },
    ],
    advice: "Drop, cover and hold on during aftershocks. Stay out of damaged buildings. Use SMS rather than calls to keep lines free.",
    duration: 40 * 60,
  };
}

function evacuation(p: ScenarioParams, t: number): ScenarioState {
  const radius = (p.level * 1000) / METRES_PER_UNIT;
  const field = new Float32Array(FCOLS * FROWS);
  for (let i = 0; i < field.length; i++) {
    const d = Math.hypot((i % FCOLS) * CELL + 5 - p.x, Math.floor(i / FCOLS) * CELL + 5 - p.y);
    field[i] = d <= radius ? 1 : 0;
  }
  const zone = zoneStats(field, 0.5);
  const shelters = POIS.filter((s) => s.kind === "shelter" && Math.hypot(s.x - p.x, s.y - p.y) > radius + 15).map((s) => ({
    name: s.name,
    capacity: s.capacity ?? 2000,
    assigned: 0,
    arrived: 0,
    x: s.x,
    y: s.y,
    node: s.node,
  }));
  // Origin groups: each zone sector sends its residents from its nearest junction.
  const groups = SECTORS.map((s) => {
    let people = 0;
    for (let i = 0; i < field.length; i++) {
      if (!field[i]) continue;
      const cx = (i % FCOLS) * CELL + 5;
      const cy = Math.floor(i / FCOLS) * CELL + 5;
      if (sectorAt(cx, cy)?.id === s.id) people += CELL_POP[i];
    }
    return { s, people: Math.round(people) };
  }).filter((g) => g.people > 50);
  const flows: EvacFlow[] = [];
  const DEPART_MEAN = 12 * 60;
  const SPEED = 1.4 / METRES_PER_UNIT * 6; // mixed vehicles + walking, units/s (~30 km/h effective)
  const LINK_CAP = 1800 / 3600; // people per second per exit road (buses + cars + walkers)
  const SHELTER_SHARE = 0.35; // the rest stay with relatives outside the zone
  let lastArrival = 0;
  for (const g of groups) {
    let remaining = Math.round(g.people * SHELTER_SHARE);
    const order = [...shelters].sort((a, b) => Math.hypot(a.x - g.s.cx, a.y - g.s.cy) - Math.hypot(b.x - g.s.cx, b.y - g.s.cy));
    for (const sh of order) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Math.max(0, sh.capacity - sh.assigned));
      if (take <= 0) continue;
      sh.assigned += take;
      remaining -= take;
      const startNode = nearestNode(g.s.cx, g.s.cy);
      const { pts, length } = pathPoints(startNode, sh.x, sh.y);
      pts.unshift([g.s.cx, g.s.cy]);
      const travel = length / SPEED;
      const queue = take / (LINK_CAP * 4); // four exit roads per sector
      // Departures follow a Rayleigh curve; arrivals lag by travel + queue.
      const cdf = (x: number) => (x <= 0 ? 0 : 1 - Math.exp(-(x * x) / (2 * (DEPART_MEAN / 1.25) ** 2)));
      const departed = Math.round(take * cdf(t));
      const arrived = Math.round(take * cdf(t - travel - queue * cdf(t)));
      sh.arrived += arrived;
      lastArrival = Math.max(lastArrival, 2.4 * DEPART_MEAN + travel + queue);
      flows.push({ path: pts, people: take, shelter: sh.name, departed, arrived });
    }
  }
  const total = groups.reduce((a, g) => a + g.people, 0);
  const cdfSelf = (x: number) => (x <= 0 ? 0 : 1 - Math.exp(-(x * x) / (2 * (DEPART_MEAN / 1.25) ** 2)));
  const selfOut = Math.round(total * (1 - SHELTER_SHARE) * cdfSelf(t - 420));
  const arrivedAll = flows.reduce((a, f) => a + f.arrived, 0) + selfOut;
  const capacity = shelters.reduce((a, s) => a + s.capacity, 0);
  const evacuatedPct = total ? arrivedAll / total : 1;
  const busDepots = nearestPois("police", p.x, p.y, 2);
  const units: Unit[] = busDepots.map((st, i) => dispatch(t, "police", `Marshals ${i + 1}`, st, p.x + (i ? radius * 0.5 : -radius * 0.5), p.y, 120));
  const log: LogEntry[] = [
    { t: 0, text: `Evacuation ordered within ${p.level} km — ${fmtPeople(total)} residents`, severity: "critical" },
    { t: 60, text: "Cell broadcast and sirens; contraflow on outbound arterials", severity: "warning" },
    { t: 300, text: `${shelters.length} shelters opened, capacity ${fmtPeople(capacity)}`, severity: "info" },
    { t: DEPART_MEAN, text: "Half of residents have left home", severity: "info" },
    { t: lastArrival * 0.7, text: "Door-to-door sweep for elderly and disabled residents", severity: "warning" },
  ];
  return {
    title: `Evacuation · ${p.level} km radius`,
    summary: `${Math.round(evacuatedPct * 100)}% out of the zone · clearance ≈ ${Math.round(lastArrival / 60)} min`,
    field,
    fieldKind: "zone",
    zones: [{ label: "Evacuation zone", tone: "critical", population: zone.people, areaKm2: zone.areaKm2 }],
    affected: groups.map((g) => ({ sector: g.s.id, level: 1, note: `${fmtPeople(g.people)} residents` })),
    units,
    closures: [],
    log: log.filter((l) => l.t <= t).reverse(),
    metrics: [
      { label: "Residents", value: fmtPeople(total) },
      { label: "Out of zone", value: `${Math.round(evacuatedPct * 100)}%`, tone: evacuatedPct > 0.9 ? "good" : "warn" },
      { label: "Shelter places", value: `${fmtPeople(capacity)} for ${fmtPeople(total * SHELTER_SHARE)}`, tone: capacity >= total * SHELTER_SHARE ? "good" : "bad" },
      { label: "Clearance time", value: `${Math.round(lastArrival / 60)} min` },
    ],
    evac: { flows, shelters: shelters.map(({ node: _node, ...rest }) => rest), evacuatedPct, clearanceMin: lastArrival / 60 },
    advice: "Leave by the marked route, carry ID, medicines and water. Do not return until the all-clear.",
    duration: Math.max(45 * 60, Math.ceil(lastArrival / 300) * 300),
  };
}

export const MAP_DIMS = { MAP_W, MAP_H, MARGIN };
