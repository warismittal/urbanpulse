"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Car, Check, Cctv, ScanLine, ShieldAlert, Users } from "lucide-react";
import { SceneCanvas } from "@/components/surveillance/SceneCanvas";
import { LiveBadge, Panel, StatTile } from "@/components/common/kit";
import { Sparkline } from "@/components/charts/LineChart";
import { Chip } from "@/components/ui/chip";
import { RULE_META, SCENES, eventLog, onCamEvent, startSurveillance, type CamEvent, type Rule } from "@/lib/sim/surveillance";
import { useCity, useNow } from "@/lib/store/city-store";
import { CAMERA_NODES } from "@/lib/city/model";
import { cn, formatAgo } from "@/lib/utils";

const RULE_HELP: Record<Rule, string> = {
  parking: "Vehicle stationary inside a painted no-parking polygon longer than the dwell limit → e-challan with plate.",
  accident: "Two tracks overlap with abrupt stop and abnormal heading change → collision; queue behind confirms.",
  anpr: "Plate localisation + OCR as each vehicle crosses the read line; checked against watchlists.",
  crowd: "Head count per 5 m × 5 m cell; alert above 1.2 persons/m² (pre-crush level is ~4/m²).",
  dumping: "New static object appears where a person stopped, persists after they leave → dumping.",
  object: "Bag separated from its owner's track by > 5 m for > 10 s → unattended object.",
  intrusion: "Person centroid enters the restricted polygon → intrusion alarm.",
};

const SEV_DOT = { critical: "bg-danger", warning: "bg-warning", info: "bg-info" } as const;

