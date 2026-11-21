"use client";

import React, { useMemo, useState } from "react";
import { Ambulance, Car, Clock, Gauge, MapPin, Route, Shuffle, Siren, TrafficCone, Video } from "lucide-react";
import { TrafficCanvas, type TrafficLayers } from "@/components/traffic/TrafficCanvas";
import { CameraFeed } from "@/components/traffic/CameraFeed";
import { FlowChip, FlowLegend, LiveBadge, Panel, Segmented, SimControls, StatTile, Toggle, WarmupNotice, flowColor } from "@/components/common/kit";
import { BarRow, Legend, LineChart } from "@/components/charts/LineChart";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { CAMERA_NODES, EDGES, NETWORK, NODES, POIS, nearestNode, sectorAt } from "@/lib/city/model";
import { useSim } from "@/lib/sim/runtime";
import { edgeLabel, junctionName } from "@/lib/city/labels";
import { TrafficSim, congestionLevel, demandProfile } from "@/lib/sim/traffic";
import { backtestMae, holtForecast, roadForecast } from "@/lib/sim/forecast";
import { cvCongestion, trueCongestion } from "@/lib/sim/vision";
import { useCity } from "@/lib/store/city-store";
import { clockLabel, cn, formatDuration, formatNumber } from "@/lib/utils";

const HORIZON = 15;

