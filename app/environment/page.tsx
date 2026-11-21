"use client";

import React, { useMemo, useState } from "react";
import { Brain, CloudFog, Factory, Leaf, Thermometer, Volume2, Wind } from "lucide-react";
import { CityMap, FieldImage } from "@/components/map/CityMap";
import { Panel, Segmented, SimControls, StatTile } from "@/components/common/kit";
import { BarRow, Legend, LineChart } from "@/components/charts/LineChart";
import { SECTORS, SOURCES, sectorLabel, type LandUse } from "@/lib/city/model";
import { useSim } from "@/lib/sim/runtime";
import {
  AQI_BANDS,
  FC,
  FR,
  STATIONS,
  aqi,
  aqiBand,
  computeField,
  likelySources,
  liveTrafficAt,
  noiseAt,
  pollutionRose,
  stationReading,
  temperatureAt,
  trainAndForecast,
  weatherAt,
} from "@/lib/sim/environment";
import { cn, hexToRgb, rampColor } from "@/lib/utils";

type Layer = "aqi" | "pm25" | "pm10" | "noise" | "temp" | "green";

const RAMPS: Record<"noise" | "temp" | "green", { stops: string[]; min: number; max: number; unit: string; label: string }> = {
  noise: { stops: ["#efe6f3", "#c39ad3", "#8a4dab", "#4f1b6d"], min: 45, max: 80, unit: "dB(A)", label: "Noise level" },
  temp: { stops: ["#fff1cf", "#f6bd64", "#e0702a", "#a3311a"], min: 0, max: 0, unit: "°C", label: "Air temperature" },
  green: { stops: ["#f1f6ea", "#b3d896", "#58a14e", "#1d5a2a"], min: 0, max: 85, unit: "% canopy", label: "Green cover" },
};

const USE_LABEL: Partial<Record<LandUse, string>> = {
  residential: "Residential",
  mixed: "Mixed use",
  commercial: "Commercial",
  industrial: "Industrial",
  institutional: "Institutional",
  green: "Parks & forest",
};

