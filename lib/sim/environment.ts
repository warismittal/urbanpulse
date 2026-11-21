/**
 * Environment model: air quality (PM2.5, PM10, AQI), noise, temperature and
 * green cover, plus an in-browser ML forecaster.
 *
 * Pollution at any point = regional background (crop-residue smoke on NW wind)
 * + local traffic (from the live traffic simulation) + industrial plumes
 * + construction dust, all divided by the boundary-layer mixing factor
 * (night-time inversions trap pollution). AQI follows India's CPCB scheme.
 */
import { EDGES, NODES, SECTORS, SOURCES, MAP_W, MAP_H, METRES_PER_UNIT, sectorAt } from "@/lib/city/model";
import type { TrafficSim } from "./traffic";
import { demandProfile } from "./traffic";
import { clamp, seeded } from "@/lib/utils";

/* ------------------------------------------------------------------- CPCB AQI */

const BP_PM25 = [
  [0, 30, 0, 50],
  [31, 60, 51, 100],
  [61, 90, 101, 200],
  [91, 120, 201, 300],
  [121, 250, 301, 400],
  [251, 380, 401, 500],
];
const BP_PM10 = [
  [0, 50, 0, 50],
  [51, 100, 51, 100],
  [101, 250, 101, 200],
  [251, 350, 201, 300],
  [351, 430, 301, 400],
  [431, 510, 401, 500],
];

function subIndex(c: number, bps: number[][]) {
  const v = Math.max(0, c);
  for (const [lo, hi, ilo, ihi] of bps) {
    if (v <= hi) return ilo + ((ihi - ilo) / (hi - lo)) * (Math.max(v, lo) - lo);
  }
  return 500;
}

export function aqi(pm25: number, pm10: number) {
  const a = subIndex(pm25, BP_PM25);
  const b = subIndex(pm10, BP_PM10);
  return { aqi: Math.round(Math.max(a, b)), dominant: a >= b ? "PM2.5" : "PM10" };
}

export const AQI_BANDS = [
  { max: 50, label: "Good", color: "#3a9d5d", advice: "Minimal impact." },
  { max: 100, label: "Satisfactory", color: "#9bc53d", advice: "Minor breathing discomfort for sensitive people." },
  { max: 200, label: "Moderate", color: "#e3b505", advice: "Discomfort for people with lung or heart disease, children and older adults." },
  { max: 300, label: "Poor", color: "#f08c1e", advice: "Breathing discomfort on prolonged exposure. Limit outdoor exertion." },
  { max: 400, label: "Very poor", color: "#e0412f", advice: "Respiratory illness on prolonged exposure. Avoid outdoor activity." },
  { max: 500, label: "Severe", color: "#9e1b1b", advice: "Affects healthy people; serious impact on those with disease. Stay indoors." },
];