export default function SurveillancePage() {
  const { pushAlert } = useCity();
  const [selected, setSelected] = useState(SCENES[0].id);
  const [events, setEvents] = useState<CamEvent[]>(() => [...eventLog]);
  const [filter, setFilter] = useState<Rule | "all">("all");
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [crowdSeries, setCrowdSeries] = useState<number[]>([]);
  const now = useNow(500);

  useEffect(() => {
    startSurveillance();
    const off = onCamEvent((e) => {
      setEvents((prev) => [e, ...prev].slice(0, 200));
      if (e.severity === "critical") {
        pushAlert({ severity: "critical", source: "surveillance", title: e.title, body: e.detail, public: false });
      }
    });
    return () => { off(); };
  }, [pushAlert]);

  const crowd = SCENES.find((s) => s.rule === "crowd")!;
  useEffect(() => {
    setCrowdSeries((s) => [...s, crowd.objects.length].slice(-120));
  }, [now, crowd]);

  const scene = SCENES.find((s) => s.id === selected)!;
  const anpr = SCENES.find((s) => s.rule === "anpr") as (typeof SCENES)[number] & { reads?: { plate: string; conf: number; ts: number; hit?: string }[] };
  const recent = events.filter((e) => now - e.ts < 10 * 60_000);
  const shown = events.filter((e) => filter === "all" || e.rule === filter).slice(0, 40);
  const counts = useMemo(() => {
    const c: Partial<Record<Rule, number>> = {};
    for (const e of events) c[e.rule] = (c[e.rule] ?? 0) + 1;
    return c;
  }, [events]);

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4 pb-5 pt-7">
        <div className="max-w-[760px]">
          <div className="flex items-center gap-2">
            <h1 className="text-[28px] leading-9 text-ink">Video analytics</h1>
            <LiveBadge />
          </div>
          <p className="mt-1.5 text-[14px] leading-6 text-muted">
            Seven CCTV feeds run detection and tracking; rule engines turn tracks into events — illegal parking, accidents, number plates, crowding, dumping, unattended objects and intrusions.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Cameras online" icon={<Cctv />} value={SCENES.length + CAMERA_NODES.length} hint={`${SCENES.length} analytics · ${CAMERA_NODES.length} traffic`} />
        <StatTile label="Events, last 10 min" icon={<ShieldAlert />} value={recent.length} hint={`${recent.filter((e) => e.severity === "critical").length} critical`} tone={recent.some((e) => e.severity === "critical" && !acked.has(e.id)) ? "bad" : "default"} />
        <StatTile label="Plates read" icon={<ScanLine />} value={counts.anpr ?? 0} hint={`${events.filter((e) => e.rule === "anpr" && e.severity !== "info").length} watchlist hits`} />
        <StatTile label="Station forecourt" icon={<Users />} value={crowd.objects.length} unit="people" hint={<Sparkline values={crowdSeries} color="var(--series-2)" height={18} />} />
        <StatTile label="Parking violations" icon={<Car />} value={counts.parking ?? 0} hint="e-Challans drafted this session" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-4">
          <Panel title={`${scene.name} · ${scene.location}`} description={RULE_META[scene.rule].label} action={<Chip tone="primary">{scene.status}</Chip>} bodyClassName="p-3">
            <SceneCanvas scene={scene} large className="block aspect-[4/3] w-full rounded-control bg-black" />
            <p className="mt-2 text-[12px] leading-5 text-muted">
              <span className="font-medium text-ink">Rule · </span>
              {RULE_HELP[scene.rule]} Boxes: <span className="text-primary">vehicle</span>, <span className="text-info">person</span>, <span className="text-warning">object</span>, <span className="text-danger">alert</span>.
            </p>
          </Panel>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {SCENES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s.id)}
                aria-pressed={selected === s.id}
                className={cn("rounded-card border bg-surface p-1.5 text-left transition-colors", selected === s.id ? "border-primary" : "border-hair hover:border-hair-strong")}
              >
                <SceneCanvas scene={s} />
                <span className="block px-1 pt-1.5 text-[12px] font-medium text-ink">{RULE_META[s.rule].label}</span>
                <span className="block truncate px-1 pb-0.5 text-[11px] text-muted">{s.status}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel title="Event feed" description="Critical events are escalated to the alerts bell automatically." bodyClassName="p-0">
            <div className="flex flex-wrap gap-1.5 border-b border-hair px-4 py-2.5">
              {(["all", ...Object.keys(RULE_META)] as (Rule | "all")[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setFilter(r)}
                  aria-pressed={filter === r}
                  className={cn("rounded-full px-2.5 text-[12px] leading-6 transition-colors", filter === r ? "bg-primary-soft font-medium text-primary" : "bg-surface-raised text-muted hover:text-ink")}
                >
                  {r === "all" ? "All" : RULE_META[r].label}
                  {r !== "all" && counts[r] ? <span className="ml-1 tabular-nums opacity-70">{counts[r]}</span> : null}
                </button>
              ))}
            </div>
            <ul className="max-h-[560px] divide-y divide-hair overflow-y-auto">
              {shown.length === 0 ? <li className="px-4 py-8 text-center text-[13px] text-muted">Waiting for events… scenes loop every 30–60 s.</li> : null}
              {shown.map((e) => {
                const cam = SCENES.find((s) => s.id === e.camera);
                return (
                  <li key={e.id} className={cn("px-4 py-2.5", acked.has(e.id) && "opacity-60")}>
                    <div className="flex items-start gap-2.5">
                      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", SEV_DOT[e.severity])} aria-label={e.severity} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium leading-5 text-ink">{e.title}</p>
                        <p className="text-[12px] leading-5 text-muted">{e.detail}</p>
                        <p className="mt-0.5 text-[11px] text-muted">
                          <button type="button" className="underline-offset-2 hover:underline" onClick={() => setSelected(e.camera)}>
                            {cam?.name}
                          </button>{" "}
                          · {formatAgo(e.ts, now)}
                        </p>
                      </div>
                      {e.severity !== "info" ? (
                        <button
                          type="button"
                          onClick={() => setAcked((a) => new Set(a).add(e.id))}
                          disabled={acked.has(e.id)}
                          className="shrink-0 rounded-control border border-hair px-2 text-[11px] leading-6 text-muted transition-colors hover:border-hair-strong hover:text-ink disabled:border-transparent"
                        >
                          {acked.has(e.id) ? (
                            <span className="inline-flex items-center gap-1">
                              <Check className="h-3 w-3" /> Acked
                            </span>
                          ) : (
                            "Acknowledge"
                          )}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title={<span className="inline-flex items-center gap-2"><ScanLine className="h-4 w-4 text-muted" /> Number plate recognition</span>} description="Eastern Bypass entry gate">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="pb-1.5 font-normal">Plate</th>
                  <th className="pb-1.5 text-right font-normal">OCR conf.</th>
                  <th className="pb-1.5 text-right font-normal">Check</th>
                </tr>
              </thead>
              <tbody>
                {(anpr.reads ?? []).slice(0, 8).map((r) => (
                  <tr key={r.plate + r.ts} className="border-t border-hair">
                    <td className="py-1.5">
                      <span className="rounded-[3px] border border-hair-strong bg-[#f4f1e4] px-1.5 font-mono text-[11px] font-semibold tracking-wide text-[#111]">{r.plate}</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted">{(r.conf * 100).toFixed(0)}%</td>
                    <td className={cn("py-1.5 text-right", r.hit ? (r.hit.includes("stolen") ? "font-medium text-danger" : "text-warning") : "text-muted")}>{r.hit ?? "Clear"}</td>
                  </tr>
                ))}
                {!(anpr.reads ?? []).length ? (
                  <tr>
                    <td colSpan={3} className="py-3 text-muted">
                      Waiting for the first vehicle…
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </div>
  );
}