export default function TrafficPage() {
  const { sim } = useSim();
  const { toast } = useToast();
  const { pushAlert } = useCity();
  const [layers, setLayers] = useState<TrafficLayers>({ heat: true, vehicles: true, signals: true, cameras: true });
  const [camera, setCamera] = useState(CAMERA_NODES[0].node);
  const [junction, setJunction] = useState<number>(CAMERA_NODES[0].node);
  const [pickMode, setPickMode] = useState(false);
  const [hospital, setHospital] = useState(POIS.find((p) => p.kind === "hospital")!.id);
  const [cvStats, setCvStats] = useState<ReturnType<typeof cvCongestion> | null>(null);
  const s = sim.summary();

  const dispatch = (node: number) => {
    const h = POIS.find((p) => p.id === hospital)!;
    const sector = sectorAt(NODES[node].x + 1, NODES[node].y + 1);
    const label = `Cardiac call near ${junctionName(node)}`;
    const m = sim.dispatchAmbulance(h.node, node === h.node ? (node + 1) % NODES.length : node, label);
    if (!m) {
      toast({ tone: "error", title: "No route available", description: "That point is cut off — try another location." });
      return;
    }
    toast({ tone: "info", title: "Ambulance dispatched", description: `${h.name} → ${junctionName(node)}${m.priority ? " · green wave on" : ""}` });
    pushAlert({
      severity: "info",
      source: "traffic",
      title: `Ambulance en route from ${h.name}`,
      body: `${m.priority ? "Signal pre-emption active along the route; please give way." : "Priority off for comparison."}`,
      sector: sector?.id,
      public: false,
    });
  };

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4 pb-5 pt-7">
        <div className="max-w-[720px]">
          <div className="flex items-center gap-2">
            <h1 className="text-[28px] leading-9 text-ink">Traffic control</h1>
            <LiveBadge />
          </div>
          <p className="mt-1.5 text-[14px] leading-6 text-muted">
            {formatNumber(s.vehicles)} simulated vehicles on {EDGES.length / 2} road links and {s.signals} signalised junctions. Cameras estimate congestion, signals adapt to queues, ambulances get a green wave, and the next 15 minutes are forecast.
          </p>
        </div>
        <SimControls />
      </header>
      <WarmupNotice />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Vehicles on road" icon={<Car />} value={formatNumber(s.vehicles)} hint={`Demand ${Math.round(demandProfile(sim.hour) * 100)}% of peak`} />
        <StatTile label="Network speed" icon={<Gauge />} value={s.speedKmh.toFixed(1)} unit="km/h" hint="Vehicle-weighted mean" />
        <StatTile label="Congestion index" icon={<TrafficCone />} value={`${Math.round(s.congestion * 100)}`} unit="/100" hint={<FlowChip value={s.congestion} />} />
        <StatTile label="Vehicles queued" icon={<Clock />} value={`${Math.round(s.stoppedPct * 100)}%`} hint="Stopped at signals or in jams" />
        <StatTile label="Congested links" icon={<Route />} value={s.hotRoads} unit={`of ${EDGES.length}`} hint="Heavy or jammed carriageways" />
        <StatTile label="Average trip" icon={<Clock />} value={s.avgTripMin ? s.avgTripMin.toFixed(1) : "—"} unit="min" hint={`${s.tripsPerMin} trips completed / min`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <Panel
            title="Live network"
            description={pickMode ? "Click anywhere on the map to place the emergency." : "Hover a road for its live readings. Click a junction to inspect its signal."}
            action={
              <div className="flex flex-wrap items-center gap-3">
                <FlowLegend />
                <Segmented
                  ariaLabel="Map layers"
                  value={layers.heat ? "heat" : "plain"}
                  onChange={(v) => setLayers((l) => ({ ...l, heat: v === "heat" }))}
                  options={[
                    { id: "heat", label: "Heatmap" },
                    { id: "plain", label: "Plain" },
                  ]}
                />
                <Segmented
                  ariaLabel="Vehicles"
                  value={layers.vehicles ? "on" : "off"}
                  onChange={(v) => setLayers((l) => ({ ...l, vehicles: v === "on" }))}
                  options={[
                    { id: "on", label: "Vehicles" },
                    { id: "off", label: "Hide" },
                  ]}
                />
              </div>
            }
            bodyClassName="p-2"
          >
            <TrafficCanvas
              layers={layers}
              selectedNode={camera}
              pickMode={pickMode}
              onPickPoint={(x, y) => {
                setPickMode(false);
                dispatch(nearestNode(x, y));
              }}
              onPickNode={(n) => {
                setJunction(n);
                if (CAMERA_NODES.some((c) => c.node === n)) setCamera(n);
              }}
            />
          </Panel>

          <ForecastPanel sim={sim} />
        </div>

        <div className="min-w-0 space-y-4">
          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <Video className="h-4 w-4 text-muted" /> Camera congestion detection
              </span>
            }
            action={
              <Select value={camera} onChange={(e) => setCamera(Number(e.target.value))} className="w-48" aria-label="Camera">
                {CAMERA_NODES.map((c) => (
                  <option key={c.node} value={c.node}>
                    {c.name}
                  </option>
                ))}
              </Select>
            }
          >
            <CameraFeed node={camera} name={CAMERA_NODES.find((c) => c.node === camera)?.name ?? ""} onStats={setCvStats} />
            {cvStats ? (
              <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                <div>
                  <p className="text-muted">CV estimate</p>
                  <FlowChip value={cvStats.index} className="text-ink" />
                </div>
                <div>
                  <p className="text-muted">Occupancy</p>
                  <p className="tabular-nums text-ink">{Math.round(cvStats.occupancy * 100)}%</p>
                </div>
                <div>
                  <p className="text-muted">Stationary</p>
                  <p className="tabular-nums text-ink">{Math.round(cvStats.stoppedShare * 100)}%</p>
                </div>
              </div>
            ) : null}
            <div className="mt-4 border-t border-hair pt-3">
              <p className="eyebrow mb-2">All cameras · detector vs ground truth</p>
              <ul className="space-y-1.5">
                {CAMERA_NODES.map((c) => {
                  const truth = trueCongestion(sim, c.node);
                  return (
                    <li key={c.node}>
                      <button
                        type="button"
                        onClick={() => setCamera(c.node)}
                        className={cn("flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1 text-left text-[12px] hover:bg-surface-raised", camera === c.node && "bg-surface-raised")}
                      >
                        <span className="truncate text-ink">{c.name}</span>
                        <span className="flex shrink-0 items-center gap-3">
                          <FlowChip value={truth} />
                          <span className="w-14 text-right tabular-nums text-muted">{Math.round(truth * 100)}%</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Panel>

          <SignalsPanel sim={sim} junction={junction} />

          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <Ambulance className="h-4 w-4 text-muted" /> Emergency vehicle priority
              </span>
            }
          >
            <Toggle
              checked={sim.settings.preemption}
              onChange={(v) => (sim.settings.preemption = v)}
              label="Signal pre-emption (green wave)"
              hint="Junctions ahead of an ambulance turn green ~350 m out; traffic yields."
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Select value={hospital} onChange={(e) => setHospital(e.target.value)} className="min-w-0 flex-1" aria-label="Dispatching hospital">
                {POIS.filter((p) => p.kind === "hospital").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant={pickMode ? "primary" : "secondary"} onClick={() => setPickMode((p) => !p)}>
                <MapPin className="h-3.5 w-3.5" /> {pickMode ? "Click the map…" : "Place on map"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => dispatch(Math.floor(Math.random() * NODES.length))}>
                <Shuffle className="h-3.5 w-3.5" /> Random call
              </Button>
            </div>
            <ul className="mt-3 space-y-2">
              {sim.missions.length === 0 ? <li className="text-[12px] text-muted">No ambulances dispatched yet.</li> : null}
              {sim.missions.map((m) => {
                const done = m.arrivedAt !== undefined;
                const elapsed = (done ? m.arrivedAt! : sim.t) - m.dispatchedAt;
                const saved = m.estimateNoPriority - elapsed;
                return (
                  <li key={m.id} className="rounded-control border border-hair px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[12px] font-medium leading-5 text-ink">
                        <Siren className={cn("mr-1 inline h-3.5 w-3.5", done ? "text-muted" : "text-danger")} />
                        {m.label}
                      </p>
                      <span className="shrink-0 text-[11px] text-muted">{done ? "At hospital" : m.pickedUpAt ? "Transporting" : "To patient"}</span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full bg-danger transition-[width]" style={{ width: `${Math.round(m.progress * 100)}%` }} />
                    </div>
                    <p className="mt-1.5 text-[11px] leading-4 text-muted">
                      {done ? "Took" : "Elapsed"} {formatDuration(elapsed)} · without priority ≈ {formatDuration(m.estimateNoPriority)}
                      {m.priority ? ` · ${m.signalsCleared} signals cleared` : " · priority off"}
                      {done && m.priority && saved > 0 ? <span className="text-success"> · saved {formatDuration(saved)}</span> : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Demand and routing">
            <label className="block text-[13px] font-medium text-ink" htmlFor="fleet">
              Peak fleet: {formatNumber(sim.settings.peakVehicles)} vehicles
            </label>
            <input
              id="fleet"
              type="range"
              min={1000}
              max={9000}
              step={250}
              value={sim.settings.peakVehicles}
              onChange={(e) => (sim.settings.peakVehicles = Number(e.target.value))}
              className="mt-2 w-full"
            />
            <p className="text-[12px] text-muted">
              At {clockLabel(sim.t)} demand is {Math.round(demandProfile(sim.hour) * 100)}% of peak → target {formatNumber(sim.targetVehicles())} vehicles.
            </p>
            <Toggle
              checked={sim.settings.dynamicRouting}
              onChange={(v) => {
                sim.settings.dynamicRouting = v;
                sim.recomputeRoutes();
              }}
              label="Dynamic route guidance"
              hint="Every simulated minute, drivers re-route on live travel times."
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ forecast */

function ForecastPanel({ sim }: { sim: TrafficSim }) {
  const minutes = sim.minutes;
  const key = minutes.length ? minutes[minutes.length - 1].t : 0;
  const data = useMemo(() => {
    const hist = minutes.slice(-60);
    const series = minutes.map((m) => m.congestion * 100);
    const f = holtForecast(series.map((v) => v / 100), HORIZON, sim.hour);
    const labels = [...hist.map((m) => clockLabel(m.t)), ...Array.from({ length: HORIZON }, (_, h) => clockLabel(sim.t + (h + 1) * 60))];
    const actual = [...hist.map((m) => m.congestion * 100), ...Array(HORIZON).fill(null)];
    const fc = [...Array(Math.max(0, hist.length - 1)).fill(null), hist.length ? hist[hist.length - 1].congestion * 100 : null, ...f.mean.map((v) => v * 100)];
    const lo = [...Array(hist.length).fill(null), ...f.lo.map((v) => v * 100)];
    const hi = [...Array(hist.length).fill(null), ...f.hi.map((v) => v * 100)];
    const bt = backtestMae(series.map((v) => v / 100), HORIZON, (i) => (minutes[i].t / 3600) % 24, 30);

    // Per-road forecasts: where will it be worst in 15 minutes?
    const roads = EDGES.map((e) => {
      const now = sim.congestion[e.id];
      return { id: e.id, now, pred: roadForecast(sim.edgeSeries(e.id, 60), HORIZON, sim.hour) };
    })
      .sort((a, b) => b.pred - a.pred)
      .slice(0, 7);
    const rising = EDGES.map((e) => {
      const p = roadForecast(sim.edgeSeries(e.id, 60), 10, sim.hour);
      return { id: e.id, delta: p - sim.congestion[e.id], pred: p };
    })
      .filter((r) => r.pred >= 0.5 && r.delta > 0.05)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3);
    return { labels, actual, fc, lo, hi, f, bt, roads, rising, nowIndex: hist.length - 1 };
    // Recompute once per simulated minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const next15 = data.f.mean[HORIZON - 1] ?? 0;
  const next10 = data.f.mean[9] ?? 0;

  return (
    <Panel
      title="Congestion forecast · next 15 minutes"
      description="Damped-trend model on the live minute series, scaled by the known time-of-day demand curve."
      action={
        <Legend
          items={[
            { label: "Observed", color: "var(--series-1)" },
            { label: "Forecast", color: "var(--series-2)", dashed: true },
            { label: "90% band", color: "var(--series-2)", swatch: "box" },
          ]}
        />
      }
    >
      {minutes.length < 8 ? (
        <p className="py-10 text-center text-[13px] text-muted">Collecting a few minutes of history…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-control bg-sunken px-3 py-2">
              <p className="text-[12px] text-muted">In 10 min ({clockLabel(sim.t + 600)})</p>
              <p className="text-[18px] font-semibold tabular-nums text-ink">{Math.round(next10 * 100)}/100</p>
              <FlowChip value={next10} />
            </div>
            <div className="rounded-control bg-sunken px-3 py-2">
              <p className="text-[12px] text-muted">In 15 min ({clockLabel(sim.t + 900)})</p>
              <p className="text-[18px] font-semibold tabular-nums text-ink">{Math.round(next15 * 100)}/100</p>
              <FlowChip value={next15} />
            </div>
            <div className="rounded-control bg-sunken px-3 py-2">
              <p className="text-[12px] text-muted">Backtest, 15-min ahead</p>
              {data.bt ? (
                <>
                  <p className="text-[18px] font-semibold tabular-nums text-ink">±{(data.bt.mae * 100).toFixed(1)} pts</p>
                  <p className="text-[12px] text-muted">
                    Naive “no change”: ±{(data.bt.naiveMae * 100).toFixed(1)} · {data.bt.n} origins
                  </p>
                </>
              ) : (
                <p className="text-[13px] text-muted">Needs 30+ min of history</p>
              )}
            </div>
          </div>
          <LineChart
            className="mt-3"
            ariaLabel="Network congestion index, last hour and 15-minute forecast"
            xLabels={data.labels}
            series={[
              { name: "Observed", values: data.actual, color: "var(--series-1)" },
              { name: "Forecast", values: data.fc, color: "var(--series-2)", dashed: true },
            ]}
            band={{ lo: data.lo, hi: data.hi, color: "var(--series-2)", label: "90% band" }}
            nowIndex={data.nowIndex}
            yMin={0}
            yMax={Math.max(60, Math.ceil(Math.max(...data.hi.filter((v): v is number => v != null), ...data.actual.filter((v): v is number => v != null)) / 10) * 10)}
            yFormat={(v) => `${Math.round(v)}`}
            thresholds={[{ value: 50, label: "Heavy" }]}
            height={210}
          />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="eyebrow mb-2">Predicted worst roads at {clockLabel(sim.t + 900)}</p>
              <div className="space-y-2.5">
                {data.roads.map((r) => (
                  <BarRow
                    key={r.id}
                    label={edgeLabel(r.id)}
                    value={r.pred}
                    max={1}
                    color={flowColor(r.pred)}
                    display={`${Math.round(r.now * 100)} → ${Math.round(r.pred * 100)} · ${congestionLevel(r.pred).label}`}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="eyebrow mb-2">Early warnings · building fastest</p>
              {data.rising.length ? (
                <ul className="space-y-2">
                  {data.rising.map((r) => (
                    <li key={r.id} className="rounded-control border border-hair px-3 py-2 text-[12px]">
                      <p className="font-medium text-ink">{edgeLabel(r.id)}</p>
                      <p className="text-muted">
                        Expected to reach {congestionLevel(r.pred).label.toLowerCase()} ({Math.round(r.pred * 100)}) within 10 min · +{Math.round(r.delta * 100)} pts
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-muted">No road is forecast to tip into heavy congestion in the next 10 minutes.</p>
              )}
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------- signals */

function SignalsPanel({ sim, junction }: { sim: TrafficSim; junction: number }) {
  const [bench, setBench] = useState<null | { fixed: { speed: number; queued: number; trip: number }; adaptive: { speed: number; queued: number; trip: number } }>(null);
  const [running, setRunning] = useState(false);

  const queueFor = (node: number, dir: "h" | "v") =>
    NETWORK.inEdges[node].filter((e) => EDGES[e].dir === dir).reduce((a, e) => a + sim.edgeStopped[e], 0);

  const busiest = NODES.filter((n) => sim.signalised[n.id])
    .map((n) => ({ id: n.id, ns: queueFor(n.id, "v"), ew: queueFor(n.id, "h") }))
    .sort((a, b) => b.ns + b.ew - (a.ns + a.ew))
    .slice(0, 4);

  const runBench = () => {
    setRunning(true);
    window.setTimeout(() => {
      const res = (adaptive: boolean) => {
        const t = new TrafficSim({ ...sim.settings, adaptive, preemption: false }, sim.t - 1800);
        for (let i = 0; i < 4200; i++) t.step();
        const sm = t.minutes.slice(-30);
        const avg = (f: (m: (typeof sm)[number]) => number) => sm.reduce((a, m) => a + f(m), 0) / sm.length;
        return { speed: avg((m) => m.speedKmh), queued: avg((m) => m.stoppedPct), trip: t.summary().avgTripMin };
      };
      setBench({ fixed: res(false), adaptive: res(true) });
      setRunning(false);
    }, 30);
  };

  const ns = queueFor(junction, "v");
  const ew = queueFor(junction, "h");
  const signalised = sim.signalised[junction] === 1;
  const amber = sim.amber[junction] > 0;
  const green = amber ? "Amber / all-red" : sim.phase[junction] === 0 ? "North–South green" : "East–West green";

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <TrafficCone className="h-4 w-4 text-muted" /> Adaptive signal control
        </span>
      }
    >
      <Segmented
        ariaLabel="Signal mode"
        value={sim.settings.adaptive ? "adaptive" : "fixed"}
        onChange={(v) => (sim.settings.adaptive = v === "adaptive")}
        options={[
          { id: "adaptive", label: "Adaptive (queue-based)" },
          { id: "fixed", label: "Fixed 30 s cycle" },
        ]}
      />
      <p className="mt-2 text-[12px] leading-5 text-muted">
        Adaptive mode is a max-pressure controller: after a 10 s minimum green it switches when the waiting queue is 1.5× the moving one, capped at 75 s.
      </p>

      <div className="mt-3 rounded-control border border-hair p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[13px] font-medium text-ink">{junctionName(junction)}</p>
            <p className="text-[12px] text-muted">
              {signalised ? `${green} · ${sim.elapsed[junction]} s` : "Uncontrolled corner"}
              {sim.preemptUntil[junction] > sim.tick ? <span className="text-danger"> · pre-empted</span> : null}
            </p>
          </div>
          <JunctionGlyph phase={sim.phase[junction]} amber={amber} signalised={signalised} />
        </div>
        <div className="mt-2 space-y-2">
          <BarRow label="North–South queue" value={ns} max={Math.max(20, ns, ew)} display={`${ns} veh`} color="var(--series-1)" />
          <BarRow label="East–West queue" value={ew} max={Math.max(20, ns, ew)} display={`${ew} veh`} color="var(--series-2)" />
        </div>
        <p className="mt-2 text-[11px] text-muted">Click any junction on the map to inspect it.</p>
      </div>

      <p className="eyebrow mb-1.5 mt-4">Longest queues now</p>
      <ul className="space-y-1">
        {busiest.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="truncate text-ink">{junctionName(b.id)}</span>
            <span className="shrink-0 tabular-nums text-muted">
              NS {b.ns} · EW {b.ew}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-hair pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-ink">A/B benchmark</p>
          <Button size="sm" variant="secondary" loading={running} onClick={runBench}>
            Run 70 min
          </Button>
        </div>
        <p className="text-[12px] text-muted">Replays the same demand twice, fixed vs adaptive, from 30 minutes ago.</p>
        {bench ? (
          <table className="mt-2 w-full text-[12px]">
            <thead>
              <tr className="text-muted">
                <th className="py-1 text-left font-normal"></th>
                <th className="py-1 text-right font-normal">Fixed</th>
                <th className="py-1 text-right font-normal">Adaptive</th>
                <th className="py-1 text-right font-normal">Change</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <tr>
                <td className="py-0.5 text-ink">Mean speed</td>
                <td className="text-right">{bench.fixed.speed.toFixed(1)} km/h</td>
                <td className="text-right">{bench.adaptive.speed.toFixed(1)} km/h</td>
                <td className="text-right text-ink">{pct(bench.adaptive.speed, bench.fixed.speed)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-ink">Queued share</td>
                <td className="text-right">{Math.round(bench.fixed.queued * 100)}%</td>
                <td className="text-right">{Math.round(bench.adaptive.queued * 100)}%</td>
                <td className="text-right text-ink">{pct(bench.adaptive.queued, bench.fixed.queued)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-ink">Average trip</td>
                <td className="text-right">{bench.fixed.trip.toFixed(1)} min</td>
                <td className="text-right">{bench.adaptive.trip.toFixed(1)} min</td>
                <td className="text-right text-ink">{pct(bench.adaptive.trip, bench.fixed.trip)}</td>
              </tr>
            </tbody>
          </table>
        ) : null}
      </div>
    </Panel>
  );
}

function pct(a: number, b: number) {
  if (!b) return "—";
  const d = ((a - b) / b) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`;
}

function JunctionGlyph({ phase, amber, signalised }: { phase: number; amber: boolean; signalised: boolean }) {
  const c = (green: boolean) => (!signalised ? "var(--muted)" : amber ? "var(--flow-moderate)" : green ? "var(--flow-free)" : "var(--flow-jam)");
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <rect x="17" y="0" width="10" height="44" fill="var(--map-arterial)" />
      <rect x="0" y="17" width="44" height="10" fill="var(--map-arterial)" />
      <circle cx="22" cy="8" r="3" fill={c(phase === 0)} />
      <circle cx="22" cy="36" r="3" fill={c(phase === 0)} />
      <circle cx="8" cy="22" r="3" fill={c(phase === 1)} />
      <circle cx="36" cy="22" r="3" fill={c(phase === 1)} />
    </svg>
  );
}