export function aqiBand(v: number) {
  return AQI_BANDS.find((b) => v <= b.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

/* -------------------------------------------------------------------- stations */

export interface Station {
  id: string;
  name: string;
  sector: number;
  x: number;
  y: number;
}

export const STATIONS: Station[] = [1, 4, 9, 12, 17, 19, 21, 24, 27, 30, 34, 37, 38, 43, 45, 47].map((sid, i) => {
  const s = SECTORS[sid];
  return { id: `aq-${i + 1}`, name: s.name.startsWith("Sector") ? `CAAQMS ${s.name}` : `CAAQMS ${s.name}`, sector: sid, x: s.cx + ((i % 3) - 1) * 18, y: s.cy + ((i % 2) * 2 - 1) * 16 };
});

/* -------------------------------------------------------------------- weather */

export interface Weather {
  windFrom: number;
  windSpeed: number;
  temp: number;
  rh: number;
  mixing: number; // 0.3 (strong inversion) .. 1 (well mixed)
}

/** day 0 = today, negative = past. Hour may be fractional. */
export function weatherAt(day: number, hour: number): Weather {
  const r = seeded(Math.floor((day + 1000) * 24 + Math.floor(hour)) * 7 + 3);
  const daylight = clamp(Math.sin(((hour - 6.5) / 11) * Math.PI), 0, 1);
  const easterly = ((day % 7) + 7) % 7 === 3; // occasional easterly day brings cleaner air
  const windFrom = ((easterly ? 105 : 300) + Math.sin(day * 0.9) * 25 + Math.sin((hour / 24) * 2 * Math.PI) * 35 + (r() - 0.5) * 80 + 720) % 360;
  const windSpeed = clamp(0.9 + 2.4 * daylight + (r() - 0.5) * 0.8 + (easterly ? 0.8 : 0), 0.4, 6);
  const temp = 18.5 + 7 * Math.cos(((hour - 15) / 24) * 2 * Math.PI) - day * 0.05 + (r() - 0.5) * 0.8;
  const rh = clamp(72 - 30 * daylight + (r() - 0.5) * 8, 25, 95);
  const mixing = clamp(0.32 + 0.68 * daylight ** 0.8 + windSpeed * 0.04, 0.3, 1);
  return { windFrom, windSpeed, temp, rh, mixing };
}

/** Crop-residue fire activity in the region, 0..1. Peaks around mid-November. */
export function stubbleIndex(day: number) {
  const r = seeded((day + 500) * 13);
  return clamp(0.15 + 0.75 * Math.exp(-((day + 6) ** 2) / (2 * 7 * 7)) + (r() - 0.5) * 0.12, 0, 1);
}

function angDiff(a: number, b: number) {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** Bearing (degrees from north) from point a to point b on the map. */
export function bearing(ax: number, ay: number, bx: number, by: number) {
  return ((Math.atan2(bx - ax, -(by - ay)) * 180) / Math.PI + 360) % 360;
}

/* ---------------------------------------------------------- pollution model */

export interface Contributions {
  regional: number;
  traffic: number;
  industry: number;
  construction: number;
}

/** Static road density around each point (0..~1.5), precomputed on a coarse grid. */
const ROAD_GRID_COLS = 52;
const ROAD_GRID_ROWS = 40;
const ROAD_DENSITY = (() => {
  const g = new Float32Array(ROAD_GRID_COLS * ROAD_GRID_ROWS);
  for (let i = 0; i < g.length; i++) {
    const x = ((i % ROAD_GRID_COLS) + 0.5) * (MAP_W / ROAD_GRID_COLS);
    const y = (Math.floor(i / ROAD_GRID_COLS) + 0.5) * (MAP_H / ROAD_GRID_ROWS);
    let s = 0;
    for (const e of EDGES) {
      if (e.from > e.to) continue;
      const a = NODES[e.from];
      const b = NODES[e.to];
      const d = distSeg(x, y, a.x, a.y, b.x, b.y);
      s += (e.arterial ? 1.6 : 1) * Math.exp(-d / 30);
    }
    g[i] = s / 3;
  }
  return g;
})();

function roadDensity(x: number, y: number) {
  const c = clamp(Math.floor((x / MAP_W) * ROAD_GRID_COLS), 0, ROAD_GRID_COLS - 1);
  const r = clamp(Math.floor((y / MAP_H) * ROAD_GRID_ROWS), 0, ROAD_GRID_ROWS - 1);
  return ROAD_DENSITY[r * ROAD_GRID_COLS + c];
}

/** Live traffic intensity near a point from the traffic sim, normalised (~1 at a busy peak). */
export function liveTrafficAt(sim: TrafficSim | null, x: number, y: number) {
  if (!sim) return null;
  let s = 0;
  let w = 0;
  for (const e of EDGES) {
    const a = NODES[e.from];
    const b = NODES[e.to];
    const d = Math.hypot((a.x + b.x) / 2 - x, (a.y + b.y) / 2 - y);
    if (d > 200) continue;
    const k = Math.exp(-d / 80);
    s += k * (sim.edgeCount[e.id] / 40 + sim.congestion[e.id] * 0.8);
    w += k;
  }
  return w ? s / w : 0;
}

export function pollutionAt(x: number, y: number, day: number, hour: number, trafficIdx?: number | null, wx?: Weather) {
  const w = wx ?? weatherAt(day, hour);
  const stubble = stubbleIndex(day);
  const fromNW = Math.exp(-((angDiff(w.windFrom, 310) / 55) ** 2));
  // Regional smoke enters from the north-west edge; a little more on that side.
  const edgeBias = 1 + 0.12 * (1 - x / MAP_W) + 0.08 * (1 - y / MAP_H);
  const regional = (20 + 62 * stubble * (0.25 + 0.75 * fromNW)) * edgeBias;
  const tIdx = trafficIdx ?? demandProfile(hour) * (((day % 7) + 7) % 7 === 0 ? 0.7 : 1);
  const traffic = 34 * tIdx * roadDensity(x, y);
  let industry = 0;
  let construction = 0;
  const windTo = (w.windFrom + 180) % 360;
  for (const s of SOURCES) {
    const dKm = (Math.hypot(s.x - x, s.y - y) * METRES_PER_UNIT) / 1000;
    const b = bearing(s.x, s.y, x, y);
    const along = Math.exp(-((angDiff(b, windTo) / (s.kind === "industrial" ? 28 : 45)) ** 2));
    const near = Math.exp(-dKm / (s.kind === "industrial" ? 2.4 : 0.7)) / (0.35 + dKm);
    const base = s.kind === "industrial" ? 60 : 26;
    const v = base * s.strength * near * (0.25 + along * 1.4) / Math.max(0.6, w.windSpeed * 0.6);
    if (s.kind === "industrial") industry += v;
    else construction += v;
  }
  const mix = 1 / w.mixing ** 0.65;
  const c: Contributions = { regional: regional * mix, traffic: traffic * mix, industry: industry * mix, construction: construction * mix * 0.35 };
  const pm25 = c.regional + c.traffic + c.industry + c.construction;
  const pm10 = pm25 * 1.45 + construction * mix * 2.2 + traffic * mix * 0.9 + 18;
  return { pm25, pm10, contributions: c, weather: w };
}

/** Station reading with deterministic sensor noise. */
export function stationReading(st: Station, day: number, hour: number, trafficIdx?: number | null) {
  const p = pollutionAt(st.x, st.y, day, hour, trafficIdx);
  const r = seeded(Math.floor((day + 1000) * 240 + hour * 10) + st.x * 3 + st.y);
  const n = 1 + (r() - 0.5) * 0.1;
  const pm25 = p.pm25 * n;
  const pm10 = p.pm10 * n;
  return { ...p, pm25, pm10, ...aqi(pm25, pm10) };
}

/* ------------------------------------------------------------- noise & heat */

export function noiseAt(x: number, y: number, hour: number, sim: TrafficSim | null) {
  const t = sim ? liveTrafficAt(sim, x, y)! : demandProfile(hour);
  let db = 38 + 22 * Math.log10(1 + 6 * roadDensity(x, y) * (0.3 + t));
  for (const s of SOURCES) {
    const d = Math.hypot(s.x - x, s.y - y) * METRES_PER_UNIT;
    const lvl = (s.kind === "industrial" ? 82 : 86) - 20 * Math.log10(Math.max(10, d) / 10);
    db = 10 * Math.log10(10 ** (db / 10) + 10 ** (lvl / 10));
  }
  const s = sectorAt(x, y);
  if (s?.use === "green") db -= 5;
  return db;
}

export function temperatureAt(x: number, y: number, day: number, hour: number) {
  const w = weatherAt(day, hour);
  const s = sectorAt(x, y);
  if (!s) return w.temp + 0.5 * roadDensity(x, y);
  // Urban heat island: built-up mass warms, canopy and water cool.
  const night = 1 - clamp(Math.sin(((hour - 6.5) / 11) * Math.PI), 0, 1);
  const uhi = (2.2 + 1.6 * night) * s.builtDensity - 0.045 * s.greenCover + (s.use === "water" ? -1.4 : 0) + 0.35 * roadDensity(x, y);
  return w.temp + uhi;
}

/* --------------------------------------------------------------------- fields */

export const FC = 104;
export const FR = 80;

export function computeField(kind: "aqi" | "pm25" | "pm10" | "noise" | "temp" | "green", hour: number, sim: TrafficSim | null, readings?: { x: number; y: number; pm25: number; pm10: number; aqi: number }[]) {
  const f = new Float32Array(FC * FR);
  const cell = MAP_W / FC;
  for (let i = 0; i < f.length; i++) {
    const x = (i % FC) * cell + cell / 2;
    const y = Math.floor(i / FC) * cell + cell / 2;
    if (kind === "aqi" || kind === "pm25" || kind === "pm10") {
      // Inverse-distance weighting from the monitoring stations (what you can actually measure).
      let num = 0;
      let den = 0;
      for (const r of readings ?? []) {
        const d2 = (r.x - x) ** 2 + (r.y - y) ** 2 + 400;
        const wgt = 1 / d2;
        num += wgt * (kind === "aqi" ? r.aqi : kind === "pm25" ? r.pm25 : r.pm10);
        den += wgt;
      }
      f[i] = den ? num / den : 0;
    } else if (kind === "noise") {
      f[i] = i % 2 === 0 || i % FC === FC - 1 ? noiseAt(x, y, hour, sim) : 0; // compute half, fill below
    } else if (kind === "temp") {
      f[i] = temperatureAt(x, y, 0, hour);
    } else {
      const s = sectorAt(x, y);
      f[i] = s ? s.greenCover : 0;
    }
  }
  if (kind === "noise") for (let i = 1; i < f.length; i += 2) if (i % FC !== FC - 1) f[i] = (f[i - 1] + f[i + 1]) / 2;
  return f;
}

/* -------------------------------------------------------------- ML forecaster */

export interface HourRow {
  day: number;
  hour: number;
  pm25: number;
  w: Weather;
  traffic: number;
  stubble: number;
}

/** City-average PM2.5 for the last `days` days, hourly, oldest first. */
export function cityHistory(days = 30, upToHour = 0): HourRow[] {
  const rows: HourRow[] = [];
  for (let d = -days; d <= 0; d++) {
    for (let h = 0; h < 24; h++) {
      if (d === 0 && h > upToHour) break;
      const w = weatherAt(d, h);
      const traffic = demandProfile(h) * (((d % 7) + 7) % 7 === 0 ? 0.7 : 1);
      let s = 0;
      for (const st of STATIONS) s += stationReading(st, d, h, traffic).pm25;
      rows.push({ day: d, hour: h, pm25: s / STATIONS.length, w, traffic, stubble: stubbleIndex(d) });
    }
  }
  return rows;
}

export const FEATURES = [
  "PM2.5 now",
  "PM2.5 1 h ago",
  "PM2.5 same hour yesterday",
  "Hour (sin)",
  "Hour (cos)",
  "Wind speed",
  "Wind from NW",
  "Temperature",
  "Mixing height",
  "Traffic",
  "Stubble fires",
] as const;

function featureRow(prev: number, prev1: number, prev24: number, next: { hour: number; w: Weather; traffic: number; stubble: number }) {
  const fromNW = Math.exp(-((angDiff(next.w.windFrom, 310) / 55) ** 2));
  return [
    prev,
    prev1,
    prev24,
    Math.sin((2 * Math.PI * next.hour) / 24),
    Math.cos((2 * Math.PI * next.hour) / 24),
    next.w.windSpeed,
    fromNW,
    next.w.temp,
    next.w.mixing,
    next.traffic,
    next.stubble,
  ];
}

function solve(A: number[][], b: number[]) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / piv;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (M[i][i] || 1e-9));
}

export interface RidgeModel {
  mean: number[];
  std: number[];
  coef: number[]; // on standardised features
  intercept: number;
}

export function trainRidge(X: number[][], y: number[], lambda = 2): RidgeModel {
  const p = X[0].length;
  const mean = Array(p).fill(0);
  const std = Array(p).fill(0);
  X.forEach((r) => r.forEach((v, j) => (mean[j] += v / X.length)));
  X.forEach((r) => r.forEach((v, j) => (std[j] += (v - mean[j]) ** 2 / X.length)));
  for (let j = 0; j < p; j++) std[j] = Math.sqrt(std[j]) || 1;
  const Z = X.map((r) => r.map((v, j) => (v - mean[j]) / std[j]));
  const ym = y.reduce((a, b) => a + b, 0) / y.length;
  const A = Array.from({ length: p }, () => Array(p).fill(0));
  const b = Array(p).fill(0);
  for (let i = 0; i < Z.length; i++) {
    for (let j = 0; j < p; j++) {
      b[j] += Z[i][j] * (y[i] - ym);
      for (let k = j; k < p; k++) A[j][k] += Z[i][j] * Z[i][k];
    }
  }
  for (let j = 0; j < p; j++) {
    for (let k = 0; k < j; k++) A[j][k] = A[k][j];
    A[j][j] += lambda;
  }
  return { mean, std, coef: solve(A, b), intercept: ym };
}

export function predict(m: RidgeModel, x: number[]) {
  return m.intercept + x.reduce((a, v, j) => a + ((v - m.mean[j]) / m.std[j]) * m.coef[j], 0);
}

/**
 * Train on all but the last 5 days, test on the last 5. Then forecast the next
 * 24 h recursively from now, feeding each prediction back as the next lag.
 */
export function trainAndForecast(nowHour: number) {
  const h0 = Math.floor(nowHour);
  const rows = cityHistory(30, h0);
  const X: number[][] = [];
  const y: number[] = [];
  const idx: number[] = [];
  for (let i = 24; i < rows.length; i++) {
    X.push(featureRow(rows[i - 1].pm25, rows[i - 2].pm25, rows[i - 24].pm25, rows[i]));
    y.push(rows[i].pm25);
    idx.push(i);
  }
  const split = X.length - 5 * 24;
  const model = trainRidge(X.slice(0, split), y.slice(0, split));
  const testX = X.slice(split);
  const testY = y.slice(split);
  const preds = testX.map((x) => predict(model, x));
  const err = preds.map((p, i) => p - testY[i]);
  const mae = err.reduce((a, e) => a + Math.abs(e), 0) / err.length;
  const rmse = Math.sqrt(err.reduce((a, e) => a + e * e, 0) / err.length);
  const ym = testY.reduce((a, b) => a + b, 0) / testY.length;
  const r2 = 1 - err.reduce((a, e) => a + e * e, 0) / testY.reduce((a, v) => a + (v - ym) ** 2, 0);
  const persistence = testX.reduce((a, x, i) => a + Math.abs(x[0] - testY[i]), 0) / testX.length;

  // 6-hour-ahead recursive skill on the test window.
  const ahead = 6;
  let e6 = 0;
  let p6 = 0;
  let n6 = 0;
  for (let k = split + 24; k + ahead < X.length; k += 3) {
    const start = idx[k];
    const hist = rows.slice(0, start).map((r) => r.pm25);
    for (let h = 0; h < ahead; h++) {
      const r = rows[start + h];
      const L = hist.length;
      hist.push(predict(model, featureRow(hist[L - 1], hist[L - 2], hist[L - 24], r)));
    }
    e6 += Math.abs(hist[hist.length - 1] - rows[start + ahead - 1].pm25);
    p6 += Math.abs(rows[start - 1].pm25 - rows[start + ahead - 1].pm25);
    n6++;
  }

  // Forecast next 24 h from now with the weather forecast.
  const hist = rows.map((r) => r.pm25);
  const fc: { day: number; hour: number; pm25: number; lo: number; hi: number }[] = [];
  for (let h = 1; h <= 24; h++) {
    const abs = h0 + h;
    const day = Math.floor(abs / 24);
    const hour = abs % 24;
    const w = weatherAt(day, hour);
    const next = { hour, w, traffic: demandProfile(hour) * ((day % 7) === 0 ? 0.7 : 1), stubble: stubbleIndex(day) };
    const L = hist.length;
    const p = predict(model, featureRow(hist[L - 1], hist[L - 2], hist[L - 24], next));
    hist.push(p);
    const band = 1.64 * rmse * Math.sqrt(h);
    fc.push({ day, hour, pm25: p, lo: Math.max(0, p - band), hi: p + band });
  }
  const importance = model.coef.map((c, j) => ({ feature: FEATURES[j], weight: c })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return {
    model,
    history: rows.slice(-48),
    test: { mae, rmse, r2, persistence, n: testY.length, mae6: n6 ? e6 / n6 : NaN, persistence6: n6 ? p6 / n6 : NaN },
    forecast: fc,
    importance,
    trainRows: split,
  };
}

/* ---------------------------------------------------------- source finding */

/** Mean PM2.5 at a station by wind direction over the last 72 h (pollution rose). */
export function pollutionRose(st: Station, nowHour: number) {
  const bins = Array.from({ length: 8 }, () => ({ sum: 0, n: 0 }));
  for (let k = 0; k < 72; k++) {
    const abs = Math.floor(nowHour) - k;
    const day = Math.floor(abs / 24);
    const hour = ((abs % 24) + 24) % 24;
    const r = stationReading(st, day, hour);
    const b = Math.round(r.weather.windFrom / 45) % 8;
    bins[b].sum += r.pm25;
    bins[b].n++;
  }
  return bins.map((b, i) => ({ dir: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][i], deg: i * 45, mean: b.n ? b.sum / b.n : 0, hours: b.n }));
}

export function likelySources(st: Station, rose: ReturnType<typeof pollutionRose>) {
  const top = [...rose].filter((r) => r.hours >= 2).sort((a, b) => b.mean - a.mean)[0];
  const local = SOURCES.map((s) => ({ ...s, bearing: bearing(st.x, st.y, s.x, s.y), km: (Math.hypot(s.x - st.x, s.y - st.y) * METRES_PER_UNIT) / 1000 }))
    .filter((s) => top && angDiff(s.bearing, top.deg) <= 40 && s.km < 4.5)
    .sort((a, b) => a.km - b.km);
  return { top, local };
}

function distSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