export default function EnvironmentPage() {
  const { sim } = useSim();
  const [layer, setLayer] = useState<Layer>("aqi");
  const [stationId, setStationId] = useState(STATIONS[14].id);
  const hour = (sim.t / 3600) % 24;
  const minuteKey = Math.floor(sim.t / 60);
  const hourKey = Math.floor(sim.t / 3600);

  const readings = useMemo(
    () =>
      STATIONS.map((st) => {
        const r = stationReading(st, 0, hour, liveTrafficAt(sim, st.x, st.y));
        return { ...st, ...r };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minuteKey]
  );
  const w = weatherAt(0, hour);

  const field = useMemo(() => computeField(layer, hour, sim, readings), [layer, readings]); // eslint-disable-line react-hooks/exhaustive-deps
  const tempRange = useMemo(() => {
    if (layer !== "temp") return [0, 1];
    let mn = Infinity;
    let mx = -Infinity;
    field.forEach((v) => ((mn = Math.min(mn, v)), (mx = Math.max(mx, v))));
    return [Math.floor(mn), Math.ceil(mx)];
  }, [field, layer]);

  const colorFn = useMemo(() => {
    if (layer === "aqi" || layer === "pm25" || layer === "pm10") {
      return (v: number): [number, number, number, number] => {
        const a = layer === "aqi" ? v : layer === "pm25" ? aqi(v, 0).aqi : aqi(0, v).aqi;
        const [r, g, b] = hexToRgb(aqiBand(a).color);
        return [r, g, b, 150];
      };
    }
    const ramp = RAMPS[layer];
    const [mn, mx] = layer === "temp" ? tempRange : [ramp.min, ramp.max];
    return (v: number): [number, number, number, number] => {
      if (layer === "green" && v <= 0) return [0, 0, 0, 0];
      const [r, g, b] = rampColor(ramp.stops, (v - mn) / (mx - mn || 1));
      return [r, g, b, 175];
    };
  }, [layer, tempRange]);

  const station = readings.find((r) => r.id === stationId)!;
  const band = aqiBand(station.aqi);
  const cityAqi = Math.round(readings.reduce((a, r) => a + r.aqi, 0) / readings.length);
  const cityPm25 = readings.reduce((a, r) => a + r.pm25, 0) / readings.length;
  const cityPm10 = readings.reduce((a, r) => a + r.pm10, 0) / readings.length;
  const worst = [...readings].sort((a, b) => b.aqi - a.aqi)[0];
  const rose = useMemo(() => pollutionRose(station, hourKey), [station.id, hourKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const suspects = likelySources(station, rose);
  const contrib = station.contributions;
  const totalC = contrib.regional + contrib.traffic + contrib.industry + contrib.construction;

  const ml = useMemo(() => trainAndForecast(hourKey % 24 + 0.01), [hourKey]);
  const avgNoise = useMemo(() => readings.reduce((a, r) => a + noiseAt(r.x, r.y, hour, sim), 0) / readings.length, [readings]); // eslint-disable-line react-hooks/exhaustive-deps
  const avgTemp = useMemo(() => SECTORS.reduce((a, s) => a + temperatureAt(s.cx, s.cy, 0, hour), 0) / SECTORS.length, [minuteKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const peakFc = ml.forecast.reduce((a, f) => (f.pm25 > a.pm25 ? f : a), ml.forecast[0]);

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4 pb-5 pt-7">
        <div className="max-w-[760px]">
          <h1 className="text-[28px] leading-9 text-ink">Environment</h1>
          <p className="mt-1.5 text-[14px] leading-6 text-muted">
            {STATIONS.length} continuous air-quality stations, noise and temperature layers, green cover by sector, source identification and a machine-learning PM2.5 forecast. Local traffic comes from the live simulation.
          </p>
        </div>
        <SimControls />
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="City AQI (CPCB)" icon={<CloudFog />} value={cityAqi} hint={<AqiChip value={cityAqi} />} />
        <StatTile label="PM2.5" value={cityPm25.toFixed(0)} unit="µg/m³" hint={`${(cityPm25 / 15).toFixed(0)}× WHO 24-h guideline`} />
        <StatTile label="PM10" value={cityPm10.toFixed(0)} unit="µg/m³" hint="Station average" />
        <StatTile label="Worst station" icon={<Factory />} value={worst.aqi} hint={worst.name.replace("CAAQMS ", "")} />
        <StatTile label="Noise (stations)" icon={<Volume2 />} value={avgNoise.toFixed(0)} unit="dB(A)" hint="Day limit, residential: 55" />
        <StatTile label="Temperature" icon={<Thermometer />} value={avgTemp.toFixed(1)} unit="°C" hint={`Wind ${compass(w.windFrom)} ${w.windSpeed.toFixed(1)} m/s · RH ${Math.round(w.rh)}%`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <Panel
            title="City layers"
            description={layer === "aqi" || layer === "pm25" || layer === "pm10" ? "Interpolated from station readings (inverse-distance weighting). Click a station." : layer === "noise" ? "Modelled from live traffic, industry and construction." : layer === "temp" ? "Urban heat island: built-up mass warms, canopy and water cool." : "Tree canopy share per sector."}
            action={
              <Segmented
                ariaLabel="Layer"
                value={layer}
                onChange={setLayer}
                options={[
                  { id: "aqi", label: "AQI" },
                  { id: "pm25", label: "PM2.5" },
                  { id: "pm10", label: "PM10" },
                  { id: "noise", label: "Noise" },
                  { id: "temp", label: "Temperature" },
                  { id: "green", label: "Green cover" },
                ]}
              />
            }
            bodyClassName="p-2"
          >
            <CityMap dimSectors under={<FieldImage field={field} cols={FC} rows={FR} color={colorFn} opacity={0.9} />} ariaLabel={`${layer} map`}>
              {SOURCES.map((s) => (
                <g key={s.id} transform={`translate(${s.x},${s.y})`}>
                  <title>{s.name}</title>
                  <rect x={-7} y={-7} width={14} height={14} rx={3} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.5} />
                  <text y={4} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--ink)">
                    {s.kind === "industrial" ? "I" : "C"}
                  </text>
                </g>
              ))}
              {(layer === "aqi" || layer === "pm25" || layer === "pm10" || layer === "noise") &&
                readings.map((r) => {
                  const v = layer === "aqi" ? r.aqi : layer === "pm25" ? Math.round(r.pm25) : layer === "pm10" ? Math.round(r.pm10) : Math.round(noiseAt(r.x, r.y, hour, sim));
                  const sel = r.id === stationId;
                  return (
                    <g key={r.id} transform={`translate(${r.x},${r.y})`} onClick={() => setStationId(r.id)} style={{ cursor: "pointer" }}>
                      <title>{`${r.name}: AQI ${r.aqi}`}</title>
                      <circle r={sel ? 17 : 14} fill={layer === "noise" ? "var(--surface)" : aqiBand(r.aqi).color} stroke={sel ? "var(--ink)" : "var(--surface)"} strokeWidth={sel ? 3 : 2} />
                      <text y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill={layer === "noise" ? "var(--ink)" : r.aqi > 100 && r.aqi <= 300 ? "#1a1a1a" : "#fff"}>
                        {v}
                      </text>
                    </g>
                  );
                })}
              <WindRose from={w.windFrom} speed={w.windSpeed} />
            </CityMap>
            <LayerLegend layer={layer} tempRange={tempRange} />
          </Panel>

          <Panel
            title={<span className="inline-flex items-center gap-2"><Brain className="h-4 w-4 text-muted" /> PM2.5 forecast · machine learning</span>}
            description={`Ridge regression on ${ml.trainRows} hourly samples (lags, hour of day, wind, temperature, mixing height, traffic, regional fire activity); tested on the last 5 days.`}
            action={
              <Legend
                items={[
                  { label: "Observed", color: "var(--series-1)" },
                  { label: "Forecast", color: "var(--series-2)", dashed: true },
                  { label: "90% interval", color: "var(--series-2)", swatch: "box" },
                ]}
              />
            }
          >
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label="1-h ahead MAE" value={`${ml.test.mae.toFixed(1)} µg/m³`} hint={`Persistence ${ml.test.persistence.toFixed(1)}`} />
              <Metric label="6-h ahead MAE" value={`${ml.test.mae6.toFixed(1)} µg/m³`} hint={`Persistence ${ml.test.persistence6.toFixed(1)}`} />
              <Metric label="R² (test)" value={ml.test.r2.toFixed(2)} hint={`${ml.test.n} test hours`} />
              <Metric label="Peak next 24 h" value={`${Math.round(peakFc.pm25)} µg/m³`} hint={`${String(peakFc.hour).padStart(2, "0")}:00 · ${aqiBand(aqi(peakFc.pm25, 0).aqi).label}`} />
            </div>
            <LineChart
              className="mt-3"
              ariaLabel="City PM2.5: last 48 hours and 24-hour forecast"
              xLabels={[...ml.history.map((r) => `${r.day === 0 ? "" : r.day === -1 ? "Yday " : `D${r.day} `}${String(r.hour).padStart(2, "0")}:00`), ...ml.forecast.map((f) => `${f.day > 0 ? "Tmrw " : ""}${String(f.hour).padStart(2, "0")}:00`)]}
              series={[
                { name: "Observed", values: [...ml.history.map((r) => r.pm25), ...ml.forecast.map(() => null)], color: "var(--series-1)" },
                { name: "Forecast", values: [...ml.history.map((_, i) => (i === ml.history.length - 1 ? ml.history[i].pm25 : null)), ...ml.forecast.map((f) => f.pm25)], color: "var(--series-2)", dashed: true },
              ]}
              band={{ lo: [...ml.history.map(() => null), ...ml.forecast.map((f) => f.lo)], hi: [...ml.history.map(() => null), ...ml.forecast.map((f) => f.hi)], color: "var(--series-2)", label: "90% interval" }}
              nowIndex={ml.history.length - 1}
              yMin={0}
              thresholds={[
                { value: 60, label: "Satisfactory limit (60)" },
                { value: 120, label: "Very poor above 120" },
              ]}
              yFormat={(v) => `${Math.round(v)}`}
              height={220}
            />
            <div className="mt-4">
              <p className="eyebrow mb-2">What drives the prediction (standardised weights)</p>
              <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                {ml.importance.slice(0, 8).map((f) => (
                  <BarRow
                    key={f.feature}
                    label={f.feature}
                    value={Math.abs(f.weight)}
                    max={Math.abs(ml.importance[0].weight)}
                    display={`${f.weight >= 0 ? "raises" : "lowers"} · ${Math.abs(f.weight).toFixed(1)}`}
                    color={f.weight >= 0 ? "var(--series-2)" : "var(--series-1)"}
                  />
                ))}
              </div>
            </div>
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel title={station.name} description={sectorLabel(SECTORS[station.sector])}>
            <div className="flex items-center gap-4">
              <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full text-center" style={{ background: band.color }}>
                <span className={cn("text-[26px] font-semibold leading-none", station.aqi > 100 && station.aqi <= 300 ? "text-[#1a1a1a]" : "text-white")}>
                  {station.aqi}
                  <span className="block text-[10px] font-medium uppercase tracking-wide">AQI</span>
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-ink">{band.label}</p>
                <p className="text-[12px] leading-5 text-muted">{band.advice}</p>
                <p className="mt-1 text-[12px] text-muted">Dominant: {station.dominant}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label="PM2.5" value={`${station.pm25.toFixed(0)} µg/m³`} hint="24-h standard 60" />
              <Metric label="PM10" value={`${station.pm10.toFixed(0)} µg/m³`} hint="24-h standard 100" />
            </div>

            <p className="eyebrow mb-2 mt-4">Source apportionment (model)</p>
            <div className="space-y-2.5">
              <BarRow label="Regional smoke & background" value={contrib.regional} max={totalC} display={`${Math.round((contrib.regional / totalC) * 100)}%`} color="var(--series-1)" />
              <BarRow label="Local traffic" value={contrib.traffic} max={totalC} display={`${Math.round((contrib.traffic / totalC) * 100)}%`} color="var(--series-1)" />
              <BarRow label="Industry" value={contrib.industry} max={totalC} display={`${Math.round((contrib.industry / totalC) * 100)}%`} color="var(--series-1)" />
              <BarRow label="Construction dust" value={contrib.construction} max={totalC} display={`${Math.round((contrib.construction / totalC) * 100)}%`} color="var(--series-1)" />
            </div>

            <p className="eyebrow mb-1 mt-5">Pollution rose · last 72 h</p>
            <div className="flex items-center gap-4">
              <PollutionRose rose={rose} />
              <div className="min-w-0 text-[12px] leading-5">
                {suspects.top ? (
                  <>
                    <p className="text-ink">
                      Highest PM2.5 when wind blows from the <span className="font-semibold">{suspects.top.dir}</span> ({Math.round(suspects.top.mean)} µg/m³).
                    </p>
                    {suspects.local.length ? (
                      <ul className="mt-1.5 space-y-1 text-muted">
                        {suspects.local.slice(0, 3).map((s) => (
                          <li key={s.id}>
                            <Factory className="mr-1 inline h-3 w-3" />
                            {s.name} · {s.km.toFixed(1)} km
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1.5 text-muted">No local source in that direction — likely regional transport (crop-residue smoke).</p>
                    )}
                  </>
                ) : (
                  <p className="text-muted">Collecting wind data…</p>
                )}
              </div>
            </div>
          </Panel>

          <Panel title="All stations" bodyClassName="p-0">
            <ul className="max-h-[360px] divide-y divide-hair overflow-y-auto">
              {[...readings]
                .sort((a, b) => b.aqi - a.aqi)
                .map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setStationId(r.id)} className={cn("flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-raised", r.id === stationId && "bg-surface-raised")}>
                      <span className="grid h-8 w-11 shrink-0 place-items-center rounded-[6px] text-[12px] font-semibold" style={{ background: aqiBand(r.aqi).color, color: r.aqi > 100 && r.aqi <= 300 ? "#1a1a1a" : "#fff" }}>
                        {r.aqi}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink">{r.name.replace("CAAQMS ", "")}</span>
                        <span className="block text-[11px] text-muted">
                          {aqiBand(r.aqi).label} · PM2.5 {r.pm25.toFixed(0)} · PM10 {r.pm10.toFixed(0)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </Panel>

          <GreenPanel hour={hour} />
        </div>
      </div>
    </div>
  );
}

function GreenPanel({ hour }: { hour: number }) {
  const byUse = useMemo(() => {
    const m = new Map<string, { sum: number; n: number }>();
    for (const s of SECTORS) {
      const k = USE_LABEL[s.use];
      if (!k) continue;
      const a = m.get(k) ?? { sum: 0, n: 0 };
      a.sum += s.greenCover;
      a.n++;
      m.set(k, a);
    }
    return [...m.entries()].map(([k, a]) => ({ k, v: a.sum / a.n })).sort((a, b) => b.v - a.v);
  }, []);
  const { slope, r } = useMemo(() => {
    const pts = SECTORS.filter((s) => s.use !== "water").map((s) => [s.greenCover, temperatureAt(s.cx, s.cy, 0, hour)]);
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (const [x, y] of pts) {
      sxy += (x - mx) * (y - my);
      sxx += (x - mx) ** 2;
      syy += (y - my) ** 2;
    }
    return { slope: sxy / sxx, r: sxy / Math.sqrt(sxx * syy) };
  }, [hour]);
  const lowest = [...SECTORS].filter((s) => s.population > 5000).sort((a, b) => a.greenCover - b.greenCover).slice(0, 4);
  return (
    <Panel title={<span className="inline-flex items-center gap-2"><Leaf className="h-4 w-4 text-muted" /> Green cover analysis</span>}>
      <div className="space-y-2.5">
        {byUse.map((u) => (
          <BarRow key={u.k} label={u.k} value={u.v} max={100} display={`${u.v.toFixed(0)}% canopy`} color="var(--series-3)" />
        ))}
      </div>
      <p className="mt-3 rounded-control bg-sunken px-3 py-2 text-[12px] leading-5 text-ink">
        Each +10 points of canopy is associated with <span className="font-semibold">{(slope * 10).toFixed(2)} °C</span> air temperature across sectors right now (r = {r.toFixed(2)}).
      </p>
      <p className="eyebrow mb-1.5 mt-3">Priority sectors for planting</p>
      <ul className="space-y-1 text-[12px]">
        {lowest.map((s) => (
          <li key={s.id} className="flex justify-between gap-2">
            <span className="text-ink">{sectorLabel(s)}</span>
            <span className="tabular-nums text-muted">
              {s.greenCover}% · {(s.population / 1000).toFixed(0)}k residents
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-control bg-sunken px-3 py-2">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="text-[16px] font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

function AqiChip({ value }: { value: number }) {
  const b = aqiBand(value);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: b.color }} aria-hidden="true" />
      {b.label}
    </span>
  );
}

function compass(deg: number) {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

function WindRose({ from, speed }: { from: number; speed: number }) {
  return (
    <g transform="translate(985,58)" style={{ pointerEvents: "none" }}>
      <circle r={26} fill="var(--surface)" opacity={0.9} stroke="var(--hair-strong)" />
      <g transform={`rotate(${from + 180})`}>
        <path d="M0,16 L0,-14 M-6,-6 L0,-15 L6,-6" stroke="var(--ink)" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text y={42} textAnchor="middle" fontSize={11} fill="var(--muted)">
        {compass(from)} wind {speed.toFixed(1)} m/s
      </text>
    </g>
  );
}

function PollutionRose({ rose }: { rose: { dir: string; deg: number; mean: number; hours: number }[] }) {
  const max = Math.max(1, ...rose.map((r) => r.mean));
  const R = 52;
  return (
    <svg width={124} height={124} viewBox="-62 -62 124 124" className="shrink-0" role="img" aria-label="Pollution rose">
      {[0.33, 0.66, 1].map((k) => (
        <circle key={k} r={R * k} fill="none" stroke="var(--grid)" />
      ))}
      {rose.map((r) => {
        if (!r.hours) return null;
        const len = (r.mean / max) * R;
        const a0 = ((r.deg - 20 - 90) * Math.PI) / 180;
        const a1 = ((r.deg + 20 - 90) * Math.PI) / 180;
        return (
          <path key={r.dir} d={`M0,0 L${Math.cos(a0) * len},${Math.sin(a0) * len} A${len},${len} 0 0 1 ${Math.cos(a1) * len},${Math.sin(a1) * len} Z`} fill="var(--series-2)" opacity={0.85}>
            <title>{`${r.dir}: ${Math.round(r.mean)} µg/m³ over ${r.hours} h`}</title>
          </path>
        );
      })}
      {["N", "E", "S", "W"].map((d, i) => (
        <text key={d} x={[0, R + 5, 0, -R - 5][i]} y={[-R - 2, 4, R + 9, 4][i]} textAnchor="middle" fontSize={9} fill="var(--muted)">
          {d}
        </text>
      ))}
    </svg>
  );
}

function LayerLegend({ layer, tempRange }: { layer: Layer; tempRange: number[] }) {
  if (layer === "aqi" || layer === "pm25" || layer === "pm10") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2 text-[12px] text-muted">
        {AQI_BANDS.map((b, i) => (
          <span key={b.label} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: b.color }} />
            {b.label} {i === 0 ? "0–50" : `${AQI_BANDS[i - 1].max + 1}–${b.max}`}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <Wind className="h-3 w-3" /> I = industry · C = construction
        </span>
      </div>
    );
  }
  const ramp = RAMPS[layer];
  const [mn, mx] = layer === "temp" ? tempRange : [ramp.min, ramp.max];
  return (
    <div className="flex items-center gap-3 px-2 py-2 text-[12px] text-muted">
      <span>{ramp.label}</span>
      <span className="tabular-nums">{mn}</span>
      <span className="h-2 w-48 rounded-full" style={{ background: `linear-gradient(90deg, ${ramp.stops.join(",")})` }} />
      <span className="tabular-nums">
        {mx} {ramp.unit}
      </span>
    </div>
  );
}
