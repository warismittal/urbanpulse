"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Bell, Car, Cctv, CloudFog, Gauge, LayoutDashboard, Siren, Smartphone, TrafficCone, TreePine } from "lucide-react";
import { TrafficCanvas } from "@/components/traffic/TrafficCanvas";
import { FlowChip, FlowLegend, LiveBadge, Panel, SimControls, StatTile, WarmupNotice } from "@/components/common/kit";
import { LineChart } from "@/components/charts/LineChart";
import { CAMERA_NODES } from "@/lib/city/model";
import { useSim } from "@/lib/sim/runtime";
import { STATIONS, aqiBand, liveTrafficAt, stationReading } from "@/lib/sim/environment";
import { SCENES } from "@/lib/sim/surveillance";
import { complaintStage, useCity, useNow } from "@/lib/store/city-store";
import { clockLabel, cn, formatAgo, formatNumber } from "@/lib/utils";

const MODULES = [
  { href: "/traffic", title: "Traffic control", icon: TrafficCone, body: "Vehicle simulation, camera-based congestion detection, adaptive signals, ambulance green wave, 15-minute forecast." },
  { href: "/emergency", title: "Emergency simulation", icon: Siren, body: "Fire, flood, road accident, gas leak, earthquake and evacuation scenarios with responders and public warnings." },
  { href: "/surveillance", title: "Video analytics", icon: Cctv, body: "Illegal parking, accidents, number plates, crowd density, dumping, unattended objects and intrusions." },
  { href: "/environment", title: "Environment", icon: TreePine, body: "AQI, PM2.5 and PM10, source identification, noise, temperature and green cover, ML pollution forecast." },
  { href: "/citizen", title: "Citizen app", icon: Smartphone, body: "Report potholes, garbage and leaks; track resolution; nearby services, buses, traffic, air and alerts." },
];

export default function DashboardPage() {
  const { sim } = useSim();
  const { alerts, complaints } = useCity();
  const now = useNow(5000);
  const s = sim.summary();
  const minuteKey = Math.floor(sim.t / 60);
  const air = useMemo(() => {
    const hour = (sim.t / 3600) % 24;
    const rs = STATIONS.map((st) => stationReading(st, 0, hour, liveTrafficAt(sim, st.x, st.y)));
    return { aqi: Math.round(rs.reduce((a, r) => a + r.aqi, 0) / rs.length), worst: Math.max(...rs.map((r) => r.aqi)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minuteKey]);
  const openComplaints = complaints.filter((c) => complaintStage(c, now).stage !== "resolved").length;
  const activeAlerts = alerts.filter((a) => now - a.ts < 30 * 60_000);
  const hist = sim.minutes.slice(-120);

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4 pb-5 pt-7">
        <div className="max-w-[760px]">
          <p className="eyebrow inline-flex items-center gap-1.5">
            <LayoutDashboard className="h-3.5 w-3.5" /> Integrated command and control centre
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-[32px] leading-10 text-ink">Good {greeting(sim.t)}, operator</h1>
            <LiveBadge />
          </div>
          <p className="mt-1.5 text-[14px] leading-6 text-muted">
            A live digital twin of a 48-sector planned city: {formatNumber(s.vehicles)} vehicles on the road, {STATIONS.length} air stations, {SCENES.length + CAMERA_NODES.length} cameras and the citizen app — all connected.
          </p>
        </div>
        <SimControls />
      </header>
      <WarmupNotice />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Vehicles on road" icon={<Car />} value={formatNumber(s.vehicles)} hint={`${s.tripsPerMin} trips / min`} />
        <StatTile label="Network speed" icon={<Gauge />} value={s.speedKmh.toFixed(1)} unit="km/h" hint={<FlowChip value={s.congestion} />} />
        <StatTile label="City AQI" icon={<CloudFog />} value={air.aqi} hint={`${aqiBand(air.aqi).label} · worst ${air.worst}`} tone={air.aqi > 300 ? "bad" : air.aqi > 200 ? "warn" : "default"} />
        <StatTile label="Alerts, last 30 min" icon={<Bell />} value={activeAlerts.length} hint={`${activeAlerts.filter((a) => a.severity === "critical").length} critical`} tone={activeAlerts.some((a) => a.severity === "critical") ? "bad" : "default"} />
        <StatTile label="Open complaints" icon={<Smartphone />} value={openComplaints} hint={`${complaints.length} filed in total`} />
        <StatTile label="Ambulances active" icon={<Siren />} value={sim.missions.filter((m) => m.arrivedAt === undefined).length} hint="Green-wave priority" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <Panel title={`City traffic · ${clockLabel(sim.t)}`} description="Every dot is a simulated vehicle; roads are coloured by congestion." action={<FlowLegend />} bodyClassName="p-2">
            <TrafficCanvas layers={{ heat: true, vehicles: true, signals: false, cameras: false }} />
          </Panel>
          <Panel title="Network congestion today" description="Congestion index (0–100), one point per simulated minute.">
            {hist.length > 3 ? (
              <LineChart
                ariaLabel="Network congestion index over time"
                xLabels={hist.map((m) => clockLabel(m.t))}
                series={[{ name: "Congestion", values: hist.map((m) => m.congestion * 100), color: "var(--series-1)" }]}
                yMin={0}
                yMax={Math.max(60, Math.ceil(Math.max(...hist.map((m) => m.congestion * 100)) / 10) * 10)}
                thresholds={[{ value: 50, label: "Heavy" }]}
                yFormat={(v) => `${Math.round(v)}`}
                height={180}
              />
            ) : (
              <p className="py-8 text-center text-[13px] text-muted">Collecting data…</p>
            )}
          </Panel>
        </div>
        <div className="min-w-0 space-y-4">
          <Panel title="Latest alerts" bodyClassName="p-0">
            <ul className="divide-y divide-hair">
              {alerts.slice(0, 6).map((a) => (
                <li key={a.id} className="flex gap-2.5 px-4 py-2.5">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", a.severity === "critical" ? "bg-danger" : a.severity === "warning" ? "bg-warning" : "bg-info")} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-5 text-ink">{a.title}</span>
                    <span className="block text-[11px] text-muted">
                      {a.source} · {formatAgo(a.ts, now)}
                      {a.public ? " · broadcast" : ""}
                    </span>
                  </span>
                </li>
              ))}
              {alerts.length === 0 ? <li className="px-4 py-6 text-[13px] text-muted">All quiet.</li> : null}
            </ul>
          </Panel>
          <nav aria-label="Modules" className="space-y-2">
            {MODULES.map((m) => (
              <Link key={m.href} href={m.href} className="group flex items-start gap-3 rounded-card border border-hair bg-surface px-4 py-3 transition-colors hover:border-hair-strong hover:bg-surface-raised">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-primary-soft text-primary">
                  <m.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between text-[14px] font-medium text-ink">
                    {m.title}
                    <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-5 text-muted">{m.body}</span>
                </span>
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

function greeting(t: number) {
  const h = (t / 3600) % 24;
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
